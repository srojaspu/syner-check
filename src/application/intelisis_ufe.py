"""Casos de uso de la pantalla Intelisis UFE (comprobantes del generador).

Recorta el trabajo en tres capas:

- el **dominio** (``src.domain.intelisis_ufe``) decide el estado, el
  generador y las incidencias;
- el **lector** trae las ventas del universo UFE con su ultimo intento en
  la bitacora;
- este modulo arma la respuesta: filas + KPIs + estado SUNAT del cache.

El vocabulario de la grilla es el de la pestana FE del PHP (``CONFORME`` /
``REVISAR``, ``SIN TRAZA`` / ``OK REGISTRADO`` / ``SIN OK``) y el estado
SUNAT reemplaza al portal de Carvajal (D15).
"""

from __future__ import annotations

import logging
import time
from datetime import date, datetime
from typing import Any, Mapping, Sequence

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
# Tope de ventas por periodo (mismo tope que el PHP).
MAX_VENTAS = 20_000
# Tope de filas que vuelve el listado. El filtro va al servidor: con 31 dias
# el universo llega a ~18.000 documentos y un payload de 39 campos por fila
# pesaba 17 MB (inutilizable en el navegador). El listado devuelve solo lo
# que la tabla necesita y, si aun asi es mucho, se recorta avisando.
MAX_FILAS_LISTADO = 5_000

# Campos que la tabla usa. El resto vive en el detalle (GET por id_venta).
CAMPOS_LISTA: tuple[str, ...] = (
    "id_venta",
    "tipo",
    "comprobante",
    "documento",
    "documento_estimado",
    "mov",
    "mov_id",
    "fecha_emision",
    "sucursal",
    "sucursal_nombre",
    "cliente",
    "total",
    "estatus_erp",
    "referencia",
    "estado_generacion",
    "generador",
    "incidencias",
    "resultado",
    "detalle_incidencia",
    "en_espera",
    "exento_generador",
    "fuera_de_bitacora",
    "etapa",
    "intentos",
    "ultimo_intento",
    "estado_sunat",
    "sunat",
)


class RangoInvalidoError(ValueError):
    """El periodo no cumple el tope del PHP."""


def _iso(fecha: date) -> str:
    return fecha.isoformat()


def _parse_fecha(valor: str) -> date:
    try:
        return date.fromisoformat(str(valor or "").strip()[:10])
    except ValueError as exc:
        raise RangoInvalidoError("Fechas invalidas.") from exc


def validar_rango(start_iso: str, end_iso: str) -> tuple[date, date]:
    """Valida el periodo contra el tope de 31 dias."""
    inicio = _parse_fecha(start_iso)
    fin = _parse_fecha(end_iso)
    if fin < inicio:
        raise RangoInvalidoError("La fecha final debe ser mayor o igual.")
    if (fin - inicio).days + 1 > MAX_DIAS:
        raise RangoInvalidoError(f"El rango maximo es de {MAX_DIAS} dias.")
    return inicio, fin


def _numero(valor: Any) -> float:
    try:
        return float(valor)
    except (TypeError, ValueError):
        return 0.0


def _texto(valor: Any) -> str:
    return str(valor if valor is not None else "").strip()


