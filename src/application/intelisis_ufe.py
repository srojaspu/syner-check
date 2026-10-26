"""Casos de uso de la pantalla Intelisis UFE (comprobantes del generador).

Recorta el trabajo en tres capas:

- el **dominio** (``src.domain.intelisis_ufe``) decide el estado, el
  generador y las incidencias;
- el **lector** trae las ventas del universo UFE con su ultimo intento en
  la bitacora;
- este modulo arma la respuesta: filas + KPIs + estado SUNAT del cache.

El mapeo de la fila y los filtros viven en
``src.application.intelisis_ufe_filas``.

El vocabulario de la grilla es el de la pestana FE del PHP (``CONFORME`` /
``REVISAR``, ``SIN TRAZA`` / ``OK REGISTRADO`` / ``SIN OK``) y el estado
SUNAT reemplaza al portal de Carvajal (D15).
"""

from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any, Sequence

from src.application.intelisis_ufe_filas import (
    MAX_FILAS_LISTADO,
    aplica_filtros,
    cobertura_por_dia,
    entero,
    fila_documento,
    fila_intento,
    fila_sin_documento,
    proyecto_lista,
    resumen,
    texto,
)
from src.application.ports import (
    IntelisisUfeReader,
    SunatCacheStore,
    SunatValidator,
)
from src.application.sunat_identidad import sunat_cache_key
from src.application.use_cases import sunat_revalidate
from src.domain import intelisis_ufe as dominio
from src.domain.errors import NotFoundError

logger = logging.getLogger("syner_check.intelisis_ufe")

# Tope del periodo: el PHP exige 1..31 dias.
MAX_DIAS = 31
# Tope de ventas por periodo. El PHP aborta en 20.000; 31 dias ya miden
# ~19.000 ventas y diciembre crece, asi que el margen es 25.000.
MAX_VENTAS = 25_000
# Tope del dialogo de ventas sin documentar (hoy el periodo llega a ~300).
MAX_SIN_DOCUMENTO = 1_000


class RangoInvalidoError(ValueError):
    """El periodo no cumple el tope del PHP."""


def _iso(fecha: Any) -> str:
    return str(fecha)


def _parse_fecha(valor: Any):
    from datetime import date

    texto_fecha = texto(valor)[:10]
    try:
        return date.fromisoformat(texto_fecha)
    except ValueError as exc:
        raise RangoInvalidoError("Fechas invalidas.") from exc


def validar_rango(start_iso: str, end_iso: str):
    """Valida el periodo contra el tope de 31 dias."""
    inicio = _parse_fecha(start_iso)
    fin = _parse_fecha(end_iso)
    if fin < inicio:
        raise RangoInvalidoError("La fecha final debe ser mayor o igual.")
    if (fin - inicio).days + 1 > MAX_DIAS:
        raise RangoInvalidoError(f"El rango maximo es de {MAX_DIAS} dias.")
    return inicio, fin


def _adjuntar_sunat(
    filas: list[dict[str, Any]],
    store: SunatCacheStore | None,
    ruc: str,
) -> None:
    """Lee el estado SUNAT del cache local (cero llamadas al validador).

    La identidad sale del documento oficial (``serie-correlativo``) y del
    tipo de Intelisis (``TipoDocumentoPU``), no de un voucher de SynerPOS.
    """
    if store is None or not (ruc or "").strip():
        for fila in filas:
            fila["sunat"] = None
        return
    claves: list[tuple[str, str, str, str]] = []
    orden: list[tuple[str, str, str, str] | None] = []
    for fila in filas:
        clave = sunat_cache_key(
            ruc.strip(),
            fila.get("tipo_sunat", ""),
            fila.get("comprobante", ""),
        )
        orden.append(clave)
        if clave is not None:
            claves.append(clave)
    try:
        # Una consulta por serie: con miles de comprobantes, buscar clave
        # por clave contra el cache tarda decenas de segundos.
        series = sorted({clave[2] for clave in claves})
        cache = store.fetch_by_series(ruc.strip(), series)
    except Exception:  # noqa: BLE001 - el cache es un extra, no bloquea
        cache = {}
    for fila, clave in zip(filas, orden):
        registro = cache.get(clave) if clave is not None else None
        if registro is None:
            fila["sunat"] = None
            continue
        fila["sunat"] = {
            "estado": str(registro.get("Estado", "")),
            "consultado": str(registro.get("FechaConsulta", "")),
        }


