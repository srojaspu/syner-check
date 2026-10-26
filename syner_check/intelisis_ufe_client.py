"""Cliente de solo lectura del universo UFE en Intelisis (PUnidas).

Copia corregida de ``dbo.PUSP_ControlFac`` (D22) con el ultimo intento de
la bitacora en la misma consulta. Vive aparte de ``db_client`` (que lee el
origen SynerPOS, ``SE-*``) porque son dos universos distintos con reglas
distintas.

Solo lectura: nunca ejecuta procedimientos almacenados.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from typing import Any, Iterator

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

# Comun a las consultas del eje de ventas (resumen ERP y ventas sin
# documento). Es exactamente el mismo universo que el listado, pero sin los
# joins de cliente ni de bitacora: aca solo se cuentan ventas del ERP.
_UFE_MOVS_EXCLUIDOS = (
    "'RECIBO GIFT CARD', 'Reversion N-Credito', 'Reversion Vta', "
    "'SE-Boleta', 'SE-Factura', 'SE-Nota Credito', 'Recibo'"
)
_UFE_CLAVES_COMPROBANTE = (
    "'VTAS.F', 'VTAS.FC', 'VTAS.B', 'VTAS.FB', 'VTAS.D', 'VTAS.DC', 'VTAS.FG'"
)
_UFE_UNIVERSO = f"""
      AND V.Empresa = 'PU'
      AND V.Mov NOT IN ({_UFE_MOVS_EXCLUIDOS})
      AND EXISTS (
            SELECT 1
            FROM dbo.MovTipo X WITH (NOLOCK)
            WHERE X.Modulo = 'VTAS' AND X.Mov = V.Mov
              AND X.Clave IN ({_UFE_CLAVES_COMPROBANTE}))"""

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

# --- Eje de ventas del ERP: los 4 estados -------------------------------
#
# El listado solo puede devolver CONCLUIDO/PENDIENTE (es el universo de
# ``PUSP_ControlFac``). SINAFECTAR y CANCELADO existen en ``dbo.Venta`` y
# son parte del total del eje, pero no tienen comprobante: se cuentan aparte
# con estas dos consultas, sin joins de cliente ni de bitacora.

INTELISIS_UFE_RESUMEN_ERP_QUERY = f"""
SELECT V.Estatus AS Estatus, COUNT(*) AS n
FROM dbo.Venta V WITH (NOLOCK)
WHERE V.FechaEmision >= ? AND V.FechaEmision < DATEADD(DAY, 1, ?)
  AND V.Estatus IN ('CONCLUIDO', 'PENDIENTE', 'SINAFECTAR', 'CANCELADO')
{_UFE_UNIVERSO}
GROUP BY V.Estatus
"""

# Un documento de la bitacora termina en ocho ceros cuando el generador no
# pudo construir un numero valido (``175-00000000`` + OMITIDO_VALIDACION).
# Esos no son comprobantes emitidos: se informan como documento invalido.
_DOCUMENTO_INVALIDO = "Documento IS NOT NULL AND Documento LIKE '%00000000'"
_DOCUMENTO_VALIDO = "Documento IS NOT NULL AND Documento NOT LIKE '%00000000'"

# No se consulta dbo.VentaD para contar lineas: el login de lectura no tiene
# SELECT sobre esa tabla (229, verificado 2026-10-26). Ese conteo no es parte
# del universo documental; el dialogo no debe depender de un grant nuevo.

INTELISIS_UFE_SIN_DOCUMENTO_QUERY = f"""
SELECT
    V.ID AS IDVenta,
    V.Mov,
    V.MovID,
    V.FechaEmision,
    V.Estatus,
    V.Sucursal,
    SucursalNombre = LTRIM(RTRIM(S.Nombre)),
    ClienteNombre = LTRIM(RTRIM(C.Nombre)),
    V.Importe,
    V.Impuestos,
    Documento = (
        SELECT MAX(L.Documento)
        FROM dbo.SPPUFE_EjecucionLog L WITH (NOLOCK)
        WHERE L.IDVenta = V.ID AND {_DOCUMENTO_VALIDO}),
    DocumentoInvalido = (
        SELECT MAX(L.Documento)
        FROM dbo.SPPUFE_EjecucionLog L WITH (NOLOCK)
        WHERE L.IDVenta = V.ID AND {_DOCUMENTO_INVALIDO})
