"""SQL Server read client built from env config (see config.get_db_config).

Secrets policy: connection values are used to open the connection but are
never logged, printed or returned. Errors only mention variable NAMES.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

_TABLE_NAME_RE = re.compile(r"^[A-Za-z0-9_\.\[\]]+$")
_TABLE_PART_RE = re.compile(r"^[A-Za-z0-9_]+$")

SQL_DOCUMENT_COLUMNS = (
    "IDSynerPos",
    "TipoDocumento",
    "Sku",
    "FechaDocumento",
    "SerieNumero",
)

ALLOWED_TIPOS = ("FACTURA", "BOLETA", "NOTA DE CREDITO")


def quote_table_name(table: str) -> str:
    """
    Validate TABLE_NAME as a plain identifier and quote it with brackets.

    Accepts [schema.]table or db.schema.table forms and respects each
    part; raises ValueError on anything else (SQL injection guard).
    """
    if not table or not _TABLE_NAME_RE.match(table):
        raise ValueError(
            "Invalid TABLE_NAME: only letters, digits, '_', '.', "
            "'[' and ']' are allowed."
        )
    parts = table.split(".")
    if len(parts) > 3:
        raise ValueError(
            "Invalid TABLE_NAME: at most db.schema.table "
            "(3 dot-separated parts)."
        )
    quoted: list[str] = []
    for raw_part in parts:
        part = raw_part.strip()
        if part.startswith("[") and part.endswith("]") and len(part) >= 3:
            inner = part[1:-1].strip()
        else:
            inner = part
        if not inner or not _TABLE_PART_RE.match(inner):
            raise ValueError(
                "Invalid TABLE_NAME: each dot-separated part must be "
                "a plain identifier ([A-Za-z0-9_])."
            )
        quoted.append(f"[{inner}]")
    return ".".join(quoted)


def qualified_table_name(table: str) -> str:
    """``quote_table_name`` con esquema ``dbo`` cuando falta.

    Lecturas y escrituras deben resolver la misma tabla a partir del mismo
    ``TABLE_NAME``. Sin esquema explícito la resolución depende del esquema
    por defecto del login, así que un ``TABLE_NAME=MovSynerPosQA`` podría
    apuntar a tablas distintas según la cuenta.

    Acepta ``tabla``, ``esquema.tabla`` y ``base.esquema.tabla``.
    """
    text = str(table or "").strip()
    if "." not in text:
        text = f"dbo.{text}"
    return quote_table_name(text)


def build_connection_string(db_config: dict[str, Any], password: str) -> str:
    """Build the ODBC connection string. Callers must never log it."""
    server = db_config["server"]
    if db_config.get("port"):
        server = f"{server},{db_config['port']}"
    elif db_config.get("instance"):
        server = f"{server}\\{db_config['instance']}"
    parts = [
        f"DRIVER={{{db_config['driver']}}}",
        f"SERVER={server}",
        f"DATABASE={db_config['database']}",
        f"Encrypt={db_config.get('encrypt', 'yes')}",
        f"TrustServerCertificate={db_config.get('trust_server_certificate', 'no')}",
    ]
    if db_config.get("trusted") is True:
        parts.append("Trusted_Connection=yes")
    else:
        parts.append(f"UID={db_config['uid']}")
        parts.append(f"PWD={password}")
    parts.append(f"Connection Timeout={db_config.get('timeout', 30)}")
    if db_config.get("application_intent_read_only", True):
        parts.append("ApplicationIntent=ReadOnly")
    return ";".join(parts) + ";"


def connect(db_config: dict[str, Any], password: str):
    """Open a pyodbc connection without logging any secret."""
    try:
        import pyodbc
    except ImportError as exc:
        raise RuntimeError(
            "pyodbc is required for --compare but is not installed."
        ) from exc
    connection_string = build_connection_string(db_config, password)
    try:
        return pyodbc.connect(connection_string)
    except Exception as exc:
        # Never include the connection string (it holds secrets).
        raise RuntimeError(
            "Could not connect to SQL Server. Check DB_HOST, DB_NAME "
            f"and credentials. Driver reported: {exc}"
        ) from exc


def _to_iso_date(value: Any) -> str:
    """Normalize FechaDocumento to an ISO string (date part only)."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    if not text:
        return ""
    for candidate in (text, text.replace("Z", "+00:00")):
        try:
            return datetime.fromisoformat(candidate).date().isoformat()
        except ValueError:
            continue
    return text[:10]


def _to_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def fetch_sql_documents(
    start_date: str,
    end_date: str,
    tipos: list[str] | tuple[str, ...] | None = None,
) -> list[dict[str, Any]]:
    """
    Fetch documents whose FechaDocumento falls in [start_date, end_date].

    ONE query, only needed cols, sargable date range + TipoDocumento filter.
    Dates are passed as parameters (never interpolated). TipoDocumento values
    come from an allowlist (never raw user input). Returns a list of dicts
    with values normalized to str, except FechaDocumento as ISO date string.
    """
    from .config import get_db_config, get_db_password
    from .db_pool import pooled_connection

    wanted = [t for t in (tipos or ALLOWED_TIPOS) if t in ALLOWED_TIPOS]
    if not wanted:
        wanted = list(ALLOWED_TIPOS)
    db_config = get_db_config()  # raises naming the missing env var
    password = get_db_password()
    table = qualified_table_name(db_config["table"])
    columns = ", ".join(f"[{col}]" for col in SQL_DOCUMENT_COLUMNS)
    placeholders = ", ".join("?" for _ in wanted)
    query = (
        f"SELECT {columns} FROM {table} "
        "WHERE [FechaDocumento] >= ? "
        "AND [FechaDocumento] < DATEADD(DAY, 1, ?) "
        f"AND [TipoDocumento] IN ({placeholders})"
    )
    with pooled_connection(db_config, password) as connection:
        cursor = connection.cursor()
        cursor.execute(query, start_date, end_date, *wanted)
        columns_out = [col[0] for col in cursor.description]
        rows: list[dict[str, Any]] = []
        for record in cursor.fetchall():
            row = dict(zip(columns_out, record))
            rows.append(
                {
                    "IDSynerPos": _to_str(row.get("IDSynerPos")),
                    "TipoDocumento": _to_str(row.get("TipoDocumento")),
                    "Sku": _to_str(row.get("Sku")),
                    "FechaDocumento": _to_iso_date(
                        row.get("FechaDocumento")
                    ),
                    "SerieNumero": _to_str(row.get("SerieNumero")),
                }
            )
        return rows


