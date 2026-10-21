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


# --- Intelisis (Punidas): comprobantes del universo UFE --------------------
#
# Copia corregida de ``dbo.PUSP_ControlFac`` (D22). El SP es un wrapper de
# solo lectura que se ejecuta dia por dia; esta consulta devuelve todo el
# rango en una vuelta y agrega el ultimo intento de la bitacora.
#
# Diferencias respecto del SP (a proposito):
#   - Rango de fechas sargable en vez de ``day(FechaEmision) = @Dia`` (el SP
#     obligaba a un EXEC por dia y no usaba indices).
#   - ``Empresa = 'PU'`` explicito (el SP no filtra y hoy solo PU tiene
#     ventas ``E-*``, pero es latente).
#   - ``EXISTS`` sobre ``MovTipo.Clave`` en vez de ``LEFT JOIN`` + filtro:
#     misma universo, sin depender del cardinal de ``MovTipo``.
#   - Se agregan los campos que el generador usa para calcular la identidad
#     del documento (``ServicioSerie``, ``SeriePU``, ``GenerarTxtPeru``); el
#     numero oficial sale de la bitacora (``Documento``).
#   - Sin el ``CASE`` de ``Comprobante``: es una reconstruccion del numero
#     que el generador ya escribio en la bitacora.
#
# Referencia: definicion de ``dbo.PUSP_ControlFac`` leida el 2026-10-21
# (sha256 a9c0cff45abd1a1d08d8ee776930fe519274693b6264c9314588deb1443732dd).
# Si el SP cambia, hay que actualizar esta copia (runbook, seccion 5).

INTELISIS_UFE_SCOPE_RANGO = (
    "V.FechaEmision >= ? AND V.FechaEmision < DATEADD(DAY, 1, ?)"
)
INTELISIS_UFE_SCOPE_ID = "V.ID = ?"

_INTELISIS_UFE_BASE = """
WITH Ufe AS (
    SELECT
        V.ID AS IDVenta,
        V.Mov,
        V.MovID,
        V.FechaEmision,
        V.Estatus,
        V.Sucursal,
        V.Importe,
        V.Impuestos,
        V.Referencia,
        V.Cliente,
        V.ServicioSerie,
        B.TipoDocumentoPU,
        B.SeriePU,
        B.GenerarTxtPeru,
        SucursalNombre = LTRIM(RTRIM(S.Nombre)),
        ClienteNombre = LTRIM(RTRIM(C.Nombre)),
        ClienteRfc = LTRIM(RTRIM(C.Rfc))
    FROM dbo.Venta V WITH (NOLOCK)
    LEFT JOIN dbo.MovTipo B WITH (NOLOCK)
        ON B.Modulo = 'VTAS' AND B.Mov = V.Mov
    LEFT JOIN dbo.Sucursal S WITH (NOLOCK)
        ON S.Sucursal = V.Sucursal
    LEFT JOIN dbo.Cte C WITH (NOLOCK)
        ON C.Cliente = V.Cliente
    WHERE V.Empresa = 'PU'
      AND V.Estatus IN ('CONCLUIDO', 'PENDIENTE')
      AND {scope}
      AND V.Mov NOT IN (
            'RECIBO GIFT CARD', 'Reversion N-Credito', 'Reversion Vta',
            'SE-Boleta', 'SE-Factura', 'SE-Nota Credito', 'Recibo')
      AND EXISTS (
            SELECT 1
            FROM dbo.MovTipo X WITH (NOLOCK)
            WHERE X.Modulo = 'VTAS' AND X.Mov = V.Mov
              AND X.Clave IN ('VTAS.F', 'VTAS.FC', 'VTAS.B', 'VTAS.FB',
                              'VTAS.D', 'VTAS.DC', 'VTAS.FG'))
),
Conteos AS (
    SELECT
        L.IDVenta,
        Intentos = COUNT(*),
        OkRegistrados = SUM(
            CASE WHEN L.Estado = 'OK' AND L.Etapa = 'FINALIZADO'
                 THEN 1 ELSE 0 END)
    FROM dbo.SPPUFE_EjecucionLog L WITH (NOLOCK)
    WHERE L.IDVenta IN (SELECT IDVenta FROM Ufe)
    GROUP BY L.IDVenta
)
SELECT
    U.IDVenta,
    U.Mov,
    U.MovID,
    U.FechaEmision,
    U.Estatus,
    U.Sucursal,
    U.Importe,
    U.Impuestos,
    U.Referencia,
    U.Cliente,
    U.ServicioSerie,
    U.TipoDocumentoPU,
    U.SeriePU,
    U.GenerarTxtPeru,
    U.SucursalNombre,
    U.ClienteNombre,
    U.ClienteRfc,
    L.LogID,
    L.Estado AS EstadoIntento,
    L.Etapa,
    L.Documento,
    L.Detalle,
    L.ErrorMensaje,
    L.FechaInicio,
    L.FechaFin,
    L.ArchivoOut,
    L.Procedimiento,
    L.DuracionMs,
    L.AutocorridarolSalida,
    C.Intentos,
    C.OkRegistrados
FROM Ufe U
OUTER APPLY (
    SELECT TOP 1
        L2.LogID,
        L2.Estado,
        L2.Etapa,
        L2.Documento,
        L2.TipoDocumentoPU,
        L2.Detalle,
        L2.ErrorMensaje,
        L2.FechaInicio,
        L2.FechaFin,
        L2.ArchivoOut,
        L2.Procedimiento,
        L2.DuracionMs,
        L2.AutocorridarolSalida
    FROM dbo.SPPUFE_EjecucionLog L2 WITH (NOLOCK)
    WHERE L2.IDVenta = U.IDVenta
    ORDER BY L2.FechaInicio DESC, L2.LogID DESC
) L
LEFT JOIN Conteos C ON C.IDVenta = U.IDVenta
ORDER BY U.FechaEmision DESC, U.Sucursal, U.MovID
"""