FROM dbo.Venta V WITH (NOLOCK)
LEFT JOIN dbo.Sucursal S WITH (NOLOCK) ON S.Sucursal = V.Sucursal
LEFT JOIN dbo.Cte C WITH (NOLOCK) ON C.Cliente = V.Cliente
WHERE V.Estatus = 'SINAFECTAR'
  AND V.FechaEmision >= ? AND V.FechaEmision < DATEADD(DAY, 1, ?)
{_UFE_UNIVERSO}
ORDER BY V.FechaEmision DESC, V.Sucursal, V.MovID
"""

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


# Filas por viaje a la base. El valor por defecto de pyodbc (1) pide una
# fila por ida y vuelta: con 31 dias (~18.000 filas) eso son segundos de
# espera que no tienen nada que ver con la consulta.
@contextmanager
def _lectura(sql: str, *params: Any) -> Iterator[Any]:
    """Cursor ya ejecutado, sobre la conexion de solo lectura."""
    from .config import get_intelisis_config, get_intelisis_password
    from .db_pool import FETCH_BATCH, pooled_connection

    with pooled_connection(
        get_intelisis_config(), get_intelisis_password()
    ) as connection:
        cursor = connection.cursor()
        cursor.arraysize = FETCH_BATCH
        cursor.execute(sql, *params)
        yield cursor


def _query_rows(sql: str, *params: Any) -> list[dict[str, Any]]:
    """Ejecuta una consulta del lector UFE y normaliza sus filas."""
    with _lectura(sql, *params) as cursor:
        return _ufe_rows(cursor)


def _query_dicts(sql: str, *params: Any) -> list[dict[str, Any]]:
    """Filas crudas por nombre de columna (agregados y dialogos).

    No usa ``_ufe_rows`` porque estas consultas no devuelven todas las
    columnas del universo: se normalizan en el ``fetch`` que las expone.
    """
    with _lectura(sql, *params) as cursor:
        columnas = [col[0] for col in cursor.description]
        return [dict(zip(columnas, record)) for record in cursor.fetchall()]


def fetch_intelisis_ufe_resumen_erp(
    start_date: str,
    end_date: str,
) -> list[dict[str, Any]]:
    """Ventas del eje agrupadas por ``Venta.Estatus`` (los 4 estados).

    Es el total honesto del periodo: incluye las que no tienen comprobante
    (SINAFECTAR / CANCELADO), que el listado nunca devuelve.
    """
    filas = _query_dicts(
        INTELISIS_UFE_RESUMEN_ERP_QUERY, start_date, end_date
    )
    return [
        {"Estatus": _to_str(row.get("Estatus")), "n": _to_int(row.get("n"))}
        for row in filas
    ]


def fetch_intelisis_ufe_sin_documento(
    start_date: str,
    end_date: str,
) -> list[dict[str, Any]]:
    """Ventas SINAFECTAR del periodo, para el dialogo de sin documento.

    ``Documento`` solo trae numeros validos; ``DocumentoInvalido`` recoge el
    ``175-00000000`` que deja una validacion fallida (no es un comprobante).
    """
    filas = _query_dicts(
        INTELISIS_UFE_SIN_DOCUMENTO_QUERY, start_date, end_date
    )
    return [
        {
            "IDVenta": _to_int(row.get("IDVenta")),
            "Mov": _to_str(row.get("Mov")),
            "MovID": _to_str(row.get("MovID")),
            "FechaEmision": _to_iso_date(row.get("FechaEmision")),
            "Estatus": _to_str(row.get("Estatus")),
            "Sucursal": _to_int(row.get("Sucursal")),
            "SucursalNombre": _to_str(row.get("SucursalNombre")),
            "ClienteNombre": _to_str(row.get("ClienteNombre")),
            "Importe": _to_float(row.get("Importe")),
            "Impuestos": _to_float(row.get("Impuestos")),
            "Documento": _to_str(row.get("Documento")),
            "DocumentoInvalido": _to_str(row.get("DocumentoInvalido")),
        }
        for row in filas
    ]


def fetch_intelisis_ufe_rows(
    start_date: str,
    end_date: str,
) -> list[dict[str, Any]]:
    """Comprobantes del universo UFE con el ultimo intento de la bitacora.

    Mismo universo que ``dbo.PUSP_ControlFac`` pero en una sola consulta para
    todo el rango (el SP obliga a un EXEC por dia). El ultimo intento sale
    de ``dbo.SPPUFE_EjecucionLog`` por ``IDVenta`` desempateado con
    ``FechaInicio DESC, LogID DESC``.
    """
    return _query_rows(INTELISIS_UFE_QUERY, start_date, end_date)


def fetch_intelisis_ufe_row(id_venta: int) -> list[dict[str, Any]]:
    """Un comprobante del universo UFE con su ultimo intento.

    Lista vacia si el ID no existe o no pertenece al universo UFE.
    """
    return _query_rows(INTELISIS_UFE_ONE_QUERY, int(id_venta))


def fetch_intelisis_ufe_documento(
    correlativo: str,
) -> list[dict[str, Any]]:
    """Candidatos por correlativo de documento (`MovID` termina en -correlativo).

    La identidad exacta (serie con prefijo de tipo) la calcula el dominio:
    aca solo se acotan los candidatos.
    """
    patron = f"%-{correlativo}"
    return _query_rows(INTELISIS_UFE_DOCUMENTO_QUERY, patron, correlativo)


def fetch_intelisis_ufe_attempts(id_venta: int) -> list[dict[str, Any]]:
    """Todos los intentos de la bitacora para un comprobante.

    Del mas reciente al mas antiguo (``LogID DESC``), que es el orden en el
    que el usuario quiere leerlos.
    """
    from .config import get_intelisis_config, get_intelisis_password
    from .db_pool import FETCH_BATCH, pooled_connection

    db_config = get_intelisis_config()
    password = get_intelisis_password()
    with pooled_connection(db_config, password) as connection:
        cursor = connection.cursor()
        cursor.arraysize = FETCH_BATCH
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


# Columnas que devuelven las tres consultas del universo (mismo orden). Se
# leen por posicion: el dict intermedio y 31 ``.get`` por fila se notaban
# con 18.000 filas.
_COLUMNAS_UFE: tuple[str, ...] = (
    "IDVenta",
    "Mov",
    "MovID",
    "FechaEmision",
    "Estatus",
    "Sucursal",
    "Importe",
    "Impuestos",
    "Referencia",
    "Cliente",
    "ServicioSerie",
    "TipoDocumentoPU",
    "SeriePU",
    "GenerarTxtPeru",
    "SucursalNombre",
    "ClienteNombre",
    "ClienteRfc",
    "LogID",
    "EstadoIntento",
    "Etapa",
    "Documento",
    "Detalle",
    "ErrorMensaje",
    "FechaInicio",
    "FechaFin",
    "ArchivoOut",
    "Procedimiento",
    "DuracionMs",
    "AutocorridarolSalida",
    "Intentos",
    "OkRegistrados",
)


def _ufe_rows(cursor) -> list[dict[str, Any]]:
    """Normaliza las filas del lector UFE (mismo formato para lista y uno).

    Si una consulta deja de devolver las columnas esperadas se avisa aqui,
    en vez de fallar tres capas mas arriba con un valor corrido de lugar.
    """
    columnas = tuple(col[0] for col in cursor.description)
    if columnas != _COLUMNAS_UFE:
        faltan = [name for name in _COLUMNAS_UFE if name not in columnas]
        sobran = [name for name in columnas if name not in _COLUMNAS_UFE]
        raise RuntimeError(
            "El lector UFE devolvio columnas distintas de las esperadas: "
            f"faltan={faltan} sobran={sobran}"
        )
    rows: list[dict[str, Any]] = []
    for record in cursor.fetchall():
        (
            id_venta,
            mov,
            mov_id,
            fecha_emision,
            estatus,
            sucursal,
            importe,
            impuestos,
            referencia,
            cliente,
            servicio_serie,
            tipo_documento_pu,
            serie_pu,
            generar_txt,
            sucursal_nombre,
            cliente_nombre,
            cliente_rfc,
            log_id,
            estado_intento,
            etapa,
            documento,
            detalle,
            error_mensaje,
            fecha_inicio,
            fecha_fin,
            archivo_out,
            procedimiento,
            duracion_ms,
            hash_salida,
            intentos,
            ok_registrados,
        ) = record
        rows.append(
            {
                "IDVenta": _to_int(id_venta),
                "Mov": _to_str(mov),
                "MovID": _to_str(mov_id),
                "FechaEmision": _to_iso_date(fecha_emision),
                "Estatus": _to_str(estatus),
                "Sucursal": _to_int(sucursal),
                "Importe": _to_float(importe),
                "Impuestos": _to_float(impuestos),
                "Referencia": _to_str(referencia),
                "Cliente": _to_str(cliente),
                "ServicioSerie": _to_str(servicio_serie),
                "TipoDocumentoPU": _to_str(tipo_documento_pu),
                "SeriePU": _to_str(serie_pu),
                "GenerarTxtPeru": bool(generar_txt),
                "SucursalNombre": _to_str(sucursal_nombre),
                "ClienteNombre": _to_str(cliente_nombre),
                "ClienteRfc": _to_str(cliente_rfc),
                "LogID": _to_int(log_id) if log_id else None,
                "EstadoIntento": _to_str(estado_intento),
                "Etapa": _to_str(etapa),
                "Documento": _to_str(documento),
                "Detalle": _to_str(detalle),
                "ErrorMensaje": _to_str(error_mensaje),
                "FechaInicio": _to_iso_datetime(fecha_inicio),
                "FechaFin": _to_iso_datetime(fecha_fin),
                "ArchivoOut": _to_str(archivo_out),
                "Procedimiento": _to_str(procedimiento),
                "DuracionMs": (
                    _to_int(duracion_ms) if duracion_ms is not None else None
                ),
                "HashSalida": _to_str(hash_salida),
                "Intentos": _to_int(intentos),
                "OkRegistrados": _to_int(ok_registrados),
            }
        )
    return rows

