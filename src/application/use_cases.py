"""Use cases. Orchestrate ports only; no FastAPI/SQL/GraphQL imports."""

from __future__ import annotations

import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from hmac import compare_digest
from typing import Any, Sequence

from src.domain.entities import FechaRango, TipoDocumento
from src.domain.errors import InvalidRangeError, NotFoundError, UpstreamError

from .ports import (
    GraphqlGateway,
    IntelisisReader,
    SqlDocumentReader,
    SunatCacheStore,
    SunatValidator,
)

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
    sunat_store: SunatCacheStore | None = None,
    sunat_ruc: str = "",
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
    # SUNAT cache read only (zero live calls on this path).
    try:
        if sunat_store is not None and sunat_ruc:
            attach_sunat_status(
                [e for rows in out.values() for e in rows],
                sunat_store,
                sunat_ruc,
            )
            result["sunat_enabled"] = True
        else:
            result["sunat_enabled"] = False
    except Exception:
        result["sunat_enabled"] = False
    return result


def search_by_number(
    reader: SqlDocumentReader,
    gateway: GraphqlGateway,
    *,
    number: str,
    fallback_days: int,
    today: date,
    intelisis: IntelisisReader | None = None,
    sunat_store: SunatCacheStore | None = None,
    sunat_ruc: str = "",
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

    `SerieNumero` is reused across years, so the same number can return
    several documents; all of them are kept (each with its own date) instead
    of collapsing to the latest one.
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
    try:
        if sunat_store is not None and sunat_ruc:
            attach_sunat_status(results, sunat_store, sunat_ruc)
            out["sunat_enabled"] = True
        else:
            out["sunat_enabled"] = False
    except Exception:
        out["sunat_enabled"] = False
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


# --- SUNAT validation (4th stage, on-demand only) ---
#
# Never inline in the range summary path: SUNAT calls are slow, quota
# limited and worker-paced. The summary only READS this cache (zero SUNAT
# calls); live validation happens through submit_sunat_batch (explicit
# batch jobs) and sunat_revalidate (manual single doc).

_SUNAT_TIPO_CODES = {
    "FACTURA": "01",
    "BOLETA": "03",
    "NOTA DE CREDITO": "07",
}

_SUNAT_FINAL = ("ACEPTADO", "ANULADO")
_SUNAT_SETTLED = (
    "ACEPTADO",
    "ANULADO",
    "NO_EXISTE",
    "AUTORIZADO",
    "NO_AUTORIZADO",
)
_SUNAT_JOB_TERMINAL = ("COMPLETADO", "COMPLETADO_ERROR", "CANCELADO", "ERROR")

_SUNAT_KNOWN = (
    "ACEPTADO",
    "NO_EXISTE",
    "ANULADO",
    "AUTORIZADO",
    "NO_AUTORIZADO",
    "DESCONOCIDO",
)


def _norm_numero(raw: object) -> str:
    """Cache-key numero: leading zeros are insignificant ('00000152'='152').

    The API payload keeps the original string (spec recommends preserving
    zeros); only the local cache key is normalized so validator echoes
    (which may come back stripped) hit the same row.
    """
    text = str(raw or "").strip()
    return text.lstrip("0") or "0" if text else ""


def _sunat_key(
    ruc: str, tipo_value: str, number: str
) -> tuple[str, str, str, str] | None:
    """SUNAT identity key (ruc, tipo_code, serie, numero), or None if bad."""
    code = _SUNAT_TIPO_CODES.get(str(tipo_value or "").strip().upper(), "")
    text = str(number or "").strip().upper()
    if not code or "-" not in text:
        return None
    serie, _, numero = text.rpartition("-")
    serie = serie.strip()
    if not serie or not numero.strip().isdigit():
        return None
    numero = _norm_numero(numero)
    if not serie or not numero:
        return None
    return (ruc, code, serie, numero)


def _sunat_doc_payload(
    ruc: str, tipo_value: str, number: str, date_iso: str, importe: object
) -> dict[str, Any]:
    """Validator payload for one voucher; raises ValueError when invalid."""
    clean_ruc = str(ruc or "").strip()
    if not clean_ruc.isdigit() or len(clean_ruc) != 11:
        raise ValueError(f"RUC emisor inválido para SUNAT: {ruc!r}.")
    key = _sunat_key(clean_ruc, tipo_value, number)
    if key is None:
        raise ValueError(f"Número/tipo no válido para SUNAT: {number!r}.")
    try:
        day = date.fromisoformat(str(date_iso or "")[:10])
    except ValueError as exc:
        raise ValueError(f"Fecha no válida para SUNAT: {date_iso!r}.") from exc
    try:
        amount = round(float(importe), 2)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Importe no válido para SUNAT: {importe!r}.") from exc
    if not math.isfinite(amount) or amount < 0:
        raise ValueError(f"Importe no válido para SUNAT: {importe!r}.")
    _, code, serie, numero = key
    return {
        "ruc": ruc,
        "tipo": code,
        "serie": serie,
        "numero": numero,
        "fecha_emision": day.isoformat(),
        "importe": amount,
    }


def _sunat_estado(row: dict | None) -> str:
    return str((row or {}).get("Estado", "")).strip().upper()


def _sunat_job_id(row: dict | None) -> int | None:
    try:
        value = int((row or {}).get("TrabajoID") or 0)
    except (TypeError, ValueError):
        return None
    return value or None


def _sunat_job_terminal(estado: object) -> bool:
    return str(estado or "").strip().upper() in _SUNAT_JOB_TERMINAL


def _sunat_fresh(row: dict, revalidate_hours: int, now: datetime) -> bool:
    """True only for a settled result that does not need another SUNAT call.

    PENDIENTE/PROCESANDO/ERROR/DESCONOCIDO are *never* fresh. This is the
    critical difference: the submit path stamps FechaConsulta when it creates
    the PENDIENTE row, and the old implementation interpreted that as a fresh
    cache hit, so a retry skipped every document still waiting in SUNAT.
    """
    estado = _sunat_estado(row)
    if estado in _SUNAT_FINAL:
        return True
    if estado not in _SUNAT_SETTLED:
        return False
    raw = str(row.get("FechaConsulta", ""))
    try:
        seen = datetime.fromisoformat(raw[:19])
    except ValueError:
        return False
    return (now - seen) < timedelta(hours=revalidate_hours)


def _sunat_row_age(row: dict, now: datetime) -> timedelta | None:
    """Age since the last local write, or None when the store did not tell us."""
    raw = str(row.get("FechaActualizacion", "") or row.get("FechaConsulta", ""))
    try:
        seen = datetime.fromisoformat(raw[:19])
    except ValueError:
        return None
    return now - seen


def _sunat_pending_rows(
    chunk: list[tuple[dict[str, Any], tuple[str, str, str, str]]],
    cached: dict[tuple[str, str, str, str], dict],
    usuario: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for payload, key in chunk:
        previous = cached.get(key, {})
        rows.append(
            {
                "Ruc": key[0],
                "Tipo": key[1],
                "Serie": key[2],
                "Numero": key[3],
                "Estado": "PENDIENTE",
                "Importe": payload["importe"],
                "FechaEmision": payload["fecha_emision"],
                "TrabajoID": None,
                "Intentos": int(previous.get("Intentos") or 0) + 1,
                "CorrelationID": previous.get("CorrelationID") or None,
                "UsuarioOrigen": (usuario or "")[:100],
            }
        )
    return rows


def _sunat_reconcile_cached_jobs(
    validator: SunatValidator,
    store: SunatCacheStore,
    *,
    keys: list[tuple[str, str, str, str]],
    cached: dict[tuple[str, str, str, str], dict],
    usuario: str,
) -> set[int]:
    """Reconcile existing jobs before deciding what to submit.

    Returns the set of job ids whose documents are still running. Those keys
    must NOT be resubmitted: the validator has no idempotency key, and the
    old code created duplicate work when a retry happened while a job was
    still queued/running.
    """
    job_ids = sorted(
        {
            job_id
            for key in keys
            if _sunat_estado(cached.get(key)) in ("PENDIENTE", "PROCESANDO")
            for job_id in [_sunat_job_id(cached.get(key))]
            if job_id is not None
        }
    )
    running: set[int] = set()
    for job_id in job_ids:
        try:
            result = sunat_job_status(
                validator, store, trabajo_id=job_id, usuario=usuario
            )
        except UpstreamError as exc:
            if getattr(exc, "http_status", None) == 404:
                try:
                    store.mark_job_missing(
                        job_id,
                        "Trabajo SUNAT no encontrado; se puede reintentar.",
                    )
                except Exception as store_exc:  # noqa: BLE001
                    logger.warning(
                        "SUNAT job %s cleanup failed: %s",
                        job_id,
                        type(store_exc).__name__,
                    )
                continue
            # Validator outage: never duplicate a job we cannot inspect.
            running.add(job_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "SUNAT job %s reconciliation failed: %s",
                job_id,
                type(exc).__name__,
            )
            running.add(job_id)
        else:
            if not _sunat_job_terminal(result.get("estado")):
                running.add(job_id)
    return running


def submit_sunat_batch(
    validator: SunatValidator,
    store: SunatCacheStore,
    *,
    documentos: list[dict[str, Any]],
    usuario: str,
    ruc: str,
    revalidate_hours: int = 24,
    now: datetime | None = None,
    batch_max: int = 50,
    request_max: int = 2000,
) -> dict:
    """Validate vouchers against SUNAT via async batch jobs (explicit only).

    Design:
    - First reconcile jobs already tracked in the cache. A retry while a job
      is queued/running must not create duplicates.
    - PENDIENTE/ERROR/DESCONOCIDO are never treated as fresh.
    - Each chunk is claimed in the local cache *before* the HTTP call, then
      stamped with its TrabajoID. A submit failure leaves an honest ERROR,
      never a forever-PENDIENTE row.
    - Chunks are small (default 50) so progress is persisted often and one
      lost response cannot hide a 458-document batch.
    """
    current = now if isinstance(now, datetime) else datetime.now()
    docs = list(documentos or [])
    if len(docs) > request_max:
        raise ValueError(f"Límite por solicitud: {request_max} documentos.")
    if not (ruc or "").strip() or not ruc.strip().isdigit():
        raise ValueError("RUC emisor inválido.")
    chunk_size = max(1, min(int(batch_max), 500))

    payloads: list[dict[str, Any]] = []
    keys: list[tuple[str, str, str, str]] = []
    invalidos: list[dict[str, str]] = []
    for item in docs:
        data = item if isinstance(item, dict) else {}
        try:
            payload = _sunat_doc_payload(
                ruc.strip(),
                data.get("tipo", ""),
                data.get("number", ""),
                data.get("date", ""),
                data.get("crossTotal", data.get("importe", "")),
            )
        except ValueError:
            invalidos.append(
                {
                    "tipo": str(data.get("tipo", "")),
                    "number": str(data.get("number", "")),
                    "reason": "datos insuficientes para SUNAT",
                }
            )
            continue
        payloads.append(payload)
        keys.append(
            (
                payload["ruc"],
                payload["tipo"],
                str(payload["serie"]).strip().upper(),
                _norm_numero(payload["numero"]),
            )
        )

    cached = store.fetch_many(keys)
    # Any tracked job may finish during reconciliation. Refresh the snapshot
    # afterwards, not only when a job is still running; otherwise the local
    # PENDIENTE copy would look like work to submit again.
    tracked = any(
        _sunat_estado(cached.get(key)) in ("PENDIENTE", "PROCESANDO")
        and _sunat_job_id(cached.get(key)) is not None
        for key in keys
    )
    running = _sunat_reconcile_cached_jobs(
        validator,
        store,
        keys=keys,
        cached=cached,
        usuario=usuario,
    )
    if tracked:
        cached = store.fetch_many(keys)

    fresh = 0
    en_proceso = 0
    pendientes: list[tuple[dict[str, Any], tuple[str, str, str, str]]] = []
    for payload, key in zip(payloads, keys):
        row = cached.get(key)
        estado = _sunat_estado(row)
        if row is not None and _sunat_fresh(row, revalidate_hours, current):
            fresh += 1
            continue
        job_id = _sunat_job_id(row)
        if estado in ("PENDIENTE", "PROCESANDO") and job_id is not None:
            if job_id in running:
                en_proceso += 1
                continue
        if estado in ("PENDIENTE", "PROCESANDO") and job_id is None:
            age = _sunat_row_age(row, current) if row else None
            # A very recent row without TrabajoID means another submit may
            # still be in flight. Do not create a second job.
            if age is not None and age < timedelta(minutes=2):
                en_proceso += 1
                continue
        pendientes.append((payload, key))

    trabajos: list[dict[str, Any]] = []
    errores: list[dict[str, Any]] = []
    enviados = 0
    for pos in range(0, len(pendientes), chunk_size):
        chunk = pendientes[pos : pos + chunk_size]
        claim_rows = _sunat_pending_rows(chunk, cached, usuario)
        try:
            # Claim first: if this write fails we must not spend a SUNAT call
            # whose result we could never reconcile locally.
            store.upsert_many(claim_rows)
        except Exception as exc:
            raise UpstreamError(
                "No se pudo registrar el estado local del lote SUNAT."
            ) from exc

        try:
            body = validator.submit_batch(
                [
                    {**payload, "forzar_consulta": False}
                    for payload, _ in chunk
                ],
                usuario=usuario,
                origen="syner-check",
            )
            trabajo_id = int(body["trabajo_id"])
        except Exception as exc:
            error_rows = [
                {
                    **row,
                    "Estado": "ERROR",
                    "UltimoError": (
                        "No se pudo registrar el lote en SUNAT; reintentar."
                    ),
                    "TrabajoID": None,
                }
                for row in claim_rows
            ]
            try:
                store.upsert_many(error_rows)
            except Exception as store_exc:  # noqa: BLE001
                logger.exception(
                    "SUNAT submit failed and error state could not be saved: %s",
                    type(store_exc).__name__,
                )
            errores.append(
                {
                    "cantidad": len(chunk),
                    "mensaje": (
                        "No se pudo registrar el lote en SUNAT; "
                        "los documentos quedaron marcados para reintentar."
                    ),
                }
            )
            logger.warning(
                "SUNAT submit chunk failed: %s", type(exc).__name__
            )
            break

        job_rows = [
            {
                **row,
                "TrabajoID": trabajo_id,
                "CorrelationID": (
                    str(body.get("correlation_id") or "")[:100]
                    or row.get("CorrelationID")
                ),
            }
            for row in claim_rows
        ]
        saved = False
        for attempt in range(3):
            try:
                store.upsert_many(job_rows)
                saved = True
                break
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "SUNAT job %s id save attempt %d failed: %s",
                    trabajo_id,
                    attempt + 1,
                    type(exc).__name__,
                )
                if attempt < 2:
                    time.sleep(0.2)
        if not saved:
            errores.append(
                {
                    "cantidad": len(chunk),
                    "mensaje": (
                        f"El lote SUNAT {trabajo_id} fue creado, pero no se "
                        "pudo guardar su ID local. Espera unos minutos antes "
                        "de reintentar para no duplicar la validación."
                    ),
                }
            )
        enviados += len(chunk)
        trabajos.append(
            {
                "trabajo_id": trabajo_id,
                "cantidad": len(chunk),
                "estado": "EN_COLA",
            }
        )

    return {
        "trabajos": trabajos,
        "enviados": enviados,
        "omitidos": {
            "cache_terminal": fresh,
            "en_proceso": en_proceso,
            "invalidos": invalidos,
        },
        "errores": errores,
        "total": len(docs),
    }


def _sunat_map_estado(raw: object) -> str:
    token = str(raw or "").strip().upper()
    return token if token in _SUNAT_KNOWN else "DESCONOCIDO"


def _sunat_error_text(item: dict) -> str:
    """Real per-document error only; SUNAT says 'Operation Success!' on OK."""
    tipo = str(item.get("ErrorTipo") or "").strip()
    mensaje = str(item.get("Mensaje") or "").strip()
    if str(item.get("Estado", "")).strip().upper() == "ERROR":
        return (mensaje or tipo or "ERROR")[:500]
    if not tipo and mensaje.lower() in ("", "operation success!", "operation success"):
        return ""
    if not tipo and not mensaje:
        return ""
    return f"{tipo or 'ERROR'}: {mensaje}".strip(": ")[:500]


def _sunat_value(item: dict, prev: dict, key: str):
    """Prefer a non-empty value from SUNAT, else keep the local one."""
    value = item.get(key)
    if value is None or value == "":
        return prev.get(key)
    return value


def _sunat_job_progress(store: SunatCacheStore, trabajo_id: int) -> dict:
    try:
        return store.job_progress(int(trabajo_id)) or {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Sunat job progress read failed: %s", type(exc).__name__)
        return {}


def _sunat_local_complete(local: dict) -> bool:
    """True when the cache already holds a terminal answer for every row."""
    return int(local.get("total") or 0) > 0 and int(local.get("pendientes") or 0) == 0


def _persist_sunat_job_detail(
    store: SunatCacheStore,
    body: dict,
    *,
    trabajo_id: int,
    usuario: str,
) -> list[dict[str, str]]:
    """Persist terminal per-document results from one detail payload.

    The previous version rebuilt each row from scratch, which overwrote
    Importe/FechaEmision with NULL and incremented Intentos on every poll.
    Here we merge with the previous row and only advance the state when the
    new state is at least as authoritative.
    """
    trabajo = body.get("trabajo", {}) if isinstance(body, dict) else {}
    detalle = body.get("detalle", []) if isinstance(body, dict) else []
    parsed: list[tuple[tuple[str, str, str, str], str, dict]] = []
    for item in detalle if isinstance(detalle, list) else []:
        if not isinstance(item, dict):
            continue
        item_estado = str(item.get("Estado", "")).strip().upper()
        if item_estado == "OK":
            estado = _sunat_map_estado(item.get("ResultadoEstado"))
        elif item_estado == "ERROR":
            estado = "ERROR"
        else:
            continue  # PENDIENTE/PROCESANDO: the worker has not finished
        key = (
            str(item.get("RUCEmisor", item.get("Ruc", ""))).strip(),
            str(item.get("TipoComprobante", item.get("Tipo", ""))).strip(),
            str(item.get("Serie", "")).strip().upper(),
            _norm_numero(item.get("Numero", "")),
        )
        if all(key):
            parsed.append((key, estado, item))

    keys = [key for key, _estado, _item in parsed]
    # Read is strict: if we cannot load the previous row we must not write a
    # partial row (that is exactly how Importe/FechaEmision were lost before).
    previous = store.fetch_many(keys) if keys else {}
    rows: list[dict[str, Any]] = []
    resultados: list[dict[str, str]] = []
    for key, estado, item in parsed:
        prev = previous.get(key, {})
        prev_estado = _sunat_estado(prev)
        # A late poll must never downgrade a settled result.
        if prev_estado in _SUNAT_FINAL:
            continue
        if prev_estado in _SUNAT_SETTLED and estado not in _SUNAT_SETTLED:
            continue
        rows.append(
            {
                "Ruc": key[0],
                "Tipo": key[1],
                "Serie": key[2],
                "Numero": key[3],
                "Estado": estado,
                "CodigoSunat": _sunat_value(item, prev, "CodigoSunat"),
                "RucEstado": _sunat_value(item, prev, "RucEstado"),
                "RucCondicion": _sunat_value(item, prev, "RucCondicion"),
                "Observaciones": _sunat_value(item, prev, "Observaciones"),
                "Importe": _sunat_value(item, prev, "Importe"),
                "FechaEmision": _sunat_value(item, prev, "FechaEmision"),
                "ConsultaID": _sunat_value(item, prev, "ConsultaID"),
                "CorrelationID": _sunat_value(item, prev, "CorrelationID"),
                "TrabajoID": int(trabajo_id),
                # One submit = one attempt. Polling is not another attempt.
                "Intentos": int(prev.get("Intentos") or 1),
                "UltimoError": _sunat_error_text(item),
                # Keep the original submitter for audit; a poll (or the
                # background worker) is not the origin of the validation.
                "UsuarioOrigen": (prev.get("UsuarioOrigen") or usuario or "")[:100],
            }
        )
        resultados.append(
            {
                "serie": key[2],
                "numero": key[3],
                "estado": estado,
            }
        )
    if rows:
        # A DB failure must surface: silently swallowing it left the cache
        # PENDIENTE while the API reported success.
        store.upsert_many(rows)
    if _sunat_job_terminal(trabajo.get("Estado")):
        try:
            store.mark_job_missing(
                int(trabajo_id),
                "SUNAT no devolvió resultado para este comprobante.",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "SUNAT job %s missing-row cleanup failed: %s",
                trabajo_id,
                type(exc).__name__,
            )
    return resultados


def sunat_job_status(
    validator: SunatValidator,
    store: SunatCacheStore,
    *,
    trabajo_id: int,
    usuario: str = "",
    persist: bool = True,
    now: datetime | None = None,
) -> dict:
    """Poll one batch job. Summary while running; detail only when terminal.

    Polling the full detail on every tick was expensive for 458 documents and
    caused 30 s frontend timeouts. The summary endpoint is enough for the
    progress bar; the detail is fetched once, after the job is terminal, and
    persisted in one transaction.
    """
    job_id = int(trabajo_id)
    local = _sunat_job_progress(store, job_id)
    summary: dict = {}
    try:
        summary = validator.job_status(job_id, detalle=False)
    except UpstreamError as exc:
        if getattr(exc, "http_status", None) == 404:
            if int(local.get("pendientes") or 0) > 0:
                try:
                    store.mark_job_missing(
                        job_id,
                        "Trabajo SUNAT no encontrado; reintentar.",
                    )
                except Exception as store_exc:  # noqa: BLE001
                    logger.warning(
                        "SUNAT job %s cleanup failed: %s",
                        job_id,
                        type(store_exc).__name__,
                    )
                local = _sunat_job_progress(store, job_id)
        elif _sunat_local_complete(local):
            summary = {}  # validator down but local results are complete
        else:
            raise

    trabajo = summary.get("trabajo", {}) if isinstance(summary, dict) else {}
    estado = str(trabajo.get("Estado", "")).strip().upper()
    if not estado and _sunat_local_complete(local):
        estado = "COMPLETADO"
    terminal = _sunat_job_terminal(estado)

    resultados: list[dict[str, str]] = []
    if persist and terminal and not _sunat_local_complete(local):
        detail = validator.job_status(job_id, detalle=True)
        detail_trabajo = (
            detail.get("trabajo", {}) if isinstance(detail, dict) else {}
        )
        if isinstance(detail_trabajo, dict) and detail_trabajo:
            trabajo = detail_trabajo
            estado = str(trabajo.get("Estado", estado)).strip().upper() or estado
        resultados = _persist_sunat_job_detail(
            store, detail, trabajo_id=job_id, usuario=usuario
        )
        local = _sunat_job_progress(store, job_id)

    total = max(
        int(trabajo.get("Total") or 0) if isinstance(trabajo, dict) else 0,
        int(local.get("total") or 0),
    )
    exitosos = int(local.get("exitosos") or 0)
    errores = int(local.get("errores") or 0)
    local_pending = int(local.get("pendientes") or 0)
    # Every local row that is no longer PENDIENTE/PROCESANDO already has an
    # answer, including DESCONOCIDO (which is neither success nor error).
    settled = max(total - local_pending, 0) if local else exitosos + errores
    procesados = max(
        int(trabajo.get("Procesados") or 0) if isinstance(trabajo, dict) else 0,
        settled,
    )
    if total:
        procesados = min(procesados, total)
    pendientes = local_pending if local else max(total - procesados, 0)
    porcentaje = (
        round(min(100.0, max(0.0, (procesados / total) * 100)), 1)
        if total
        else 0.0
    )
    if terminal:
        if estado == "CANCELADO":
            mensaje = "Validación cancelada."
        elif estado in ("ERROR", "COMPLETADO_ERROR") or errores:
            mensaje = "Validación completada con errores."
        else:
            mensaje = "Validación completada."
    elif estado in ("EN_COLA", "PENDIENTE"):
        mensaje = "Lote en cola de SUNAT."
    elif estado:
        mensaje = "Consultando SUNAT…"
    else:
        mensaje = "Esperando estado de SUNAT…"
    return {
        "trabajo_id": job_id,
        "estado": estado,
        "total": total,
        "procesados": procesados,
        "exitosos": exitosos,
        "errores": errores,
        "pendientes": pendientes,
        "porcentaje": porcentaje,
        "mensaje": mensaje,
        "resultados": resultados,
        "actualizado_en": (
            now if isinstance(now, datetime) else datetime.now()
        ).isoformat(timespec="seconds"),
    }


def reconcile_pending_sunat_jobs(
    validator: SunatValidator,
    store: SunatCacheStore,
    *,
    usuario: str = "",
    max_jobs: int = 50,
    stale_minutes: int = 10,
    now: datetime | None = None,
) -> dict:
    """Close the loop for jobs whose client stopped polling.

    This is the server-side safety net: the validator finishes a batch even
    when the browser is closed, so every pending TrabajoID is reconciled here
    and the local cache is updated without a user request.
    """
    current = now if isinstance(now, datetime) else datetime.now()
    stale = 0
    try:
        stale = int(
            store.mark_stale_unsubmitted(
                stale_minutes,
                "Envío no confirmado; reintentar.",
            )
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("SUNAT stale submit cleanup failed: %s", type(exc).__name__)
    try:
        jobs = store.pending_jobs(max(1, int(max_jobs)))
    except Exception as exc:  # noqa: BLE001
        logger.warning("SUNAT pending jobs read failed: %s", type(exc).__name__)
        jobs = []
    resumen = {
        "jobs": len(jobs),
        "reconciliados": 0,
        "pendientes": 0,
        "errores": stale,
    }
    for job in jobs:
        try:
            job_id = int(job.get("TrabajoID"))
        except (TypeError, ValueError):
            continue
        try:
            result = sunat_job_status(
                validator,
                store,
                trabajo_id=job_id,
                usuario=usuario,
                now=current,
            )
        except UpstreamError as exc:
            if getattr(exc, "http_status", None) == 404:
                try:
                    resumen["errores"] += int(
                        store.mark_job_missing(
                            job_id,
                            "Trabajo SUNAT no encontrado; reintentar.",
                        )
                    )
                except Exception as store_exc:  # noqa: BLE001
                    logger.warning(
                        "SUNAT job %s cleanup failed: %s",
                        job_id,
                        type(store_exc).__name__,
                    )
            else:
                logger.warning(
                    "SUNAT job %s reconcile failed: %s",
                    job_id,
                    type(exc).__name__,
                )
            continue
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "SUNAT job %s reconcile failed: %s",
                job_id,
                type(exc).__name__,
            )
            continue
        resumen["reconciliados"] += 1
        resumen["pendientes"] += int(result.get("pendientes") or 0)
    return resumen


def sunat_revalidate(
    validator: SunatValidator,
    store: SunatCacheStore,
    *,
    tipo: str,
    number: str,
    date_iso: str,
    importe: object,
    usuario: str,
    ruc: str,
) -> dict:
    """Manual single-doc revalidation (forces fresh SUNAT query)."""
    payload = _sunat_doc_payload(ruc.strip(), tipo, number, date_iso, importe)
    payload["forzar_consulta"] = True
    body = validator.validate_single(payload, usuario=usuario, origen="syner-check")
    resultado = body.get("resultado", {}) if isinstance(body, dict) else {}
    estado = _sunat_map_estado(resultado.get("estado"))
    key = (payload["ruc"], payload["tipo"], payload["serie"], payload["numero"])
    try:
        previous = store.fetch_many([key]).get(key, {})
        store.upsert(
            {
                "Ruc": key[0],
                "Tipo": key[1],
                "Serie": key[2],
                "Numero": key[3],
                "Estado": estado,
                "CodigoSunat": str(resultado.get("codigo_sunat", "")),
                "RucEstado": str(resultado.get("ruc_estado", "")),
                "RucCondicion": str(resultado.get("ruc_condicion", "")),
                "Observaciones": resultado.get("observaciones", []),
                "Importe": payload["importe"],
                "FechaEmision": payload["fecha_emision"],
                "ConsultaID": body.get("consulta_id"),
                "CorrelationID": str(body.get("correlation_id", "")),
                "Intentos": int(previous.get("Intentos") or 0) + 1,
                "UsuarioOrigen": (usuario or "")[:100],
            }
        )
    except Exception as exc:
        logger.warning(
            "Sunat cache upsert failed for %s: %s", key[2:], type(exc).__name__
        )
    return {"estado": estado, "resultado": resultado if isinstance(resultado, dict) else {}}


def attach_sunat_status(
    entries: list[dict],
    store: SunatCacheStore,
    ruc: str,
) -> None:
    """Attach cached {estado, fecha_consulta} to voucher entries in place.

    Cache reads only: zero SUNAT calls. Missing rows leave sunat=None.
    """
    if store is None or not (ruc or "").strip():
        for entry in entries:
            entry["sunat"] = None
        return
    keys: list[tuple[str, str, str, str]] = []
    order: list[tuple[str, str, str, str] | None] = []
    for entry in entries:
        data = entry if isinstance(entry, dict) else {}
        key = _sunat_key(
            ruc.strip(), data.get("tipo", ""), data.get("number", "")
        )
        order.append(key)
        if key is not None:
            keys.append(key)
    try:
        cached = store.fetch_many(keys)
    except Exception as exc:
        logger.warning(
            "Sunat cache read failed; continuing without status: %s",
            type(exc).__name__,
        )
        for entry in entries:
            entry["sunat"] = None
        return
    for entry, key in zip(entries, order):
        row = cached.get(key) if key is not None else None
        if row is None:
            entry["sunat"] = None
        else:
            entry["sunat"] = {
                "estado": str(row.get("Estado", "")),
                "fecha_consulta": str(row.get("FechaConsulta", "")),
            }