def _clasificar_sunat(
    filas: list[dict[str, Any]],
    store: SunatCacheStore | None,
    ruc: str,
) -> None:
    """Adjunta el estado SUNAT del cache y recalcula incidencias y resultado.

    Una sola pasada para las tres pantallas que lo necesitan (listado,
    busqueda y detalle). El cache es un extra: si falla, la pantalla sigue
    mostrando lo del generador.
    """
    _adjuntar_sunat(filas, store, ruc)
    for fila in filas:
        cacheado = fila.get("sunat") or {}
        estado_sunat, incidencias_sunat = dominio.clasificar_sunat(
            cacheado.get("estado")
        )
        fila["estado_sunat"] = estado_sunat
        fila["incidencias"], fila["resultado"] = dominio.combine_incidencias(
            fila["incidencias"], incidencias_sunat
        )


def listar_ufe(
    reader: IntelisisUfeReader,
    *,
    start_iso: str,
    end_iso: str,
    sunat_store: SunatCacheStore | None = None,
    sunat_ruc: str = "",
    now: datetime | None = None,
    resultado: str = "",
    estados: Sequence[str] = (),
    derivado: str = "",
    incidencia: str = "",
    tipos: Sequence[str] = (),
    generador: str = "",
    sunat: str = "",
    estatus: str = "",
    sucursal: int | None = None,
    q: str = "",
    correlation_id: str = "",
) -> dict[str, Any]:
    """Lista los comprobantes del universo UFE del periodo, con su estado.

    Los KPIs y la cobertura por dia se calculan sobre el periodo completo
    (como en el PHP); los filtros acotan las filas de la tabla y se aplican
    en el servidor, que es lo que hace usable un periodo de 31 dias.
    """
    inicio, fin = validar_rango(start_iso, end_iso)
    momento = now or datetime.now()
    started = time.perf_counter()

    filas = [
        fila_documento(row, momento)
        for row in reader.fetch_rows(_iso(inicio), _iso(fin))
    ]

    if len(filas) > MAX_VENTAS:
        raise RangoInvalidoError(
            f"Mas de {MAX_VENTAS} ventas. Reduzca el periodo."
        )

    # SUNAT: solo lectura del cache local (cero llamadas al validador).
    _clasificar_sunat(filas, sunat_store, sunat_ruc)

    # Cruces: dos ventas con el mismo documento del mismo tipo. Una factura
    # y su nota de credito comparten serie y correlativo, pero son
    # documentos distintos (el PHP tambien incluye el tipo en la clave).
    duplicados = dominio.identidades_duplicadas(
        [
            f"{fila['tipo_documento_pu']}|{fila['comprobante']}"
            for fila in filas
        ]
    )
    if duplicados:
        for fila in filas:
            identidad = f"{fila['tipo_documento_pu']}|{fila['comprobante']}"
            if identidad in duplicados:
                if dominio.INCIDENCIA_CRUCE_AMBIGUO not in fila["incidencias"]:
                    fila["incidencias"].append(dominio.INCIDENCIA_CRUCE_AMBIGUO)
                fila["resultado"] = dominio.RESULTADO_REVISAR

    kpis = resumen(filas)
    kpis["por_dia"] = cobertura_por_dia(filas)

    # El eje ERP completo (4 estados) no se puede calcular con las filas: el
    # listado solo trae los dos estados con documento. Se cuenta aparte, sin
    # joins, y se arma siempre en el mismo orden para que la tarjeta no baile.
    erp = {
        texto(item.get("Estatus")).upper(): entero(item.get("n"))
        for item in reader.fetch_resumen_erp(
            inicio.isoformat(), fin.isoformat()
        )
    }
    kpis["por_estatus"] = [
        {"key": estatus, "count": erp.get(estatus, 0)}
        for estatus in dominio.ESTATUS_ERP
    ]
    kpis["total_ventas"] = sum(item["count"] for item in kpis["por_estatus"])

    filtradas = [
        fila
        for fila in filas
        if aplica_filtros(
            fila,
            resultado=resultado,
            estados=estados,
            derivado=derivado,
            incidencia=incidencia,
            tipos=tipos,
            generador=generador,
            sunat=sunat,
            estatus=estatus,
            sucursal=sucursal,
            q=q,
        )
    ]

    # El navegador no puede con 18.000 filas: se recorta y se avisa.
    total_filtrado = len(filtradas)
    truncado = total_filtrado > MAX_FILAS_LISTADO
    if truncado:
        filtradas = filtradas[:MAX_FILAS_LISTADO]

    logger.info(
        "Intelisis UFE list correlation_id=%s desde=%s hasta=%s filas=%d "
        "ventas_erp=%d sin_afectar=%d filtrados=%d truncado=%s "
        "duracion_ms=%d",
        correlation_id,
        inicio.isoformat(),
        fin.isoformat(),
        kpis["total"],
        kpis["total_ventas"],
        next(
            (
                item["count"]
                for item in kpis["por_estatus"]
                if item["key"] == "SINAFECTAR"
            ),
            0,
        ),
        len(filtradas),
        truncado,
        int((time.perf_counter() - started) * 1000),
    )

    return {
        "desde": inicio.isoformat(),
        "hasta": fin.isoformat(),
        "bitacora_desde": dominio.BITACORA_INICIO.isoformat(),
        "intelisis_enabled": True,
        "kpis": kpis,
        "filtrados": len(filtradas),
        "filtrados_total": total_filtrado,
        "truncado": truncado,
        "max_filas": MAX_FILAS_LISTADO,
        "rows": [proyecto_lista(fila) for fila in filtradas],
    }


