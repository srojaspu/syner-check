from __future__ import annotations

from syner_check.config import get_db_config, get_db_password
from syner_check.db_client import (
    ALLOWED_TIPOS,
    _to_iso_date,
    _to_str,
    connect,
    quote_table_name,
)


def _connection():
    return connect(get_db_config(), get_db_password())


def _normalize_row(cols: list[str], row: tuple) -> dict:
    return {
        c: (_to_iso_date(v) if c == "FechaDocumento" else _to_str(v))
        for c, v in zip(cols, row)
    }


def fetch_documents(
    start_date: str, end_date: str, tipos: list[str] | None = None
):
    wanted = [t for t in (tipos or ALLOWED_TIPOS) if t in ALLOWED_TIPOS]
    if not wanted:
        wanted = list(ALLOWED_TIPOS)
    cfg = get_db_config()
    table = quote_table_name(cfg["table"])
    placeholders = ", ".join("?" for _ in wanted)
    query = f"""SELECT [IDSynerPos],[TipoDocumento],[Sku],[FechaDocumento],[SerieNumero]
              FROM {table}
              WHERE [FechaDocumento] >= ? AND [FechaDocumento] < DATEADD(DAY,1,?)
              AND [TipoDocumento] IN ({placeholders})"""
    cn = _connection()
    try:
        cur = cn.cursor()
        cur.execute(query, start_date, end_date, *wanted)
        cols = [c[0] for c in cur.description]
        return [_normalize_row(cols, row) for row in cur.fetchall()]
    finally:
        cn.close()


def fetch_by_number(
    number: str,
    tipos: list[str] | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
):
    wanted = [t for t in (tipos or ALLOWED_TIPOS) if t in ALLOWED_TIPOS]
    cfg = get_db_config()
    table = quote_table_name(cfg["table"])
    placeholders = ", ".join("?" for _ in wanted)
    filters = ["[SerieNumero] = ?", f"[TipoDocumento] IN ({placeholders})"]
    params = [number.strip(), *wanted]
    if start_date:
        filters.append("[FechaDocumento] >= ?")
        params.append(start_date)
    if end_date:
        filters.append("[FechaDocumento] < DATEADD(DAY,1,?)")
        params.append(end_date)
    query = f"""SELECT [IDSynerPos],[TipoDocumento],[Sku],[FechaDocumento],[SerieNumero]
              FROM {table} WHERE {' AND '.join(filters)}
              ORDER BY [FechaDocumento] DESC"""
    cn = _connection()
    try:
        cur = cn.cursor()
        cur.execute(query, *params)
        cols = [c[0] for c in cur.description]
        rows = []
        for row in cur.fetchall():
            rows.append(_normalize_row(cols, row))
        return rows
    finally:
        cn.close()