def _fila(row: Mapping[str, Any], now: datetime) -> dict[str, Any]:
    """Arma la fila de la grilla a partir de la lectura y el dominio."""
    tipo_documento_pu = _texto(row.get("TipoDocumentoPU"))
    referencia = _texto(row.get("Referencia"))
    serie, numero = dominio.identidad_documento(
        row.get("ServicioSerie"),
        int(row.get("Sucursal") or 0),
        row.get("SeriePU"),
        bool(row.get("GenerarTxtPeru")),
        row.get("MovID"),
    )
    documento_teorico = f"{serie}-{numero}"
    documento_bitacora = _texto(row.get("Documento"))
    documento = documento_bitacora or documento_teorico
    estimado = not documento_bitacora
    # Identidad en SUNAT: el TXT lleva el prefijo de tipo ("B710-00004539").
    comprobante = dominio.comprobante_sunat(
        tipo_documento_pu,
        referencia,
        row.get("ServicioSerie"),
        int(row.get("Sucursal") or 0),
        row.get("SeriePU"),
        row.get("MovID"),
    )

    fecha_emision = _parse_fecha(_texto(row.get("FechaEmision")))
    ultimo = None
    if row.get("LogID"):
        ultimo = {
            "log_id": row.get("LogID"),
            "estado": row.get("EstadoIntento"),
            "etapa": row.get("Etapa"),
            "documento": row.get("Documento"),
            "detalle": row.get("Detalle"),
            "error_mensaje": row.get("ErrorMensaje"),
            "fecha_inicio": row.get("FechaInicio"),
        }

    clasificacion = dominio.clasificar_generacion(
        ultimo=ultimo,
        estatus_erp=row.get("Estatus"),
        fecha_emision=fecha_emision,
        ahora=now,
        tipo_documento_pu=tipo_documento_pu,
        referencia=row.get("Referencia"),
    )

    return {
        "id_venta": int(row.get("IDVenta") or 0),
        "tipo": dominio.TIPO_MOVIMIENTO.get(tipo_documento_pu, "NN"),
        "tipo_documento_pu": tipo_documento_pu,
        "documento": documento,
        "documento_estimado": estimado,
        "documento_teorico": documento_teorico,
        # Identidad SUNAT (prefijo de tipo + serie + correlativo).
        "comprobante": comprobante,
        "mov": _texto(row.get("Mov")),
        "mov_id": _texto(row.get("MovID")),
        "fecha_emision": fecha_emision.isoformat(),
        "sucursal": int(row.get("Sucursal") or 0),
        "sucursal_nombre": _texto(row.get("SucursalNombre")) or "Sin nombre",
        "cliente": _texto(row.get("ClienteNombre")),
        "cliente_codigo": _texto(row.get("Cliente")),
        "ruc": _texto(row.get("ClienteRfc")),
        "importe": _numero(row.get("Importe")),
        "impuestos": _numero(row.get("Impuestos")),
        "total": round(
            _numero(row.get("Importe")) + _numero(row.get("Impuestos")), 2
        ),
        "estatus_erp": _texto(row.get("Estatus")),
        "referencia": _texto(row.get("Referencia")),
        "estado_generacion": clasificacion["estado_generacion"],
        "generador": clasificacion["generador"],
        "incidencias": clasificacion["incidencias"],
        "resultado": clasificacion["resultado"],
        "detalle_incidencia": clasificacion["detalle_incidencia"],
        "en_espera": clasificacion["en_espera"],
        "exento_generador": clasificacion["exento_generador"],
        "fuera_de_bitacora": clasificacion["fuera_de_bitacora"],
        "etapa": _texto(row.get("Etapa")),
        "intentos": int(row.get("Intentos") or 0),
        "ok_registrados": int(row.get("OkRegistrados") or 0),
        "ultimo_intento": _texto(row.get("FechaInicio")),
        "hash": _texto(row.get("HashSalida")),
        "archivo_out": _texto(row.get("ArchivoOut")),
        "procedimiento": _texto(row.get("Procedimiento")),
        # El tipo SUNAT sale de TipoDocumentoPU; las ND (08) no tienen tipo
        # en el validador, asi que quedan sin consulta.
        "tipo_sunat": dominio.TIPO_DOCUMENTO_SUNAT.get(tipo_documento_pu, ""),
        "sunat": None,
        "estado_sunat": dominio.SUNAT_SIN_CONSULTA,
        "reenvio": None,
    }


def _aplica_filtros(
    fila: Mapping[str, Any],
    *,
    resultado: str = "",
    estados: Sequence[str] = (),
    incidencia: str = "",
    tipo: str = "",
    generador: str = "",
    sunat: str = "",
    sucursal: int | None = None,
    q: str = "",
) -> bool:
    if resultado and _texto(fila.get("resultado")).upper() != resultado.upper():
        return False
    if estados and _texto(fila.get("estado_generacion")) not in estados:
        return False
    if incidencia:
        buscada = incidencia.strip().upper()
        if not any(
            _texto(item).upper() == buscada
            for item in fila.get("incidencias") or []
        ):
            return False
    if tipo and _texto(fila.get("tipo")).upper() != tipo.upper():
        return False
    if generador and _texto(fila.get("generador")).upper() != generador.upper():
        return False
    if sunat and _texto(fila.get("estado_sunat")).upper() != sunat.upper():
        return False
    if sucursal is not None and int(fila.get("sucursal") or 0) != int(sucursal):
        return False
    if q:
        aguja = q.strip().lower()
        campos = (
            _texto(fila.get("comprobante")),
            _texto(fila.get("documento")),
            _texto(fila.get("cliente")),
            _texto(fila.get("mov_id")),
            _texto(fila.get("mov")),
            _texto(fila.get("sucursal_nombre")),
            _texto(fila.get("cliente_codigo")),
            str(fila.get("id_venta") or ""),
        )
        if not any(aguja in campo.lower() for campo in campos):
            return False
    return True