def buscar_ufe(
    reader: IntelisisUfeReader,
    *,
    documento: str,
    sunat_store: SunatCacheStore | None = None,
    sunat_ruc: str = "",
    now: datetime | None = None,
    correlation_id: str = "",
) -> dict[str, Any]:
    """Busca un comprobante por su numero oficial (``B710-00004539``).

    No necesita periodo: el correlativo acota los candidatos y la
    identidad exacta (serie con prefijo de tipo) la decide el dominio.
    """
    parsed = dominio.parse_documento_buscado(documento)
    if parsed is None:
        raise RangoInvalidoError(
            "Numero de comprobante invalido (ejemplo: B710-00004539)."
        )
    momento = now or datetime.now()
    started = time.perf_counter()
    correlativo = parsed[1].lstrip("0") or "0"
    candidatos = reader.buscar_por_correlativo(correlativo)

    filas: list[dict[str, Any]] = []
    for row in candidatos:
        fila = fila_documento(row, momento)
        if "-" in fila["comprobante"]:
            serie, _, numero = fila["comprobante"].partition("-")
        else:
            serie, numero = fila["comprobante"], ""
        if dominio.coincide_documento(parsed, (serie, numero)):
            filas.append(fila)

    if filas:
        _clasificar_sunat(filas, sunat_store, sunat_ruc)

    logger.info(
        "Intelisis UFE search correlation_id=%s documento=%s candidatos=%d "
        "encontrados=%d duracion_ms=%d",
        correlation_id,
        documento,
        len(candidatos),
        len(filas),
        int((time.perf_counter() - started) * 1000),
    )
    return {
        "documento_buscado": documento,
        "intelisis_enabled": True,
        "encontrados": len(filas),
        "rows": filas,
    }


def listar_sin_documento(
    reader: IntelisisUfeReader,
    *,
    start_iso: str,
    end_iso: str,
    correlation_id: str = "",
) -> dict[str, Any]:
    """Ventas registradas en Intelisis que no llegaron a afectarse.

    Alimenta el dialogo "Ventas sin documentar": son ventas del eje que no
    tienen comprobante electronico, por lo que no se pueden validar en SUNAT
    ni reenviar. Solo lectura; se carga al abrir el dialogo (no engorda el
    listado principal).
    """
    inicio, fin = validar_rango(start_iso, end_iso)
    started = time.perf_counter()
    filas = [
        fila_sin_documento(row)
        for row in reader.fetch_sin_documento(
            inicio.isoformat(), fin.isoformat()
        )
    ]
    total = len(filas)
    truncado = total > MAX_SIN_DOCUMENTO
    if truncado:
        filas = filas[:MAX_SIN_DOCUMENTO]
    sin_documento = sum(1 for f in filas if f["situacion"] == "sin_documento")
    logger.info(
        "Intelisis UFE sin-documento correlation_id=%s desde=%s hasta=%s "
        "filas=%d sin_documento=%d invalido=%d truncado=%s duracion_ms=%d",
        correlation_id,
        inicio.isoformat(),
        fin.isoformat(),
        total,
        sin_documento,
        total - sin_documento,
        truncado,
        int((time.perf_counter() - started) * 1000),
    )
    return {
        "desde": inicio.isoformat(),
        "hasta": fin.isoformat(),
        "intelisis_enabled": True,
        "total": total,
        "max_filas": MAX_SIN_DOCUMENTO,
        "truncado": truncado,
        "rows": filas,
    }