# Listado del periodo.
INTELISIS_UFE_QUERY = _INTELISIS_UFE_BASE.format(scope=INTELISIS_UFE_SCOPE_RANGO)
# Un comprobante puntual (detalle y trazabilidad).
INTELISIS_UFE_ONE_QUERY = _INTELISIS_UFE_BASE.format(scope=INTELISIS_UFE_SCOPE_ID)

# Todos los intentos de un comprobante (la fila mas reciente primero).
INTELISIS_UFE_ATTEMPTS_QUERY = """
SELECT
    LogID,
    IDVenta,
    FechaInicio,
    FechaFin,
    Estado,
    Etapa,
    Detalle,
    TipoDocumentoPU,
    TipoMovimiento,
    Documento,
    ArchivoOut,
    Procedimiento,
    DuracionMs,
    ErrorMensaje,
    AutocorridarolSalida,
    Sucursal
FROM dbo.SPPUFE_EjecucionLog WITH (NOLOCK)
WHERE IDVenta = ?
ORDER BY LogID DESC
"""


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _to_iso_datetime(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="seconds")
    text = str(value).strip()
    return text[:19] if text else ""


def fetch_intelisis_ufe_rows(
    start_date: str,
    end_date: str,
) -> list[dict[str, Any]]:
    """Comprueba del universo UFE con el ultimo intento de la bitacora.

    Mismo universo que ``dbo.PUSP_ControlFac`` pero en una sola consulta para
    todo el rango (el SP obliga a un EXEC por dia). El ultimo intento sale
    de ``dbo.SPPUFE_EjecucionLog`` por ``IDVenta`` desempateado con
    ``FechaInicio DESC, LogID DESC``.
    """
    from .config import get_intelisis_config, get_intelisis_password
    from .db_pool import pooled_connection

    db_config = get_intelisis_config()
    password = get_intelisis_password()
    with pooled_connection(db_config, password) as connection:
        cursor = connection.cursor()
        cursor.execute(INTELISIS_UFE_QUERY, start_date, end_date)
        return _ufe_rows(cursor)


def fetch_intelisis_ufe_row(id_venta: int) -> list[dict[str, Any]]:
    """Un comprobante del universo UFE con su ultimo intento.

    Lista vacia si el ID no existe o no pertenece al universo UFE.
    """
    from .config import get_intelisis_config, get_intelisis_password
    from .db_pool import pooled_connection

    db_config = get_intelisis_config()
    password = get_intelisis_password()
    with pooled_connection(db_config, password) as connection:
        cursor = connection.cursor()
        cursor.execute(INTELISIS_UFE_ONE_QUERY, int(id_venta))
        return _ufe_rows(cursor)


