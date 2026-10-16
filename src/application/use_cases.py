"""Use cases. Orchestrate ports only; no FastAPI/SQL/GraphQL imports."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from hmac import compare_digest
from typing import Sequence

from src.domain.entities import FechaRango, TipoDocumento
from src.domain.errors import InvalidRangeError, NotFoundError

from .ports import GraphqlGateway, IntelisisReader, SqlDocumentReader

logger = logging.getLogger("syner_check.use_cases")


def _iso(d: date) -> str:
    return d.isoformat()


_INTELISIS_TIPO_MAP = {
    "factura": "FACTURA",
    "boleta": "BOLETA",
    "nota_credito": "NOTA DE CREDITO",
    "nota-credito": "NOTA DE CREDITO",
}


def _canon_intelisis_tipo(raw: object) -> str:
    token = str(raw or "").strip().lower().replace(" ", "_")
    if token in ("factura", "boleta", "nota_credito", "nota-credito"):
        return _INTELISIS_TIPO_MAP[token]
    return _INTELISIS_TIPO_MAP.get(token.replace("-", "_"), "")


def _norm_receipt(raw: object) -> str:
    """Canonical receipt key: PREFIX + serie + '-' + correlativo sin ceros.

    'F001-00000123' == 'f001-123' == 'F001-00000123 '. Sin '-' se
    normaliza a UPPER sin espacios (fallback, no colapsa documentos).
    """
    text = str(raw or "").strip().upper().replace(" ", "")
    if not text or "-" not in text:
        return text
    head, _, tail = text.rpartition("-")
    if not head or not tail:
        return text
    prefix = head[:1] if head[:1] in ("F", "B", "N") else ""
    serie = head[1:] if prefix else head
    serie = serie.lstrip("0") or ("0" if serie else "")
    correlativo = tail.lstrip("0") or "0"
    return f"{prefix}{serie}-{correlativo}"


def _flow_key(tipo_canon: str, receipt_norm: str, fecha10: str) -> tuple[str, str, str]:
    return (
        str(tipo_canon or "").strip().upper(),
        receipt_norm,
        str(fecha10 or "")[:10],
    )


def _intelisis_index(rows: object) -> dict[tuple[str, str, str], dict]:
    """Index Intelisis/Venta headers by (tipo, receipt_norm, fecha)."""
    by_key: dict[tuple[str, str, str], dict] = {}
    for prow in rows or []:
        if not isinstance(prow, dict):
            continue
        tipo_canon = _canon_intelisis_tipo(prow.get("TransactionType"))
        if not tipo_canon:
            continue
        key = _flow_key(
            tipo_canon,
            _norm_receipt(prow.get("ReceiptNumber")),
            str(prow.get("FechaEmision", ""))[:10],
        )
        by_key.setdefault(key, prow)
    return by_key


def _intelisis_payload(prow: dict) -> dict:
    """Minimal Intelisis header attached to a matched voucher."""
    return {
        "IntelisisID": str(prow.get("IntelisisID", "")),
        "Mov": str(prow.get("Mov", "")),
        "MovID": str(prow.get("MovID", "")),
        "ReceiptNumber": str(prow.get("ReceiptNumber", "")),
        "FechaEmision": str(prow.get("FechaEmision", "")),
        "EstatusIntelisis": str(prow.get("EstatusIntelisis", "")),
        "StoreName": str(prow.get("StoreName", "")),
    }


def _fetch_intelisis_dates(
    intelisis: IntelisisReader, dates: set[str] | Sequence[str], limit: int = 10
) -> tuple[list[dict], str | None]:
    """Fetch 1-day Intelisis headers for distinct doc dates (capped).

    Returns (rows, warning). Never raises: failures degrade to ([], warn).
    """
    wanted = sorted({str(d or "")[:10] for d in dates if str(d or "")[:10]})[:limit]
    if not wanted:
        return [], None
    rows: list[dict] = []
    with ThreadPoolExecutor(max_workers=max(1, min(len(wanted), 4))) as pool:
        futures = {d: pool.submit(intelisis.fetch_headers, d, d) for d in wanted}
        for future in futures.values():
            try:
                rows.extend(future.result() or [])
            except Exception as exc:
                logger.warning(
                    "Intelisis fetch failed; continuing degraded: %s",
                    type(exc).__name__,
                )
                return [], "intelisis_unavailable"
    return rows, None


def summarize(
    reader: SqlDocumentReader,
    gateway: GraphqlGateway,
    *,
    start_iso: str,
    end_iso: str,
    tipos: Sequence[TipoDocumento],
    max_range_days: int,
    intelisis: IntelisisReader | None = None,
) -> dict:
    FechaRango.from_iso(start_iso, end_iso, max_range_days)
    tipo_values = [t.value for t in tipos]
    # GraphQL, MovSynerPos e Intelisis son independientes: lecturas
    # concurrentes para que la latencia total sea max() y no la suma.
    # Intelisis es opcional: si no esta configurado o falla, se degrada
    # a intelisis_enabled=False sin romper el resumen base.
    workers = 3 if intelisis is not None else 2
    with ThreadPoolExecutor(max_workers=workers) as pool:
        gql_future = pool.submit(gateway.summary, start_iso, end_iso, tipo_values)
        sql_future = pool.submit(reader.fetch_documents, start_iso, end_iso, tipo_values)
        int_future = (
            pool.submit(intelisis.fetch_headers, start_iso, end_iso)
            if intelisis is not None
            else None
        )
        gql = gql_future.result()
        sql = sql_future.result()
        intelisis_rows: list[dict] = []
        intelisis_warning: str | None = None
        if int_future is not None:
            try:
                fetched = int_future.result()
                intelisis_rows = list(fetched or [])
            except Exception as exc:
                logger.warning(
                    "Intelisis fetch failed; continuing degraded: %s",
                    type(exc).__name__,
                )
                intelisis_rows = []
                intelisis_warning = "intelisis_unavailable"

    intelisis_enabled = int_future is not None and intelisis_warning is None

    sql_by_type: dict[str, list[dict]] = {t: [] for t in tipo_values}
    for row in sql:
        sql_by_type.setdefault(str(row.get("TipoDocumento", "")), []).append(row)

    intelisis_by_key: dict[tuple[str, str, str], dict] = _intelisis_index(
        intelisis_rows
    )

    out: dict[str, list[dict]] = {}
    flow_per_tipo: dict[str, dict] = {}
    for tipo in tipo_values:
        docs = gql.get(tipo, [])
        sql_keys = {
            (str(r.get("IDSynerPos", "")).strip().upper(), str(r.get("FechaDocumento", "")))
            for r in sql_by_type.get(tipo, [])
        }
        rows = []
        in_mov = in_int = full = pending = cancelled = 0
        for doc in docs:
            sql_key = (str(doc.get("oid", "")).strip().upper(), str(doc.get("date", ""))[:10])
            in_sql = sql_key in sql_keys
            doc_tipo = str(doc.get("tipo", "") or tipo).strip().upper() or tipo
            flow_k = _flow_key(
                doc_tipo,
                _norm_receipt(doc.get("number", "")),
                str(doc.get("date", ""))[:10],
            )
            prow = intelisis_by_key.get(flow_k)
            in_intelisis = prow is not None
            estatus = (
                str(prow.get("EstatusIntelisis", "")).strip().upper()
                if prow is not None
                else ""
            )
            concluded = estatus == "CONCLUIDO"
            is_cancelled = estatus == "CANCELADO"
            in_mov += 1 if in_sql else 0
            in_int += 1 if in_intelisis else 0
            full += 1 if (in_sql and concluded) else 0
            pending += (
                1 if (in_sql and in_intelisis and not concluded and not is_cancelled) else 0
            )
            cancelled += 1 if (in_sql and is_cancelled) else 0
            entry = {**doc, "tipo": tipo, "in_sql": in_sql, "in_intelisis": in_intelisis}
            if prow is not None:
                entry["intelisis"] = _intelisis_payload(prow)
            rows.append(entry)
        out[tipo] = rows
        flow_per_tipo[tipo] = {
            "graphql": len(docs),
            "in_mov": in_mov,
            "in_intelisis": in_int,
            "full": full,
            "pending_in_intelisis": pending,
            "cancelled_in_intelisis": cancelled,
            "missing_in_mov": len(docs) - in_mov,
            "missing_in_intelisis": len(docs) - in_int,
        }
    totals = {
        "graphql": sum(v["graphql"] for v in flow_per_tipo.values()),
        "in_mov": sum(v["in_mov"] for v in flow_per_tipo.values()),
        "in_intelisis": sum(v["in_intelisis"] for v in flow_per_tipo.values()),
        "full": sum(v["full"] for v in flow_per_tipo.values()),
        "pending_in_intelisis": sum(
            v["pending_in_intelisis"] for v in flow_per_tipo.values()
        ),
        "cancelled_in_intelisis": sum(
            v["cancelled_in_intelisis"] for v in flow_per_tipo.values()
        ),
    }
    totals["missing_in_mov"] = totals["graphql"] - totals["in_mov"]
    totals["missing_in_intelisis"] = totals["graphql"] - totals["in_intelisis"]
    result = {
        "documents": out,
        "sql_count": len(sql),
        "graphql_count": sum(len(v) for v in gql.values()),
        "intelisis_enabled": intelisis_enabled,
        "intelisis_count": len(intelisis_rows) if intelisis_enabled else 0,
        "flow": {"per_tipo": flow_per_tipo, "totals": totals},
        "range": {"start": start_iso, "end": end_iso},
    }
    if intelisis_warning is not None:
        result["intelisis_warning"] = intelisis_warning
    return result


def search_by_number(
    reader: SqlDocumentReader,
    gateway: GraphqlGateway,
    *,
    number: str,
    fallback_days: int,
    today: date,
    intelisis: IntelisisReader | None = None,
) -> dict:
    """Find one voucher by number across all document types.

    FACTURA and BOLETA use the server-side `serie` filter (direct number
    lookup, no date range). NOTA DE CREDITO has no `serie` support, so it
    uses date-scoped summaries (the SQL rows' dates when indexed, else the
    last ``fallback_days`` days). The local SQL index decides `source` and
    `in_sql`; GraphQL provides the display fields. When an Intelisis reader
    is given, each hit is also matched against Venta headers for its own
    date (1-day fetches, capped), so number search reports `in_intelisis`
    with the same (tipo, number, fecha) key as the range summary.
    """
    cleaned = (number or "").strip()
    if not cleaned:
        raise InvalidRangeError("Provide a document number.")
    target = cleaned.upper()
    tipo_values = [t.value for t in TipoDocumento]

    rows = reader.fetch_by_number(cleaned, tipo_values, None, None)

    # FACTURA/BOLETA: direct `serie` lookup in parallel (no date range).
    serie_docs: list[tuple[str, dict]] = []
    with ThreadPoolExecutor(max_workers=2) as pool:
        serie_futures = {
            "FACTURA": pool.submit(gateway.search_by_serie, "FACTURA", cleaned),
            "BOLETA": pool.submit(gateway.search_by_serie, "BOLETA", cleaned),
        }
        for tipo, future in serie_futures.items():
            for doc in future.result():
                if str(doc.get("number", "")).strip().upper() == target:
                    serie_docs.append((tipo, doc))

    # NOTA DE CREDITO: date-scoped (no `serie` support).
    nc_docs: list[dict] = []
    if rows:
        nc_dates = {
            str(r.get("FechaDocumento", ""))
            for r in rows
            if str(r.get("TipoDocumento", "")) == "NOTA DE CREDITO"
            and str(r.get("FechaDocumento", ""))
        }
        if nc_dates:
            with ThreadPoolExecutor(
                max_workers=max(1, min(len(nc_dates), 4))
            ) as pool:
                nc_futures = {
                    d: pool.submit(gateway.summary, d, d, ["NOTA DE CREDITO"])
                    for d in nc_dates
                }
                for future in nc_futures.values():
                    for doc in future.result().get("NOTA DE CREDITO", []):
                        if str(doc.get("number", "")).strip().upper() == target:
                            nc_docs.append(doc)
        source = "sql_index"
        searched_range = None
    else:
        start = today - timedelta(days=fallback_days)
        end = today
        gql = gateway.summary(_iso(start), _iso(end), ["NOTA DE CREDITO"])
        for doc in gql.get("NOTA DE CREDITO", []):
            if str(doc.get("number", "")).strip().upper() == target:
                nc_docs.append(doc)
        source = "graphql_fallback"
        searched_range = {"start": _iso(start), "end": _iso(end)}

    # Assemble: show every distinct GraphQL doc (do NOT collapse provider
    # duplicates by number). Mark in_sql per doc by oid match against SQL,
    # so the table distinguishes the indexed voucher ("Encontrado") from
    # provider duplicates ("No encontrado").
    sql_by_oid: dict[str, dict] = {}
    for r in rows:
        sql_by_oid[str(r.get("IDSynerPos", "")).strip().upper()] = r

    results: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for tipo, doc in serie_docs:
        oid = str(doc.get("oid", "")).strip().upper()
        doc_date = str(doc.get("date", ""))[:10]
        marker = (tipo, oid, doc_date)
        if marker in seen:
            continue
        seen.add(marker)
        sql_row = sql_by_oid.get(oid)
        entry: dict = {**doc, "tipo": tipo, "in_sql": sql_row is not None}
        if sql_row is not None:
            entry["sql"] = sql_row
        results.append(entry)

    for doc in nc_docs:
        tipo = "NOTA DE CREDITO"
        oid = str(doc.get("oid", "")).strip().upper()
        doc_date = str(doc.get("date", ""))[:10]
        marker = (tipo, oid, doc_date)
        if marker in seen:
            continue
        seen.add(marker)
        sql_row = sql_by_oid.get(oid)
        entry = {**doc, "tipo": tipo, "in_sql": sql_row is not None}
        if sql_row is not None:
            entry["sql"] = sql_row
        results.append(entry)

    # Intelisis (optional, degraded): match each hit against Venta headers
    # fetched for the hits' own dates, same key as the range summary.
    intelisis_enabled = False
    intelisis_warning: str | None = None
    if intelisis is not None:
        doc_dates = {
            str(e.get("date", ""))[:10] for e in results if str(e.get("date", ""))[:10]
        }
        fetched, intelisis_warning = _fetch_intelisis_dates(intelisis, doc_dates)
        if intelisis_warning is None:
            intelisis_enabled = True
            by_key = _intelisis_index(fetched)
            for entry in results:
                key = _flow_key(
                    str(entry.get("tipo", "")),
                    _norm_receipt(entry.get("number", "")),
                    str(entry.get("date", ""))[:10],
                )
                prow = by_key.get(key)
                entry["in_intelisis"] = prow is not None
                if prow is not None:
                    entry["intelisis"] = _intelisis_payload(prow)
        else:
            for entry in results:
                entry["in_intelisis"] = False
    else:
        for entry in results:
            entry["in_intelisis"] = False

    out: dict = {
        "results": results,
        "source": source,
        "intelisis_enabled": intelisis_enabled,
    }
    if searched_range is not None:
        out["searched_range"] = searched_range
    if intelisis_warning is not None:
        out["intelisis_warning"] = intelisis_warning
    return out


def get_detail(
    gateway: GraphqlGateway,
    *,
    tipo: TipoDocumento,
    oid: str,
    doc_date_iso: str,
    number: str | None = None,
) -> dict:
    FechaRango.from_iso(doc_date_iso, doc_date_iso, 1_000_000)
    cleaned_number = (number or "").strip()
    if cleaned_number and tipo.value in ("FACTURA", "BOLETA"):
        docs = gateway.detail_by_serie(tipo.value, cleaned_number)
    else:
        docs = gateway.detail(tipo.value, doc_date_iso, doc_date_iso)
    target_number = cleaned_number.upper()
    for doc in docs:
        if not compare_digest(str(doc.get("oid", "")), oid):
            continue
        if target_number and str(doc.get("number", "")).strip().upper() != target_number:
            continue
        return {"document": {**doc, "tipo": tipo.value}}
    raise NotFoundError("Document not found.")