def detalle_ufe(
    reader: IntelisisUfeReader,
    *,
    id_venta: int,
    sunat_store: SunatCacheStore | None = None,
    sunat_ruc: str = "",
    now: datetime | None = None,
    correlation_id: str = "",
) -> dict[str, Any]:
    """Trazabilidad de un comprobante: venta, intentos y estado SUNAT."""
    rows = reader.fetch_row(id_venta)
    if not rows:
        raise NotFoundError("Comprobante no encontrado.")
    momento = now or datetime.now()
    fila = fila_documento(rows[0], momento)
    _clasificar_sunat([fila], sunat_store, sunat_ruc)
    intentos = [fila_intento(item) for item in reader.fetch_attempts(id_venta)]
    logger.info(
        "Intelisis UFE detail correlation_id=%s id_venta=%d documento=%s intentos=%d",
        correlation_id,
        int(id_venta),
        fila["comprobante"],
        len(intentos),
    )
    return {
        "id_venta": int(id_venta),
        "venta": fila,
        "intentos": intentos,
        "sunat": fila.get("sunat"),
        "estado_sunat": fila["estado_sunat"],
    }


def validar_ufe(
    reader: IntelisisUfeReader,
    validator: SunatValidator,
    store: SunatCacheStore,
    *,
    id_venta: int,
    sunat_ruc: str,
    usuario: str = "",
    now: datetime | None = None,
    correlation_id: str = "",
) -> dict[str, Any]:
    """Consulta individual en SUNAT y deja el estado en el cache local.

    No escribe en Intelisis: solo consulta SUNAT y guarda el resultado en
    la base de syner-check, que es lo que la grilla lee.

    Gasta cuota del validador, asi que queda auditada (actor, documento,
    estado y duracion).
    """
    if validator is None or store is None or not (sunat_ruc or "").strip():
        raise ValueError("Validación SUNAT no configurada.")
    rows = reader.fetch_row(id_venta)
    if not rows:
        raise NotFoundError("Comprobante no encontrado.")
    momento = now or datetime.now()
    fila = fila_documento(rows[0], momento)
    if not fila["tipo_sunat"]:
        raise ValueError("Este tipo de documento no admite consulta en SUNAT.")
    if not fila["comprobante"]:
        raise ValueError("El comprobante no tiene documento para consultar.")

    started = time.perf_counter()
    logger.info(
        "Intelisis UFE validate start correlation_id=%s actor=%s id_venta=%d "
        "documento=%s",
        correlation_id,
        usuario,
        int(id_venta),
        fila["comprobante"],
    )
    resultado = sunat_revalidate(
        validator,
        store,
        tipo=fila["tipo_sunat"],
        number=fila["comprobante"],
        date_iso=fila["fecha_emision"],
        importe=fila["total"],
        usuario=usuario,
        ruc=sunat_ruc,
    )
    logger.info(
        "Intelisis UFE validate done correlation_id=%s actor=%s id_venta=%d "
        "estado=%s duracion_ms=%d",
        correlation_id,
        usuario,
        int(id_venta),
        resultado.get("estado", ""),
        int((time.perf_counter() - started) * 1000),
    )
    return {
        "id_venta": int(id_venta),
        "documento": fila["documento"],
        "comprobante": fila["comprobante"],
        "estado": resultado.get("estado", ""),
        "resultado": resultado.get("resultado", {}),
    }