# --- Intelisis (Punidas) reader: Venta cabecera, solo origen SynerPOS ---
#
# Sintesis de docs/querys/punidas.sql (base sargable) con el aporte
# diagnostico de docs/querys/bfn.sql (MovTipo como LEFT no excluyente).
# Solo Mov SE-* (origen SynerPOS); la llave de comparacion con MovSynerPos es
# (TransactionType, ReceiptNumber, FechaEmision) porque V.ID (identidad
# Intelisis) no equals IDSynerPos/oid (secuencias distintas).
# Venta es cabecera (sin Sku): fase 1 compara cabecera; linea via VentaD
# queda como fase 2.
# StoreName usa S.Nombre directo (sin dbo.fn_LimpiaTexto: la cuenta
# read-only no tiene EXECUTE sobre la funcion, verificado 2026-10-16).
# ReceiptNumber: F-factura, B-resto (las NC de SynerPOS usan prefijo B en
# MovSynerPos/GraphQL, y su MovID trae forma '<suc>-B<correlativo>':
# se recortan los no-digitos iniciales). Sin filtro de Estatus: se trae
# PENDIENTE/SINAFECTAR tambien y se expone EstatusIntelisis para distinguir
# "llego pendiente de conclusion" de "no llego" (verificado 2026-10-17).

INTELISIS_MOVS = ("SE-Boleta", "SE-Factura", "SE-Nota Credito")

INTELISIS_HEADERS_QUERY = """
SELECT
  V.ID AS IntelisisID,
  V.Mov,
  V.MovID,
  StoreName = LTRIM(RTRIM(S.Nombre)),
  TransactionType =
    CASE WHEN V.Mov = 'SE-Factura' THEN 'factura'
         WHEN V.Mov = 'SE-Nota Credito' THEN 'nota_credito'
         ELSE 'boleta' END,
  ReceiptNumber =
    CASE WHEN V.Mov = 'SE-Factura' THEN 'F' ELSE 'B' END
    + COALESCE(S.MapaUbicacion, CAST(S.Sucursal AS VARCHAR(10)))
    + '-' + RIGHT('00000000' + STUFF(
        STUFF(V.MovID, 1, NULLIF(CHARINDEX('-', V.MovID), 0), ''),
        1,
        PATINDEX('%[0-9]%',
          STUFF(V.MovID, 1, NULLIF(CHARINDEX('-', V.MovID), 0), '') + '0') - 1,
        ''
      ), 8),
  V.FechaEmision,
  EstatusIntelisis = V.Estatus,
  SerieSUNAT = LTRIM(RTRIM(B.SeriePU)),
  TipoDocSUNAT = B.TipoDocumentoPU
FROM dbo.Venta V WITH (NOLOCK)
JOIN dbo.Sucursal S WITH (NOLOCK) ON V.Sucursal = S.Sucursal
LEFT JOIN dbo.MovTipo B WITH (NOLOCK)
  ON B.Modulo = 'VTAS' AND B.Mov = V.Mov
WHERE V.Empresa = 'PU'
  AND V.Mov IN ('SE-Boleta', 'SE-Factura', 'SE-Nota Credito')
  AND V.FechaEmision >= ?
  AND V.FechaEmision < DATEADD(DAY, 1, ?)
"""


def fetch_intelisis_headers(
    start_date: str,
    end_date: str,
) -> list[dict[str, Any]]:
    """Fetch Intelisis/Venta headers (SynerPOS origin) for [start, end].

    Sargable date range + Mov allowlist (never raw user input), NOLOCK +
    ApplicationIntent=ReadOnly (see config). Returns dicts with
    FechaEmision normalized to ISO date string.
    """
    from .config import get_intelisis_config, get_intelisis_password
    from .db_pool import pooled_connection

    db_config = get_intelisis_config()
    password = get_intelisis_password()
    with pooled_connection(db_config, password) as connection:
        cursor = connection.cursor()
        cursor.execute(INTELISIS_HEADERS_QUERY, start_date, end_date)
        columns_out = [col[0] for col in cursor.description]
        rows: list[dict[str, Any]] = []
        for record in cursor.fetchall():
            row = dict(zip(columns_out, record))
            rows.append(
                {
                    "IntelisisID": _to_str(row.get("IntelisisID")),
                    "Mov": _to_str(row.get("Mov")),
                    "MovID": _to_str(row.get("MovID")),
                    "StoreName": _to_str(row.get("StoreName")),
                    "TransactionType": _to_str(
                        row.get("TransactionType")
                    ),
                    "ReceiptNumber": _to_str(row.get("ReceiptNumber")),
                    "FechaEmision": _to_iso_date(row.get("FechaEmision")),
                    "EstatusIntelisis": _to_str(row.get("EstatusIntelisis")),
                    "SerieSUNAT": _to_str(row.get("SerieSUNAT")),
                    "TipoDocSUNAT": _to_str(row.get("TipoDocSUNAT")),
                }
            )
        return rows