def _por_dia(filas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Cobertura por dia: emitidos, sin traza y con incidencia.

    Es el equivalente del bloque "cobertura" de la pestana FE del PHP (alli
    era la carga del portal; aca, la cobertura del generador).
    """
    dias: dict[str, dict[str, Any]] = {}
    for fila in filas:
        dia = _texto(fila.get("fecha_emision"))
        if not dia:
            continue
        item = dias.setdefault(
            dia,
            {
                "dia": dia,
                "documentos": 0,
                "sin_traza": 0,
                "con_incidencia": 0,
            },
        )
        item["documentos"] += 1
        if fila["estado_generacion"] == dominio.ESTADO_SIN_REGISTRO:
            item["sin_traza"] += 1
        if fila["resultado"] != dominio.RESULTADO_CONFORME:
            item["con_incidencia"] += 1
    return [dias[dia] for dia in sorted(dias, reverse=True)]


def _adjuntar_sunat(
    filas: list[dict[str, Any]],
    store: SunatCacheStore | None,
    ruc: str,
) -> None:
    """Lee el estado SUNAT del cache local (cero llamadas al validador).

    La identidad sale del documento oficial (``serie-numero``) y del tipo
    de Intelisis (``TipoDocumentoPU``), no de un voucher de SynerPOS.
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
        # por clave contra el cache tarda dezenas de segundos.
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


def _kpis(filas: list[dict[str, Any]]) -> dict[str, Any]:
    conformes = sum(1 for f in filas if f["resultado"] == "CONFORME")
    sin_traza = sum(
        1
        for f in filas
        if f["estado_generacion"] == dominio.ESTADO_SIN_REGISTRO
        and not f["exento_generador"]
    )
    sin_cobertura = sum(
        1 for f in filas if f["estado_sunat"] == dominio.SUNAT_SIN_CONSULTA
    )
    por_sucursal: dict[int, dict[str, Any]] = {}
    for fila in filas:
        clave = int(fila.get("sucursal") or 0)
        item = por_sucursal.setdefault(
            clave,
            {
                "sucursal": clave,
                "nombre": fila.get("sucursal_nombre") or "Sin nombre",
                "ventas": 0,
                "incidencias": 0,
            },
        )
        item["ventas"] += 1
        if fila["resultado"] != "CONFORME":
            item["incidencias"] += 1
    return {
        "total": len(filas),
        "conformes": conformes,
        "con_incidencia": len(filas) - conformes,
        "sin_traza": sin_traza,
        "en_espera": sum(1 for f in filas if f["en_espera"]),
        "no_aplica": sum(1 for f in filas if f["exento_generador"]),
        "sin_cobertura_sunat": sin_cobertura,
        "por_generador": dominio.resumen_por_generador(filas),
        "por_incidencia": dominio.resumen_por_incidencia(filas),
        "por_sucursal": sorted(
            por_sucursal.values(), key=lambda item: item["sucursal"]
        ),
    }


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
    incidencia: str = "",
    tipo: str = "",
    generador: str = "",
    sunat: str = "",
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
        _fila(row, momento)
        for row in reader.fetch_rows(_iso(inicio), _iso(fin))
    ]

    if len(filas) > MAX_VENTAS:
        raise RangoInvalidoError(
            f"Mas de {MAX_VENTAS} ventas. Reduzca el periodo."
        )

    # SUNAT: solo lectura del cache local (cero llamadas al validador).
    _adjuntar_sunat(filas, sunat_store, sunat_ruc)
    for fila in filas:
        cacheado = fila.get("sunat") or {}
        estado_sunat, incidencias_sunat = dominio.clasificar_sunat(
            cacheado.get("estado")
        )
        fila["estado_sunat"] = estado_sunat
        fila["incidencias"], fila["resultado"] = dominio.combine_incidencias(
            fila["incidencias"], incidencias_sunat
        )

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

    kpis = _kpis(filas)
    kpis["por_dia"] = _por_dia(filas)

    filtradas = [
        fila
        for fila in filas
        if _aplica_filtros(
            fila,
            resultado=resultado,
            estados=estados,
            incidencia=incidencia,
            tipo=tipo,
            generador=generador,
            sunat=sunat,
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
        "filtrados=%d truncado=%s duracion_ms=%d",
        correlation_id,
        inicio.isoformat(),
        fin.isoformat(),
        kpis["total"],
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
        "rows": [
            {campo: fila.get(campo) for campo in CAMPOS_LISTA}
            for fila in filtradas
        ],
    }


def _intento(row: Mapping[str, Any]) -> dict[str, Any]:
    """Un intento de la bitacora, listo para el drawer de trazabilidad."""
    return {
        "log_id": int(row.get("LogID") or 0),
        "estado": _texto(row.get("Estado")),
        "etapa": _texto(row.get("Etapa")),
        "documento": _texto(row.get("Documento")),
        "detalle": _texto(row.get("Detalle")),
        "error_mensaje": _texto(row.get("ErrorMensaje")),
        "fecha_inicio": _texto(row.get("FechaInicio")),
        "fecha_fin": _texto(row.get("FechaFin")),
        "archivo_out": _texto(row.get("ArchivoOut")),
        "procedimiento": _texto(row.get("Procedimiento")),
        "duracion_ms": row.get("DuracionMs"),
        "hash": _texto(row.get("HashSalida")),
        "tipo_movimiento": _texto(row.get("TipoMovimiento")),
    }


def _con_sunat(
    fila: dict[str, Any],
    store: SunatCacheStore | None,
    ruc: str,
) -> dict[str, Any]:
    """Adjunta el estado SUNAT del cache a una fila ya clasificada."""
    _adjuntar_sunat([fila], store, ruc)
    cacheado = fila.get("sunat") or {}
    estado_sunat, incidencias_sunat = dominio.clasificar_sunat(
        cacheado.get("estado")
    )
    fila["estado_sunat"] = estado_sunat
    fila["incidencias"], fila["resultado"] = dominio.combine_incidencias(
        fila["incidencias"], incidencias_sunat
    )
    return fila


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
    fila = _con_sunat(_fila(rows[0], momento), sunat_store, sunat_ruc)
    intentos = [_intento(item) for item in reader.fetch_attempts(id_venta)]
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
    fila = _fila(rows[0], momento)
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
