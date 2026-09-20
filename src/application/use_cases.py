"""Use cases. Orchestrate ports only; no FastAPI/SQL/GraphQL imports."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from hmac import compare_digest
from typing import Sequence

from src.domain.entities import FechaRango, TipoDocumento
from src.domain.errors import InvalidRangeError, NotFoundError

from .ports import GraphqlGateway, SqlDocumentReader


def _iso(d: date) -> str:
    return d.isoformat()


def summarize(
    reader: SqlDocumentReader,
    gateway: GraphqlGateway,
    *,
    start_iso: str,
    end_iso: str,
    tipos: Sequence[TipoDocumento],
    max_range_days: int,
) -> dict:
    FechaRango.from_iso(start_iso, end_iso, max_range_days)
    tipo_values = [t.value for t in tipos]
    # GraphQL and SQL reads are independent: run them concurrently so total
    # latency is max(graphql, sql) instead of graphql + sql.
    with ThreadPoolExecutor(max_workers=2) as pool:
        gql_future = pool.submit(gateway.summary, start_iso, end_iso, tipo_values)
        sql_future = pool.submit(reader.fetch_documents, start_iso, end_iso, tipo_values)
        gql = gql_future.result()
        sql = sql_future.result()

    sql_by_type: dict[str, list[dict]] = {t: [] for t in tipo_values}
    for row in sql:
        sql_by_type.setdefault(str(row.get("TipoDocumento", "")), []).append(row)

    out: dict[str, list[dict]] = {}
    for tipo in tipo_values:
        docs = gql.get(tipo, [])
        sql_keys = {
            (str(r.get("IDSynerPos", "")).strip().upper(), str(r.get("FechaDocumento", "")))
            for r in sql_by_type.get(tipo, [])
        }
        rows = []
        for doc in docs:
            key = (str(doc.get("oid", "")).strip().upper(), str(doc.get("date", ""))[:10])
            rows.append({**doc, "tipo": tipo, "in_sql": key in sql_keys})
        out[tipo] = rows
    return {
        "documents": out,
        "sql_count": len(sql),
        "graphql_count": sum(len(v) for v in gql.values()),
        "range": {"start": start_iso, "end": end_iso},
    }


def search_by_number(
    reader: SqlDocumentReader,
    gateway: GraphqlGateway,
    *,
    number: str,
    fallback_days: int,
    today: date,
) -> dict:
    """Find one voucher by number across all document types.

    FACTURA and BOLETA use the server-side `serie` filter (direct number
    lookup, no date range). NOTA DE CREDITO has no `serie` support, so it
    uses date-scoped summaries (the SQL rows' dates when indexed, else the
    last ``fallback_days`` days). The local SQL index decides `source` and
    `in_sql`; GraphQL provides the display fields.
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

    out: dict = {"results": results, "source": source}
    if searched_range is not None:
        out["searched_range"] = searched_range
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
