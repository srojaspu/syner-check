"""Read/write access to dbo.SunatValidacion (Pu_synerpos, writer account).

The writer connection never uses ApplicationIntent=ReadOnly and its login
holds only SELECT+INSERT+UPDATE on this table (least privilege).
Secrets policy: nothing here logs credentials or the API key.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Sequence

logger = logging.getLogger("syner_check.sunat_store")

CACHE_COLUMNS = (
    "Ruc",
    "Tipo",
    "Serie",
    "Numero",
    "Estado",
    "CodigoSunat",
    "RucEstado",
    "RucCondicion",
    "Observaciones",
    "Importe",
    "FechaEmision",
    "ConsultaID",
    "CorrelationID",
    "TrabajoID",
    "Intentos",
    "UltimoError",
    "FechaConsulta",
    "FechaActualizacion",
    "UsuarioOrigen",
)

_CACHE_KEY = ("Ruc", "Tipo", "Serie", "Numero")

_CHUNK = 200


def _connection_args():
    from .config import get_sunat_db_config, get_sunat_db_password

    return get_sunat_db_config(), get_sunat_db_password()


def _table() -> str:
    from .config import get_sunat_db_config
    from .db_client import quote_table_name

    return quote_table_name(get_sunat_db_config()["table"])


def _to_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _to_iso_datetime(value: Any) -> str:
    """FechaConsulta with time (TTL needs hours, not just the date)."""
    from datetime import date as _date
    from datetime import datetime as _dt

    if value is None:
        return ""
    if isinstance(value, _dt):
        return value.isoformat(timespec="seconds")
    if isinstance(value, _date):
        return value.isoformat()
    text = str(value).strip()
    return text[:19] if text else ""


def _to_amount(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int_or_none(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def fetch_many(
    keys: Sequence[tuple[str, str, str, str]],
) -> dict[tuple[str, str, str, str], dict[str, Any]]:
    """Fetch cache rows for SUNAT identity keys (chunked, parameterized)."""
    wanted = [
        (str(r).strip(), str(t).strip(), str(s).strip().upper(), str(n).strip())
        for r, t, s, n in keys
    ]
    wanted = [k for k in wanted if all(k)]
    if not wanted:
        return {}
    from .db_client import _to_iso_date  # reuse date normalization
    from .db_pool import pooled_connection

    table = _table()
    cols = ", ".join(f"[{c}]" for c in CACHE_COLUMNS)
    out: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    cfg, password = _connection_args()
    with pooled_connection(cfg, password) as cn:
        cur = cn.cursor()
        for pos in range(0, len(wanted), _CHUNK):
            batch = wanted[pos : pos + _CHUNK]
            where = " OR ".join(
                "([Ruc] = ? AND [Tipo] = ? AND [Serie] = ? AND [Numero] = ?)"
                for _ in batch
            )
            params: list[str] = []
            for key in batch:
                params.extend(key)
            cur.execute(f"SELECT {cols} FROM {table} WHERE {where}", *params)
            names = [c[0] for c in cur.description]
            for record in cur.fetchall():
                row = dict(zip(names, record))
                key = (
                    _to_str(row.get("Ruc")),
                    _to_str(row.get("Tipo")),
                    _to_str(row.get("Serie")),
                    _to_str(row.get("Numero")),
                )
                row["FechaEmision"] = _to_iso_date(row.get("FechaEmision"))
                out[key] = {k: _to_str(row.get(k)) for k in CACHE_COLUMNS}
                out[key]["FechaConsulta"] = _to_iso_datetime(
                    row.get("FechaConsulta")
                )
    return out


def _prepare(row: dict[str, Any]) -> tuple[tuple[str, str, str, str], dict[str, Any]]:
    """Validate/normalize one cache row into (identity key, column values)."""
    key = (
        str(row.get("Ruc", "")).strip(),
        str(row.get("Tipo", "")).strip(),
        str(row.get("Serie", "")).strip().upper(),
        str(row.get("Numero", "")).strip(),
    )
    if not all(key):
        raise ValueError("Sunat cache row needs Ruc/Tipo/Serie/Numero.")
    obs = row.get("Observaciones", "")
    if isinstance(obs, (list, dict)):
        obs = json.dumps(obs, ensure_ascii=False)
    fecha = row.get("FechaEmision")
    fecha_emision = str(fecha)[:10] if fecha not in (None, "") else None
    data = {
        "Ruc": key[0],
        "Tipo": key[1],
        "Serie": key[2],
        "Numero": key[3],
        "Estado": str(row.get("Estado", "PENDIENTE")).strip().upper() or "PENDIENTE",
        "CodigoSunat": _to_str(row.get("CodigoSunat")),
        "RucEstado": _to_str(row.get("RucEstado")),
        "RucCondicion": _to_str(row.get("RucCondicion")),
        "Observaciones": _to_str(obs)[:4000],
        "Importe": _to_amount(row.get("Importe")),
        "FechaEmision": fecha_emision,
        "ConsultaID": _to_int_or_none(row.get("ConsultaID")),
        "CorrelationID": _to_str(row.get("CorrelationID"))[:100] or None,
        "TrabajoID": _to_int_or_none(row.get("TrabajoID")),
        "Intentos": _to_int_or_none(row.get("Intentos")) or 0,
        "UltimoError": _to_str(row.get("UltimoError"))[:500] or None,
        "UsuarioOrigen": _to_str(row.get("UsuarioOrigen"))[:100] or None,
    }
    return key, data


_FINAL_STATES = ("ACEPTADO", "ANULADO")
_SETTLED_STATES = (
    "ACEPTADO",
    "ANULADO",
    "NO_EXISTE",
    "AUTORIZADO",
    "NO_AUTORIZADO",
)


def _exists(cur, table: str, key: tuple[str, str, str, str]) -> bool:
    cur.execute(
        f"SELECT 1 FROM {table} WHERE [Ruc] = ? AND [Tipo] = ? "
        "AND [Serie] = ? AND [Numero] = ?",
        *key,
    )
    return cur.fetchone() is not None


def _apply(
    cur, table: str, key: tuple[str, str, str, str], data: dict[str, Any]
) -> None:
    """UPDATE else INSERT one row on an open cursor (no MERGE).

    ``[FechaConsulta]`` is stamped server-side on both paths: the SUNAT TTL
    (``_sunat_fresh``) reads it, so leaving it to a DB default silently
    disabled revalidation.

    State guard: a settled result (SUNAT already answered) must never be
    downgraded back to PENDIENTE/ERROR by a late poll. ACEPTADO/ANULADO are
    immutable; the other settled states can only be replaced by another
    settled state (e.g. NO_EXISTE -> ACEPTADO).
    """
    cur.execute(
        f"""UPDATE {table} SET [Estado] = ?, [CodigoSunat] = ?,
            [RucEstado] = ?, [RucCondicion] = ?, [Observaciones] = ?,
            [Importe] = ?, [FechaEmision] = ?, [ConsultaID] = ?,
            [CorrelationID] = ?, [TrabajoID] = ?,
            [Intentos] = ?, [UltimoError] = ?, [UsuarioOrigen] = ?,
            [FechaConsulta] = SYSDATETIME(),
            [FechaActualizacion] = SYSDATETIME()
            WHERE [Ruc] = ? AND [Tipo] = ? AND [Serie] = ? AND [Numero] = ?
              AND [Estado] NOT IN ('ACEPTADO', 'ANULADO')
              AND ([Estado] NOT IN ('NO_EXISTE', 'AUTORIZADO', 'NO_AUTORIZADO')
                   OR ? IN ('ACEPTADO', 'ANULADO', 'NO_EXISTE',
                            'AUTORIZADO', 'NO_AUTORIZADO'))""",
        data["Estado"],
        data["CodigoSunat"] or None,
        data["RucEstado"] or None,
        data["RucCondicion"] or None,
        data["Observaciones"] or None,
        data["Importe"],
        data["FechaEmision"],
        data["ConsultaID"],
        data["CorrelationID"],
        data["TrabajoID"],
        data["Intentos"],
        data["UltimoError"],
        data["UsuarioOrigen"],
        *key,
        data["Estado"],
    )
    if cur.rowcount == 0:
        # The row may simply not exist, or the guard may have protected a
        # settled state. Never INSERT over an existing key (PK violation).
        if _exists(cur, table, key):
            return
        cur.execute(
            f"""INSERT INTO {table} ([Ruc],[Tipo],[Serie],[Numero],[Estado],
                [CodigoSunat],[RucEstado],[RucCondicion],[Observaciones],
                [Importe],[FechaEmision],[ConsultaID],[CorrelationID],
                [TrabajoID],[Intentos],[UltimoError],[UsuarioOrigen],
                [FechaConsulta])
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,SYSDATETIME())""",
            *key,
            data["Estado"],
            data["CodigoSunat"] or None,
            data["RucEstado"] or None,
            data["RucCondicion"] or None,
            data["Observaciones"] or None,
            data["Importe"],
            data["FechaEmision"],
            data["ConsultaID"],
            data["CorrelationID"],
            data["TrabajoID"],
            data["Intentos"],
            data["UltimoError"],
            data["UsuarioOrigen"],
        )


def upsert(row: dict[str, Any]) -> None:
    """UPDATE else INSERT one cache row (no MERGE). Timestamps server-side."""
    from .db_pool import pooled_connection

    key, data = _prepare(row)
    table = _table()
    cfg, password = _connection_args()
    with pooled_connection(cfg, password) as cn:
        cur = cn.cursor()
        try:
            _apply(cur, table, key, data)
            cn.commit()
        except Exception:
            cn.rollback()
            raise


def upsert_many(rows: Sequence[dict[str, Any]]) -> None:
    """UPDATE/INSERT many rows over ONE connection and ONE transaction.

    A SUNAT batch used to open a connection per voucher (500 docs ≈ 500
    logins/commits). Rows that fail shape validation are logged and skipped;
    any database error rolls the whole chunk back so a partial checkpoint is
    never persisted.
    """
    prepared: list[tuple[tuple[str, str, str, str], dict[str, Any]]] = []
    for row in rows:
        try:
            prepared.append(_prepare(row))
        except (TypeError, ValueError) as exc:
            logger.warning("Sunat cache row skipped: %s", type(exc).__name__)
    if not prepared:
        return
    from .db_pool import pooled_connection

    table = _table()
    cfg, password = _connection_args()
    with pooled_connection(cfg, password) as cn:
        cur = cn.cursor()
        try:
            for key, data in prepared:
                _apply(cur, table, key, data)
            cn.commit()
        except Exception:
            cn.rollback()
            raise


def job_progress(trabajo_id: int) -> dict[str, Any]:
    """Durable per-job counts, independent of the validator being reachable."""
    from .db_pool import pooled_connection

    table = _table()
    cfg, password = _connection_args()
    with pooled_connection(cfg, password) as cn:
        cur = cn.cursor()
        cur.execute(
            f"""SELECT COUNT(*) AS total,
                SUM(CASE WHEN [Estado] IN ('PENDIENTE', 'PROCESANDO')
                         THEN 1 ELSE 0 END) AS pendientes,
                SUM(CASE WHEN [Estado] = 'ERROR' THEN 1 ELSE 0 END) AS errores,
                SUM(CASE WHEN [Estado] IN ('ACEPTADO', 'ANULADO', 'NO_EXISTE',
                                           'AUTORIZADO', 'NO_AUTORIZADO')
                         THEN 1 ELSE 0 END) AS exitosos,
                MIN([FechaActualizacion]) AS primer_cambio,
                MAX([FechaActualizacion]) AS ultimo_cambio
            FROM {table} WHERE [TrabajoID] = ?""",
            int(trabajo_id),
        )
        names = [c[0] for c in cur.description]
        row = dict(zip(names, cur.fetchone()))
    for key in ("total", "pendientes", "errores", "exitosos"):
        row[key] = int(row.get(key) or 0)
    return row


def pending_jobs(limit: int = 50) -> list[dict[str, Any]]:
    """Jobs with at least one PENDIENTE/PROCESANDO row, oldest first."""
    from .db_pool import pooled_connection

    table = _table()
    cfg, password = _connection_args()
    with pooled_connection(cfg, password) as cn:
        cur = cn.cursor()
        cur.execute(
            f"""SELECT [TrabajoID], COUNT(*) AS total,
                SUM(CASE WHEN [Estado] IN ('PENDIENTE', 'PROCESANDO')
                         THEN 1 ELSE 0 END) AS pendientes,
                MAX([FechaActualizacion]) AS ultima_actualizacion
            FROM {table}
            WHERE [TrabajoID] IS NOT NULL
            GROUP BY [TrabajoID]
            HAVING SUM(CASE WHEN [Estado] IN ('PENDIENTE', 'PROCESANDO')
                            THEN 1 ELSE 0 END) > 0
            ORDER BY MAX([FechaActualizacion]) ASC""",
        )
        names = [c[0] for c in cur.description]
        rows = [dict(zip(names, record)) for record in cur.fetchall()]
    for row in rows:
        row["total"] = int(row.get("total") or 0)
        row["pendientes"] = int(row.get("pendientes") or 0)
    return rows[: max(1, int(limit))]


def mark_job_missing(trabajo_id: int, message: str) -> int:
    """Turn pending rows of a terminal-but-missing job into retryable ERRORs."""
    from .db_pool import pooled_connection

    table = _table()
    cfg, password = _connection_args()
    with pooled_connection(cfg, password) as cn:
        cur = cn.cursor()
        try:
            cur.execute(
                f"""UPDATE {table}
                SET [Estado] = 'ERROR', [UltimoError] = ?,
                    [FechaActualizacion] = SYSDATETIME()
                WHERE [TrabajoID] = ?
                  AND [Estado] IN ('PENDIENTE', 'PROCESANDO')""",
                (message or "SUNAT no devolvió resultado.")[:500],
                int(trabajo_id),
            )
            affected = int(cur.rowcount)
            cn.commit()
        except Exception:
            cn.rollback()
            raise
    return affected


def mark_stale_unsubmitted(older_than_minutes: int, message: str) -> int:
    """Close rows whose submit crashed before a TrabajoID was persisted."""
    from .db_pool import pooled_connection

    table = _table()
    cfg, password = _connection_args()
    minutes = max(1, int(older_than_minutes))
    with pooled_connection(cfg, password) as cn:
        cur = cn.cursor()
        try:
            cur.execute(
                f"""UPDATE {table}
                SET [Estado] = 'ERROR', [UltimoError] = ?,
                    [FechaActualizacion] = SYSDATETIME()
                WHERE [TrabajoID] IS NULL
                  AND [Estado] IN ('PENDIENTE', 'PROCESANDO')
                  AND [FechaActualizacion] < DATEADD(MINUTE, -?, SYSDATETIME())""",
                (message or "Envío no confirmado; reintentar.")[:500],
                minutes,
            )
            affected = int(cur.rowcount)
            cn.commit()
        except Exception:
            cn.rollback()
            raise
    return affected
