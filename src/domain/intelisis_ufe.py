"""Estados derivados y clasificacion de comprobantes de origen Intelisis (UFE).

Reglas puras: sin base de datos, sin reloj real (la hora llega como
argumento) y sin I/O. Todo lo que la UI muestra sale de aqui, para que la
pantalla nunca interprete columnas crudas de la bitacora.

Fuentes de verdad:

- ``dbo.SPPUFE_EjecucionLog`` (PUnidas): bitacora del generador
  (``SPPUFE_UBL21`` / ``SPPUFE_UBL21_NCND``).
- ``dbo.SPPUFE_UBL21``: define como se calcula la identidad del documento
  (``@Serie`` / ``@NumDoc``) que el generador manda a SUNAT. Esa logica se
  replica aqui para poder mostrar el documento oficial y para consultar SUNAT
  sin reconstruirlo a mano.
- Paridad de vocabulario con la pestana FE del PHP (``rmand2/fe/core.php``):
  ``resultado`` (``CONFORME``/``REVISAR``), ``incidencias[]`` y ``generador``
  (``SIN TRAZA``/``OK REGISTRADO``/``SIN OK``).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Any, Mapping, Sequence

# --- Vocabulario -----------------------------------------------------------

ESTADO_GENERADO = "generado"
ESTADO_ERROR_VALIDACION = "error_validacion"
ESTADO_OMITIDO_VALIDACION = "omitido_validacion"
ESTADO_SIN_BLOQUE = "sin_bloque"
ESTADO_EN_PROCESO = "en_proceso"
ESTADO_SIN_REGISTRO = "sin_registro"
ESTADO_FUERA_DE_BITACORA = "fuera_de_bitacora"

ESTADOS_GENERACION: tuple[str, ...] = (
    ESTADO_GENERADO,
    ESTADO_ERROR_VALIDACION,
    ESTADO_OMITIDO_VALIDACION,
    ESTADO_SIN_BLOQUE,
    ESTADO_EN_PROCESO,
    ESTADO_SIN_REGISTRO,
    ESTADO_FUERA_DE_BITACORA,
)

GENERADOR_OK = "OK REGISTRADO"
GENERADOR_SIN_OK = "SIN OK"
GENERADOR_SIN_TRAZA = "SIN TRAZA"
# Las NC que acreditan un documento de SynerPOS (``SE-*``) no pasan por el
# generador de Intelisis: no es un fallo, es que el flujo no aplica (D21).
GENERADOR_NO_APLICA = "NO APLICA"

RESULTADO_CONFORME = "CONFORME"
RESULTADO_REVISAR = "REVISAR"

INCIDENCIA_SIN_TRAZA = "SIN TRAZA"
INCIDENCIA_GENERADOR_SIN_OK = "GENERADOR SIN OK"
# Dos ventas con el mismo documento en el mismo periodo: no se puede decir
# cual es la buena (paridad con `CRUCE AMBIGUO` del PHP).
INCIDENCIA_CRUCE_AMBIGUO = "CRUCE AMBIGUO"

# --- Estados derivados del validador ---------------------------------------
#
# Los segmentos del card Validador agrupan las filas con el mismo criterio con
# el que se calculan los KPIs. No son valores de ``estado_generacion``, asi
# que se filtran con ``derivado`` y no con ``estado`` (si no, el conteo del
# card no coincidiria con las filas que devuelve el listado).
DERIVADO_SIN_TRAZA = "sin_traza"
DERIVADO_PENDIENTES_CONCLUSION = "pendientes_conclusion"
DERIVADO_EN_ESPERA = "en_espera"
DERIVADO_NO_APLICA = "no_aplica"

DERIVADOS: tuple[str, ...] = (
    DERIVADO_SIN_TRAZA,
    DERIVADO_PENDIENTES_CONCLUSION,
    DERIVADO_EN_ESPERA,
    DERIVADO_NO_APLICA,
)

# ``Venta.Estatus``: el dominio real de la tabla (PUnidas). Los dos ultimos
# (CONFIRMAR / AFECTANDO) son residuales de 2016-2024 y no aparecen en el
# periodo, por eso el eje se mide con los cuatro primeros.
ESTATUS_ERP: tuple[str, ...] = (
    "CONCLUIDO",
    "PENDIENTE",
    "SINAFECTAR",
    "CANCELADO",
)
# Los dos unicos que tienen comprobante electronico (universo del listado).
ESTATUS_CON_DOCUMENTO: tuple[str, ...] = ("CONCLUIDO", "PENDIENTE")

SUNAT_ACEPTADO = "ACEPTADO"
SUNAT_NO_ENCONTRADO = "SUNAT NO ENCONTRADO"
SUNAT_NO_ACEPTADO = "SUNAT NO ACEPTADO"
SUNAT_SIN_CONSULTA = "SUNAT SIN CONSULTA"

INCIDENCIA_SUNAT_NO_ENCONTRADO = SUNAT_NO_ENCONTRADO
INCIDENCIA_SUNAT_NO_ACEPTADO = SUNAT_NO_ACEPTADO

# ``TipoDocumentoPU`` de Intelisis -> tipo de movimiento y tipo SUNAT.
TIPO_MOVIMIENTO: dict[str, str] = {"01": "FA", "03": "BO", "07": "NC", "08": "ND"}
TIPO_DOCUMENTO_SUNAT: dict[str, str] = {
    "01": "FACTURA",
    "03": "BOLETA",
    "07": "NOTA DE CREDITO",
}

# La bitacora arranca con el LogID 1 (2026-09-24 14:51). Antes de esa fecha
# "sin registro" no significa "no generado": el generador todavia no existia.
BITACORA_INICIO = date(2026, 9, 24)

# Ventana de gracia: lo emitido hoy todavia puede estar en cola del
# generador. Sin esto la pantalla alarma en cada venta normal (D13).
GRACIA_HORAS_POR_DEFECTO = 4

# Estados de SUNAT que el validador devuelve y que cuentan como negativos.
_SUNAT_NEGATIVOS = {
    "NO_EXISTE": SUNAT_NO_ENCONTRADO,
    "ANULADO": SUNAT_NO_ACEPTADO,
    "NO_AUTORIZADO": SUNAT_NO_ACEPTADO,
    "DESCONOCIDO": SUNAT_NO_ACEPTADO,
}


# --- Identidad del documento -----------------------------------------------


def _normaliza(texto: Any) -> str:
    return str(texto if texto is not None else "").strip()


def es_sin_traza(fila: Mapping[str, Any]) -> bool:
    """Incidencia D19: CONCLUIDO sin registro en la bitacora (fuera de gracia)."""
    return INCIDENCIA_SIN_TRAZA in (fila.get("incidencias") or [])


def es_pendiente_conclusion(fila: Mapping[str, Any]) -> bool:
    """PENDIENTE sin registro: todavia no debia pasar por el generador (D19)."""
    return (
        _normaliza(fila.get("estatus_erp")).upper() == "PENDIENTE"
        and fila.get("estado_generacion") == ESTADO_SIN_REGISTRO
        and not fila.get("exento_generador")
    )


def es_en_espera(fila: Mapping[str, Any]) -> bool:
    """Emitida hoy dentro de la ventana de gracia del generador."""
    return bool(fila.get("en_espera"))


def es_no_aplica(fila: Mapping[str, Any]) -> bool:
    """El generador no aplica (NC que acredita un documento de SynerPOS)."""
    return bool(fila.get("exento_generador"))


_DERIVADO_PREDICADOS: dict[
    str, Callable[[Mapping[str, Any]], bool]
] = {
    DERIVADO_SIN_TRAZA: es_sin_traza,
    DERIVADO_PENDIENTES_CONCLUSION: es_pendiente_conclusion,
    DERIVADO_EN_ESPERA: es_en_espera,
    DERIVADO_NO_APLICA: es_no_aplica,
}


def cumple_derivado(fila: Mapping[str, Any], derivado: str) -> bool:
    """True si la fila pertenece al estado derivado indicado.

    Un valor desconocido no coincide con ninguna fila: el router valida el
    parametro antes de llegar aca.
    """
    predicado = _DERIVADO_PREDICADOS.get(_normaliza(derivado))
    return bool(predicado and predicado(fila))


# Letra de tipo que lleva el comprobante: F (factura), B (boleta), N (nota).
# Las notas de credito heredan la letra del documento que acreditan.
PREFIX_TIPO: dict[str, str] = {"01": "F", "03": "B"}
PREFIX_REFERENCIA: dict[str, str] = {
    "TICK": "B",
    "BOLE": "B",
    "E-BO": "B",
    "DE-B": "B",
    "E-FA": "F",
    "FACT": "F",
    "DE-F": "F",
}


def serie_documento(
    servicio_serie: Any,
    sucursal: int,
    serie_pu: Any,
    generar_txt: bool,
) -> str:
    """Serie del documento, replicando ``@Serie`` de ``SPPUFE_UBL21``.

    - ``ServicioSerie`` manda sobre todo lo demas.
    - Sucursal 0 o 1: la serie es ``SeriePU`` (o ``001``).
    - Resto: con ``GenerarTxtPeru = 0`` se usa ``SeriePU`` y si falta, los
      ultimos 3 digitos de la sucursal; con ``GenerarTxtPeru = 1`` manda la
      sucursal y ``SeriePU`` es el respaldo.
    """
    servicio = _normaliza(servicio_serie)
    if servicio:
        return servicio
    serie = _normaliza(serie_pu)
    if sucursal in (0, 1):
        return serie or "001"
    ultimos_tres = f"{sucursal:03d}"[-3:] if sucursal else "000"
    if not generar_txt:
        if not serie:
            serie = ultimos_tres if ultimos_tres != "000" else ""
        return f"{serie:0>4}"[-4:]
    return ultimos_tres if ultimos_tres != "000" else (serie or "001")


def numero_documento(mov_id: Any) -> str:
    """Correlativo de 8 digitos, replicando ``@NumDoc`` de ``SPPUFE_UBL21``.

    El correlativo es lo que va despues del ``-`` en ``MovID``; si no hay
    guion se usa el ``MovID`` completo.
    """
    texto = _normaliza(mov_id)
    if "-" in texto:
        texto = texto.split("-", 1)[1]
    return f"{texto:0>8}"[-8:] if texto else "00000000"


def identidad_documento(
    servicio_serie: Any,
    sucursal: int,
    serie_pu: Any,
    generar_txt: bool,
    mov_id: Any,
) -> tuple[str, str]:
    """(serie, numero) del documento, como los calcula el generador."""
    return (
        serie_documento(servicio_serie, sucursal, serie_pu, generar_txt),
        numero_documento(mov_id),
    )


def prefijo_documento(tipo_documento_pu: Any, referencia: Any = "") -> str:
    """Letra de tipo del comprobante: ``F`` factura, ``B`` boleta, ``N`` nota.

    Las notas de credito y de debito heredan la letra del documento que
    acreditan, con la misma regla que ``PUSP_ControlFac`` y
    ``SPPUFE_UBL21_NCND`` (``LEFT(Referencia, 4)``).
    """
    tipo = _normaliza(tipo_documento_pu).upper()
    if tipo in PREFIX_TIPO:
        return PREFIX_TIPO[tipo]
    return PREFIX_REFERENCIA.get(_normaliza(referencia).upper()[:4], "N")


def serie_sunat(
    servicio_serie: Any,
    sucursal: int,
    serie_pu: Any,
) -> str:
    """Serie que va en el TXT, es decir, la que registra SUNAT.

    Replica ``@Serie`` de ``spPUEBoletaOFIver3``/``spPUENCNDver4``: el
    servicio manda; sucursal 0 o 1 usa ``SeriePU``; el resto usa los
    ultimos 3 digitos de la sucursal.
    """
    servicio = _normaliza(servicio_serie)
    if servicio:
        return servicio
    serie = _normaliza(serie_pu)
    if sucursal in (0, 1):
        return serie or "001"
    ultimos_tres = f"{sucursal:03d}"[-3:] if sucursal else "000"
    return ultimos_tres if ultimos_tres != "000" else (serie or "001")


def comprobante_sunat(
    tipo_documento_pu: Any,
    referencia: Any,
    servicio_serie: Any,
    sucursal: int,
    serie_pu: Any,
    mov_id: Any,
) -> str:
    """Identidad del comprobante en SUNAT: ``B710-00004539``.

    Es el numero que va en la seccion CAB 04 del TXT que consume Carvajal
    (``prefijo + serie + '-' + correlativo``). La bitacora guarda el mismo
    numero sin la letra de tipo (``710-00004539``).
    """
    return (
        f"{prefijo_documento(tipo_documento_pu, referencia)}"
        f"{serie_sunat(servicio_serie, sucursal, serie_pu)}"
        f"-{numero_documento(mov_id)}"
    )


# --- Clasificacion ---------------------------------------------------------


def _estado_ultimo_intento(ultimo: Mapping[str, Any] | None) -> str:
    """Estado tecnico derivado de la ultima fila de la bitacora."""
    if not ultimo:
        return ESTADO_SIN_REGISTRO
    estado = _normaliza(ultimo.get("estado")).upper()
    etapa = _normaliza(ultimo.get("etapa")).upper()
    if estado == "OK" and etapa == "FINALIZADO":
        return ESTADO_GENERADO
    if estado == "PROCESANDO" or etapa == "PROCESANDO":
        return ESTADO_EN_PROCESO
    if estado == "SIN_BLOQUE_TIPO" or etapa == "TIPO_MOVIMIENTO":
        return ESTADO_SIN_BLOQUE
    if estado == "OMITIDO_VALIDACION":
        return ESTADO_OMITIDO_VALIDACION
    if etapa == "VALIDACION_DOCUMENTO" or estado == "ERROR":
        return ESTADO_ERROR_VALIDACION
    # Cualquier otro estado (INICIADO, DUPLICADO_EN_PROCESO, ...) se trata
    # como intento no exitoso: el generador no termino el documento.
    return ESTADO_ERROR_VALIDACION


def _detalle_incidencia(ultimo: Mapping[str, Any] | None) -> str | None:
    if not ultimo:
        return None
    for campo in ("detalle", "error_mensaje"):
        valor = _normaliza(ultimo.get(campo))
        if valor:
            return valor
    return None


def es_exento_generador(tipo_documento_pu: Any, referencia: Any) -> bool:
    """True si el documento no debe pasar por el generador de Intelisis.

    Son las notas de credito que acreditan un comprobante de SynerPOS
    (``Referencia`` ``SE-*``): historicamente 37 de 37 estan sin traza, o
    sea que es sistematico y no un fallo del generador (D21).
    """
    if _normaliza(tipo_documento_pu).upper() != "07":
        return False
    return _normaliza(referencia).upper().startswith("SE-")


def clasificar_generacion(
    *,
    ultimo: Mapping[str, Any] | None,
    estatus_erp: str,
    fecha_emision: date,
    ahora: datetime,
    tipo_documento_pu: Any = None,
    referencia: Any = "",
    bitacora_inicio: date = BITACORA_INICIO,
    gracia_horas: int = GRACIA_HORAS_POR_DEFECTO,
) -> dict[str, Any]:
    """Deriva estado de generacion, generador e incidencias de un documento.

    ``ultimo`` es la fila mas reciente de la bitacora (``None`` si el
    documento nunca paso por el generador).
    """
    estatus = _normaliza(estatus_erp).upper()
    estado = _estado_ultimo_intento(ultimo)
    exento = es_exento_generador(tipo_documento_pu, referencia)

    fuera_de_bitacora = fecha_emision < bitacora_inicio
    en_espera = False
    if estado == ESTADO_SIN_REGISTRO and fuera_de_bitacora:
        estado = ESTADO_FUERA_DE_BITACORA

    incidencias: list[str] = []
    if estado == ESTADO_SIN_REGISTRO:
        # Solo una venta CONCLUIDA puede estar "sin generar": una PENDIENTE
        # todavia no debia pasar por el generador (D19).
        if estatus == "CONCLUIDO" and not exento:
            dentro_de_gracia = _dentro_de_gracia(
                fecha_emision, ahora, gracia_horas
            )
            if not dentro_de_gracia:
                incidencias.append(INCIDENCIA_SIN_TRAZA)
            else:
                en_espera = True
    elif estado in (
        ESTADO_ERROR_VALIDACION,
        ESTADO_OMITIDO_VALIDACION,
        ESTADO_SIN_BLOQUE,
    ):
        incidencias.append(INCIDENCIA_GENERADOR_SIN_OK)

    if exento and estado == ESTADO_SIN_REGISTRO:
        generador = GENERADOR_NO_APLICA
    elif estado == ESTADO_GENERADO:
        generador = GENERADOR_OK
    elif estado == ESTADO_SIN_REGISTRO or estado == ESTADO_FUERA_DE_BITACORA:
        generador = GENERADOR_SIN_TRAZA
    else:
        generador = GENERADOR_SIN_OK

    resultado = RESULTADO_REVISAR if incidencias else RESULTADO_CONFORME

    return {
        "estado_generacion": estado,
        "generador": generador,
        "incidencias": incidencias,
        "resultado": resultado,
        "detalle_incidencia": _detalle_incidencia(ultimo),
        "en_espera": en_espera,
        "exento_generador": exento,
        "fuera_de_bitacora": fuera_de_bitacora,
    }


def _dentro_de_gracia(
    fecha_emision: date, ahora: datetime, gracia_horas: int
) -> bool:
    """True si el documento es de hoy y la gracia todavia no vencio.

    ``FechaEmision`` es la fecha (00:00) del dia; la gracia se mide desde
    el inicio de ese dia, que es como lo ve el negocio ("el lote de hoy
    todavia esta en el generador").
    """
    if gracia_horas <= 0:
        return False
    inicio = datetime.combine(fecha_emision, datetime.min.time())
    return ahora < inicio + timedelta(hours=gracia_horas)


def clasificar_sunat(estado_cache: Any) -> tuple[str, list[str]]:
    """(estado_sunat, incidencias) a partir del estado cacheado.

    ``ACEPTADO`` no genera incidencia. Un resultado negativo (no existe,
    anulado, no autorizado) si. No haber consultado todavia no es un
    resultado: se informa como ``SUNAT SIN CONSULTA`` y no suma a REVISAR.
    """
    estado = _normaliza(estado_cache).upper()
    if not estado:
        return SUNAT_SIN_CONSULTA, []
    if estado == "ACEPTADO":
        return SUNAT_ACEPTADO, []
    if estado in _SUNAT_NEGATIVOS:
        return _SUNAT_NEGATIVOS[estado], [_SUNAT_NEGATIVOS[estado]]
    return estado, []


def identidades_duplicadas(identidades: Sequence[str]) -> set[str]:
    """Documentos que se repiten en el mismo periodo (``CRUCE AMBIGUO``).

    El PHP abortaba la carga cuando ``PUSP_ControlFac`` devolvia el mismo
    ID dos veces; aca no se aborta: se marca el cruce para que el usuario
    lo vea y lo investigue.
    """
    conteo: dict[str, int] = {}
    for identidad in identidades:
        clave = _normaliza(identidad)
        if not clave:
            continue
        conteo[clave] = conteo.get(clave, 0) + 1
    return {clave for clave, total in conteo.items() if total > 1}


def parse_documento_buscado(texto: Any) -> tuple[str, str] | None:
    """Divide el numero buscado en (serie, correlativo).

    Acepta el numero oficial con prefijo de tipo (``B710-00004539``) y
    tambien sin el (``710-00004539``). El correlativo conserva los ceros
    con que se imprimio.
    """
    limpio = _normaliza(texto).upper().replace(" ", "")
    if "-" not in limpio:
        return None
    serie, _, correlativo = limpio.rpartition("-")
    serie = serie.strip()
    correlativo = correlativo.strip()
    if not serie or not correlativo or not correlativo.isdigit():
        return None
    if len(serie) > 20 or len(correlativo) > 20:
        return None
    return serie, correlativo


def coincide_documento(
    buscado: tuple[str, str], calculado: tuple[str, str]
) -> bool:
    """True si el numero buscado corresponde al calculado.

    El correlativo tiene que coincidir y la serie puede venir sin el
    prefijo de tipo (``710`` en vez de ``B710``): es como lo escribe la
    gente.
    """
    serie_buscada, correlativo_buscado = buscado
    serie_calculada, correlativo_calculado = calculado
    if correlativo_buscado.lstrip("0") != correlativo_calculado.lstrip("0"):
        return False
    return serie_buscada == serie_calculada or serie_calculada.endswith(
        serie_buscada
    )


def combine_incidencias(
    generacion: list[str], sunat: list[str]
) -> tuple[list[str], str]:
    """Une incidencias de ambos ejes y recalcula el resultado."""
    incidencias = list(generacion)
    for item in sunat:
        if item not in incidencias:
            incidencias.append(item)
    return (
        incidencias,
        RESULTADO_REVISAR if incidencias else RESULTADO_CONFORME,
    )


def resumen_por_generador(rows: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """KPI: documentos por estado del generador (mismovocabulario del PHP)."""
    conteo: dict[str, int] = {}
    for row in rows:
        clave = _normaliza(row.get("generador")) or "—"
        conteo[clave] = conteo.get(clave, 0) + 1
    orden = {GENERADOR_OK: 0, GENERADOR_SIN_OK: 1, GENERADOR_SIN_TRAZA: 2}
    return [
        {"key": clave, "count": conteo[clave]}
        for clave in sorted(conteo, key=lambda k: (orden.get(k, 9), k))
    ]


def resumen_por_incidencia(rows: list[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """KPI: documentos por incidencia (puede tener mas de una)."""
    conteo: dict[str, int] = {}
    for row in rows:
        for incidencia in row.get("incidencias") or []:
            clave = _normaliza(incidencia)
            if not clave:
                continue
            conteo[clave] = conteo.get(clave, 0) + 1
    return [
        {"key": clave, "count": conteo[clave]}
        for clave in sorted(conteo, key=lambda k: (-conteo[k], k))
    ]
