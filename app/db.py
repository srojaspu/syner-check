from __future__ import annotations

from syner_check.config import (
    get_db_config,
    get_db_password,
    is_intelisis_configured,
)
from syner_check.db_client import (
    ALLOWED_TIPOS,
    _to_iso_date,
    _to_str,
    quote_table_name,
)
from syner_check.db_pool import pooled_connection


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
    with pooled_connection(get_db_config(), get_db_password()) as connection:
        cur = connection.cursor()
        cur.execute(query, start_date, end_date, *wanted)
        cols = [c[0] for c in cur.description]
        return [_normalize_row(cols, row) for row in cur.fetchall()]


def fetch_by_number(
    number: str,
    tipos: list[str] | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
):
    wanted = [t for t in (tipos or ALLOWED_TIPOS) if t in ALLOWED_TIPOS]
    if not wanted:
        # Never fall through to `IN ()`: reject-all is a syntax error.
        wanted = list(ALLOWED_TIPOS)
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
    with pooled_connection(get_db_config(), get_db_password()) as cn:
        cur = cn.cursor()
        cur.execute(query, *params)
        cols = [c[0] for c in cur.description]
        rows = []
        for row in cur.fetchall():
            rows.append(_normalize_row(cols, row))
        return rows


def intelisis_enabled() -> bool:
    return is_intelisis_configured()


def fetch_intelisis_documents(start_date: str, end_date: str) -> list[dict]:
    """Read-only fetch of Intelisis/Venta headers (SynerPOS origin).

    Raises when INTELISIS_* is missing; callers treat that as degraded
    (intelisis_enabled=False) instead of failing the whole summary.
    """
    from syner_check import config as cfg
    from syner_check import db_client as client

    if not cfg.is_intelisis_configured():
        raise RuntimeError("Missing required DB env var: INTELISIS_HOST.")
    db_config = cfg.get_intelisis_config()
    with pooled_connection(
        db_config, cfg.get_intelisis_password()
    ) as cn:
        cur = cn.cursor()
        cur.execute(client.INTELISIS_HEADERS_QUERY, start_date, end_date)
        cols = [c[0] for c in cur.description]
        out = []
        for row in cur.fetchall():
            data = dict(zip(cols, row))
            out.append(
                {
                    "IntelisisID": _to_str(data.get("IntelisisID")),
                    "Mov": _to_str(data.get("Mov")),
                    "MovID": _to_str(data.get("MovID")),
                    "StoreName": _to_str(data.get("StoreName")),
                    "TransactionType": _to_str(
                        data.get("TransactionType")
                    ),
                    "ReceiptNumber": _to_str(data.get("ReceiptNumber")),
                    "FechaEmision": (
                        _to_iso_date(data.get("FechaEmision"))
                    ),
                    "EstatusIntelisis": _to_str(
                        data.get("EstatusIntelisis")
                    ),
                    "SerieSUNAT": _to_str(data.get("SerieSUNAT")),
                    "TipoDocSUNAT": _to_str(data.get("TipoDocSUNAT")),
                }
            )
        return out
