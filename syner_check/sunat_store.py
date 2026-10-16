"""Read/write access to dbo.SunatValidacion (Pu_synerpos, writer account).

The writer connection never uses ApplicationIntent=ReadOnly and its login
holds only SELECT+INSERT+UPDATE on this table (least privilege).
Secrets policy: nothing here logs credentials or the API key.
"""

from __future__ import annotations

import json
from typing import Any, Sequence

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


def _connection():
    from .config import get_sunat_db_config, get_sunat_db_password
    from .db_client import connect

    cfg = get_sunat_db_config()
    return connect(cfg, get_sunat_db_password())


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


def fetch_many(
    keys: Sequence[tuple[str, str, str, str]],
) -> dict[tuple[str, str, str], dict[str, Any]]:
    """Fetch cache rows for SUNAT identity keys (chunked, parameterized)."""
    wanted = [
        (str(r).strip(), str(t).strip(), str(s).strip().upper(), str(n).strip())
        for r, t, s, n in keys
    ]
    wanted = [k for k in wanted if all(k)]
    if not wanted:
        return {}
    from .db_client import _to_iso_date  # reuse date normalization

    table = _table()
    cols = ", ".join(f"[{c}]" for c in CACHE_COLUMNS)
    out: dict[tuple[str, str, str], dict[str, Any]] = {}
    cn = _connection()
    try:
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
    finally:
        cn.close()


def upsert(row: dict[str, Any]) -> None:
    """UPDATE else INSERT one cache row (no MERGE). Timestamps server-side."""
    table = _table()
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
        "Importe": row.get("Importe"),
        "FechaEmision": str(row.get("FechaEmision", ""))[:10] or None,
        "ConsultaID": row.get("ConsultaID"),
        "CorrelationID": _to_str(row.get("CorrelationID"))[:100] or None,
        "TrabajoID": row.get("TrabajoID"),
        "Intentos": row.get("Intentos", 0),
        "UltimoError": _to_str(row.get("UltimoError"))[:500] or None,
        "UsuarioOrigen": _to_str(row.get("UsuarioOrigen"))[:100] or None,
    }
    cn = _connection()
    try:
        cur = cn.cursor()
        cur.execute(
            f"""UPDATE {table} SET [Estado] = ?, [CodigoSunat] = ?,
                [RucEstado] = ?, [RucCondicion] = ?, [Observaciones] = ?,
                [Importe] = ?, [FechaEmision] = ?, [ConsultaID] = ?,
                [CorrelationID] = ?, [TrabajoID] = ?,
                [Intentos] = ?, [UltimoError] = ?, [UsuarioOrigen] = ?,
                [FechaActualizacion] = SYSDATETIME()
                WHERE [Ruc] = ? AND [Tipo] = ? AND [Serie] = ? AND [Numero] = ?""",
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
        )
        if cur.rowcount == 0:
            cur.execute(
                f"""INSERT INTO {table} ([Ruc],[Tipo],[Serie],[Numero],[Estado],
                    [CodigoSunat],[RucEstado],[RucCondicion],[Observaciones],
                    [Importe],[FechaEmision],[ConsultaID],[CorrelationID],
                    [TrabajoID],[Intentos],[UltimoError],[UsuarioOrigen])
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
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
        cn.commit()
    finally:
        cn.close()