def fetch_intelisis_ufe_attempts(id_venta: int) -> list[dict[str, Any]]:
    """Todos los intentos de la bitacora para un comprobante.

    Del mas reciente al mas antiguo (``LogID DESC``), que es el orden en el
    que el usuario quiere leerlos.
    """
    from .config import get_intelisis_config, get_intelisis_password
    from .db_pool import pooled_connection

    db_config = get_intelisis_config()
    password = get_intelisis_password()
    with pooled_connection(db_config, password) as connection:
        cursor = connection.cursor()
        cursor.execute(INTELISIS_UFE_ATTEMPTS_QUERY, int(id_venta))
        columns_out = [col[0] for col in cursor.description]
        return [
            {
                "LogID": _to_int(row.get("LogID")),
                "IDVenta": _to_int(row.get("IDVenta")),
                "FechaInicio": _to_iso_datetime(row.get("FechaInicio")),
                "FechaFin": _to_iso_datetime(row.get("FechaFin")),
                "Estado": _to_str(row.get("Estado")),
                "Etapa": _to_str(row.get("Etapa")),
                "Detalle": _to_str(row.get("Detalle")),
                "TipoDocumentoPU": _to_str(row.get("TipoDocumentoPU")),
                "TipoMovimiento": _to_str(row.get("TipoMovimiento")),
                "Documento": _to_str(row.get("Documento")),
                "ArchivoOut": _to_str(row.get("ArchivoOut")),
                "Procedimiento": _to_str(row.get("Procedimiento")),
                "DuracionMs": (
                    _to_int(row.get("DuracionMs"))
                    if row.get("DuracionMs") is not None
                    else None
                ),
                "ErrorMensaje": _to_str(row.get("ErrorMensaje")),
                "HashSalida": _to_str(row.get("AutocorridarolSalida")),
                "Sucursal": _to_int(row.get("Sucursal")),
            }
            for row in (
                dict(zip(columns_out, record)) for record in cursor.fetchall()
            )
        ]


def _ufe_rows(cursor) -> list[dict[str, Any]]:
    """Normaliza las filas del lector UFE (mismo formato para lista y uno)."""
    columns_out = [col[0] for col in cursor.description]
    rows: list[dict[str, Any]] = []
    for record in cursor.fetchall():
        row = dict(zip(columns_out, record))
        rows.append(
            {
                "IDVenta": _to_int(row.get("IDVenta")),
                "Mov": _to_str(row.get("Mov")),
                "MovID": _to_str(row.get("MovID")),
                "FechaEmision": _to_iso_date(row.get("FechaEmision")),
                "Estatus": _to_str(row.get("Estatus")),
                "Sucursal": _to_int(row.get("Sucursal")),
                "Importe": _to_float(row.get("Importe")),
                "Impuestos": _to_float(row.get("Impuestos")),
                "Referencia": _to_str(row.get("Referencia")),
                "Cliente": _to_str(row.get("Cliente")),
                "ServicioSerie": _to_str(row.get("ServicioSerie")),
                "TipoDocumentoPU": _to_str(row.get("TipoDocumentoPU")),
                "SeriePU": _to_str(row.get("SeriePU")),
                "GenerarTxtPeru": bool(row.get("GenerarTxtPeru")),
                "SucursalNombre": _to_str(row.get("SucursalNombre")),
                "ClienteNombre": _to_str(row.get("ClienteNombre")),
                "ClienteRfc": _to_str(row.get("ClienteRfc")),
                "LogID": (
                    _to_int(row.get("LogID")) if row.get("LogID") else None
                ),
                "EstadoIntento": _to_str(row.get("EstadoIntento")),
                "Etapa": _to_str(row.get("Etapa")),
                "Documento": _to_str(row.get("Documento")),
                "Detalle": _to_str(row.get("Detalle")),
                "ErrorMensaje": _to_str(row.get("ErrorMensaje")),
                "FechaInicio": _to_iso_datetime(row.get("FechaInicio")),
                "FechaFin": _to_iso_datetime(row.get("FechaFin")),
                "ArchivoOut": _to_str(row.get("ArchivoOut")),
                "Procedimiento": _to_str(row.get("Procedimiento")),
                "DuracionMs": (
                    _to_int(row.get("DuracionMs"))
                    if row.get("DuracionMs") is not None
                    else None
                ),
                "HashSalida": _to_str(row.get("AutocorridarolSalida")),
                "Intentos": _to_int(row.get("Intentos")),
                "OkRegistrados": _to_int(row.get("OkRegistrados")),
            }
        )
    return rows
