"""Use cases. Orchestrate ports only; no FastAPI/SQL/GraphQL imports."""

from __future__ import annotations

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
    gql = gateway.summary(start_iso, end_iso, tipo_values)
    sql = reader.fetch_documents(start_iso, end_iso, tipo_values)

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
    tipos: Sequence[TipoDocumento],
    start_iso: str | None,
    end_iso: str | None,
    max_range_days: int,
    fallback_days: int,
    today: date,
) -> dict:
    cleaned = (number or "").strip()
    if not cleaned:
        raise InvalidRangeError("Provide a document number.")
    if bool(start_iso) != bool(end_iso):
        raise InvalidRangeError("Provide both dates or neither.")
    tipo_values = [t.value for t in tipos]

    if start_iso and end_iso:
        FechaRango.from_iso(start_iso, end_iso, max_range_days)

    rows = reader.fetch_by_number(cleaned, tipo_values, start_iso, end_iso)
    if rows:
        results: list[dict] = []
        seen: set[tuple[str, str, str]] = set()
        cache: dict[tuple[str, str], list[dict]] = {}
        for row in rows:
            tipo = str(row.get("TipoDocumento", ""))
            doc_date = str(row.get("FechaDocumento", ""))
            key = (tipo, doc_date)
            if key not in cache:
                cache[key] = gateway.detail(tipo, doc_date, doc_date, cleaned)
            for doc in cache[key]:
                marker = (tipo, str(doc.get("oid", "")), doc_date)
                if marker in seen:
                    continue
                seen.add(marker)
                results.append({**doc, "tipo": tipo, "in_sql": True, "sql": row})
        return {"results": results, "source": "sql_index"}

    start = date.fromisoformat(start_iso) if start_iso else today - timedelta(days=fallback_days)
    end = date.fromisoformat(end_iso) if end_iso else today
    if (end - start).days + 1 > max_range_days:
        end = start + timedelta(days=max_range_days - 1)

    out: list[dict] = []
    for tipo in tipo_values:
        for doc in gateway.detail(tipo, _iso(start), _iso(end), cleaned):
            out.append({**doc, "tipo": tipo, "in_sql": False})
    return {
        "results": out,
        "source": "graphql_fallback",
        "searched_range": {"start": _iso(start), "end": _iso(end)},
    }


def get_detail(
    gateway: GraphqlGateway,
    *,
    tipo: TipoDocumento,
    oid: str,
    doc_date_iso: str,
) -> dict:
    FechaRango.from_iso(doc_date_iso, doc_date_iso, 1_000_000)
    for doc in gateway.detail(tipo.value, doc_date_iso, doc_date_iso):
        if compare_digest(str(doc.get("oid", "")), oid):
            return {"document": {**doc, "tipo": tipo.value}}
    raise NotFoundError("Document not found.")
