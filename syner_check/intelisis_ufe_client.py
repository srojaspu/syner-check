"""Cliente de solo lectura del universo UFE en Intelisis (PUnidas).

Copia corregida de ``dbo.PUSP_ControlFac`` (D22) con el ultimo intento de
la bitacora en la misma consulta. Vive aparte de ``db_client`` (que lee el
origen SynerPOS, ``SE-*``) porque son dos universos distintos con reglas
distintas.

Solo lectura: nunca ejecuta procedimientos almacenados.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from .db_client import _to_iso_date, _to_str
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


# --- Intelisis (Punidas): busqueda de un comprobante por su numero ---------
#
# El numero oficial es `serie-correlativo` con el prefijo de tipo
# (`B710-00004539`), pero la venta lo guarda como `MovID` = `sucursal-corr`
# sin ceros (`1-4539`). Por eso la busqueda va por correlativo (candidatos
# acotados) y la identidad exacta se calcula en el dominio.

INTELISIS_UFE_DOCUMENTO_QUERY = """
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
      AND V.Mov NOT IN (
            'RECIBO GIFT CARD', 'Reversion N-Credito', 'Reversion Vta',
            'SE-Boleta', 'SE-Factura', 'SE-Nota Credito', 'Recibo')
      AND EXISTS (
            SELECT 1
            FROM dbo.MovTipo X WITH (NOLOCK)
            WHERE X.Modulo = 'VTAS' AND X.Mov = V.Mov
              AND X.Clave IN ('VTAS.F', 'VTAS.FC', 'VTAS.B', 'VTAS.FB',
                              'VTAS.D', 'VTAS.DC', 'VTAS.FG'))
      AND (V.MovID LIKE ? OR V.MovID = ?)
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
        L2.LogID, L2.Estado, L2.Etapa, L2.Documento, L2.TipoDocumentoPU,
        L2.Detalle, L2.ErrorMensaje, L2.FechaInicio, L2.FechaFin,
        L2.ArchivoOut, L2.Procedimiento, L2.DuracionMs, L2.AutocorridarolSalida
    FROM dbo.SPPUFE_EjecucionLog L2 WITH (NOLOCK)
    WHERE L2.IDVenta = U.IDVenta
    ORDER BY L2.FechaInicio DESC, L2.LogID DESC
) L
LEFT JOIN (
    SELECT
        L3.IDVenta,
        Intentos = COUNT(*),
        OkRegistrados = SUM(
            CASE WHEN L3.Estado = 'OK' AND L3.Etapa = 'FINALIZADO'
                 THEN 1 ELSE 0 END)
    FROM dbo.SPPUFE_EjecucionLog L3 WITH (NOLOCK)
    WHERE L3.IDVenta IN (SELECT IDVenta FROM Ufe)
    GROUP BY L3.IDVenta
) C ON C.IDVenta = U.IDVenta
ORDER BY U.FechaEmision DESC, U.Sucursal, U.MovID
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


def fetch_intelisis_ufe_documento(
    correlativo: str,
) -> list[dict[str, Any]]:
    """Candidatos por correlativo de documento (`MovID` termina en -correlativo).

    La identidad exacta (serie con prefijo de tipo) la calcula el dominio:
    aca solo se acotan los candidatos.
    """
    from .config import get_intelisis_config, get_intelisis_password
    from .db_pool import pooled_connection

    db_config = get_intelisis_config()
    password = get_intelisis_password()
    patron = f"%-{correlativo}"
    with pooled_connection(db_config, password) as connection:
        cursor = connection.cursor()
        cursor.execute(
            INTELISIS_UFE_DOCUMENTO_QUERY, patron, correlativo
        )
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

