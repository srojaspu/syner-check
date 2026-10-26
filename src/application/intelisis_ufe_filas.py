"""Traduccion de la fila del lector UFE al modelo de la pantalla.

Funciones puras sobre la fila que devuelve el puerto ``IntelisisUfeReader``:
no tocan la base ni el reloj (la hora llega como argumento). Aqui viven la
fila de la grilla, los KPIs, la cobertura por dia y los filtros; los casos
de uso estan en ``src.application.intelisis_ufe``.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Mapping, Sequence

from src.domain import intelisis_ufe as dominio

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
    "tipo_sunat",
    "estado_sunat",
    "sunat",
)


def texto(valor: Any) -> str:
    """Texto normalizado (sin espacios sobrantes)."""
    return str(valor if valor is not None else "").strip()


def numero(valor: Any) -> float:
    try:
        return float(valor)
    except (TypeError, ValueError):
        return 0.0


def entero(valor: Any, por_defecto: int = 0) -> int:
    try:
        return int(valor)
    except (TypeError, ValueError):
        return por_defecto


def fila_documento(row: Mapping[str, Any], ahora: datetime) -> dict[str, Any]:
    """Fila de la grilla a partir de la lectura del puerto.

    El documento oficial sale de la bitacora; si no hay traza se calcula el
    estimado y se marca como tal (D18). La identidad de SUNAT lleva el
    prefijo de tipo (D26).
    """
    tipo_documento_pu = texto(row.get("TipoDocumentoPU"))
    referencia = texto(row.get("Referencia"))
    serie, correlativo = dominio.identidad_documento(
        row.get("ServicioSerie"),
        entero(row.get("Sucursal")),
        row.get("SeriePU"),
        bool(row.get("GenerarTxtPeru")),
        row.get("MovID"),
    )
    documento_teorico = f"{serie}-{correlativo}"
    documento_bitacora = texto(row.get("Documento"))
    documento = documento_bitacora or documento_teorico
    estimado = not documento_bitacora
    comprobante = dominio.comprobante_sunat(
        tipo_documento_pu,
        referencia,
        row.get("ServicioSerie"),
        entero(row.get("Sucursal")),
        row.get("SeriePU"),
        row.get("MovID"),
    )

    fecha_emision = _fecha(row.get("FechaEmision"))
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
        ahora=ahora,
        tipo_documento_pu=tipo_documento_pu,
        referencia=referencia,
    )

    return {
        "id_venta": entero(row.get("IDVenta")),
        "tipo": dominio.TIPO_MOVIMIENTO.get(tipo_documento_pu, "NN"),
        "tipo_documento_pu": tipo_documento_pu,
        "documento": documento,
        "documento_estimado": estimado,
        "documento_teorico": documento_teorico,
        "comprobante": comprobante,
        "mov": texto(row.get("Mov")),
        "mov_id": texto(row.get("MovID")),
        "fecha_emision": fecha_emision.isoformat(),
        "sucursal": entero(row.get("Sucursal")),
        "sucursal_nombre": texto(row.get("SucursalNombre")) or "Sin nombre",
        "cliente": texto(row.get("ClienteNombre")),
        "cliente_codigo": texto(row.get("Cliente")),
        "ruc": texto(row.get("ClienteRfc")),
        "importe": numero(row.get("Importe")),
        "impuestos": numero(row.get("Impuestos")),
        "total": round(
            numero(row.get("Importe")) + numero(row.get("Impuestos")), 2
        ),
        "estatus_erp": texto(row.get("Estatus")),
        "referencia": referencia,
        "estado_generacion": clasificacion["estado_generacion"],
        "generador": clasificacion["generador"],
        "incidencias": clasificacion["incidencias"],
        "resultado": clasificacion["resultado"],
        "detalle_incidencia": clasificacion["detalle_incidencia"],
        "en_espera": clasificacion["en_espera"],
        "exento_generador": clasificacion["exento_generador"],
        "fuera_de_bitacora": clasificacion["fuera_de_bitacora"],
        "etapa": texto(row.get("Etapa")),
        "intentos": entero(row.get("Intentos")),
        "ok_registrados": entero(row.get("OkRegistrados")),
        "ultimo_intento": texto(row.get("FechaInicio")),
        "hash": texto(row.get("HashSalida")),
        "archivo_out": texto(row.get("ArchivoOut")),
        "procedimiento": texto(row.get("Procedimiento")),
        "tipo_sunat": dominio.TIPO_DOCUMENTO_SUNAT.get(tipo_documento_pu, ""),
        "sunat": None,
        "estado_sunat": dominio.SUNAT_SIN_CONSULTA,
        "reenvio": None,
    }


def _fecha(valor: Any) -> date:
    texto_fecha = texto(valor)[:10]
    try:
        return date.fromisoformat(texto_fecha)
    except ValueError:
        return date.min


def fila_intento(row: Mapping[str, Any]) -> dict[str, Any]:
    """Un intento de la bitacora, listo para el drawer de trazabilidad."""
    return {
        "log_id": entero(row.get("LogID")),
        "estado": texto(row.get("Estado")),
        "etapa": texto(row.get("Etapa")),
        "documento": texto(row.get("Documento")),
        "detalle": texto(row.get("Detalle")),
        "error_mensaje": texto(row.get("ErrorMensaje")),
        "fecha_inicio": texto(row.get("FechaInicio")),
        "fecha_fin": texto(row.get("FechaFin")),
        "archivo_out": texto(row.get("ArchivoOut")),
        "procedimiento": texto(row.get("Procedimiento")),
        "duracion_ms": row.get("DuracionMs"),
        "hash": texto(row.get("HashSalida")),
        "tipo_movimiento": texto(row.get("TipoMovimiento")),
    }


def aplica_filtros(
    fila: Mapping[str, Any],
    *,
    resultado: str = "",
    estados: Sequence[str] = (),
    incidencia: str = "",
    tipos: Sequence[str] = (),
    generador: str = "",
    sunat: str = "",
    estatus: str = "",
    sucursal: int | None = None,
    q: str = "",
) -> bool:
    """True si la fila pasa los filtros del listado (se aplican en el server)."""
    if resultado and texto(fila.get("resultado")).upper() != resultado.upper():
        return False
    if estados and texto(fila.get("estado_generacion")) not in estados:
        return False
    if incidencia:
        buscada = incidencia.strip().upper()
        if not any(
            texto(item).upper() == buscada
            for item in fila.get("incidencias") or []
        ):
            return False
    if tipos and texto(fila.get("tipo")).upper() not in {
        texto(item).upper() for item in tipos
    }:
        return False
    if generador and texto(fila.get("generador")).upper() != generador.upper():
        return False
    if sunat and texto(fila.get("estado_sunat")).upper() != sunat.upper():
        return False
    if estatus and texto(fila.get("estatus_erp")).upper() != estatus.upper():
        return False
    if sucursal is not None and entero(fila.get("sucursal")) != int(sucursal):
        return False
    if q:
        aguja = q.strip().lower()
        campos = (
            texto(fila.get("comprobante")),
            texto(fila.get("documento")),
            texto(fila.get("cliente")),
            texto(fila.get("mov_id")),
            texto(fila.get("mov")),
            texto(fila.get("sucursal_nombre")),
            texto(fila.get("cliente_codigo")),
            str(fila.get("id_venta") or ""),
        )
        if not any(aguja in campo.lower() for campo in campos):
            return False
    return True


def _por_campo(
    filas: list[dict[str, Any]], campo: str
) -> list[dict[str, Any]]:
    """Conteo por valor de un campo, de mayor a menor (para los cards)."""
    conteo: dict[str, int] = {}
    for fila in filas:
        clave = texto(fila.get(campo))
        if clave:
            conteo[clave] = conteo.get(clave, 0) + 1
    return [
        {"key": clave, "count": total}
        for clave, total in sorted(conteo.items(), key=lambda par: (-par[1], par[0]))
    ]


def resumen(filas: list[dict[str, Any]]) -> dict[str, Any]:
    """KPIs del periodo (se calculan sobre el periodo, no sobre el filtro).

    ``sin_traza`` cuenta la **incidencia** de D19, no el estado tecnico: una
    venta PENDIENTE sin registro todavia no debia pasar por el generador, asi
    que se informa aparte en ``pendientes_conclusion``. Antes se contaba por
    ``estado_generacion`` y las PENDIENTE inflaban el "sin traza".
    """
    conformes = sum(1 for f in filas if f["resultado"] == "CONFORME")
    sin_traza = sum(
        1
        for f in filas
        if dominio.INCIDENCIA_SIN_TRAZA in (f.get("incidencias") or [])
    )
    pendientes_conclusion = sum(
        1
        for f in filas
        if texto(f.get("estatus_erp")).upper() == "PENDIENTE"
        and f.get("estado_generacion") == dominio.ESTADO_SIN_REGISTRO
        and not f.get("exento_generador")
    )
    sin_cobertura = sum(
        1 for f in filas if f["estado_sunat"] == dominio.SUNAT_SIN_CONSULTA
    )
    por_sucursal: dict[int, dict[str, Any]] = {}
    for fila in filas:
        clave = entero(fila.get("sucursal"))
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
        "pendientes_conclusion": pendientes_conclusion,
        "en_espera": sum(1 for f in filas if f["en_espera"]),
        "no_aplica": sum(1 for f in filas if f["exento_generador"]),
        "sin_cobertura_sunat": sin_cobertura,
        # Documentos que SUNAT puede consultar (los que tienen tipo valido).
        "sunat_consultables": sum(1 for f in filas if f.get("tipo_sunat")),
        # Lo que la grilla puede devolver: los dos estados con documento.
        "por_estatus_listado": _por_campo(filas, "estatus_erp"),
        "por_estado_generacion": _por_campo(filas, "estado_generacion"),
        "por_estado_sunat": _por_campo(filas, "estado_sunat"),
        "por_generador": dominio.resumen_por_generador(filas),
        "por_incidencia": dominio.resumen_por_incidencia(filas),
        "por_sucursal": sorted(
            por_sucursal.values(), key=lambda item: item["sucursal"]
        ),
    }


def cobertura_por_dia(filas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Emitidos, sin traza y con incidencia, dia por dia.

    ``sin_traza`` es la incidencia de D19 (solo CONCLUIDO): un documento
    PENDIENTE sin bitacora no es una falla del generador.
    """
    dias: dict[str, dict[str, Any]] = {}
    for fila in filas:
        dia = texto(fila.get("fecha_emision"))
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
        if dominio.INCIDENCIA_SIN_TRAZA in (fila.get("incidencias") or []):
            item["sin_traza"] += 1
        if fila["resultado"] != dominio.RESULTADO_CONFORME:
            item["con_incidencia"] += 1
    return [dias[dia] for dia in sorted(dias, reverse=True)]


def fila_sin_documento(row: Mapping[str, Any]) -> dict[str, Any]:
    """Una venta SINAFECTAR, lista para el dialogo de "Ventas sin documentar".

    ``situacion`` distingue las dos causas reales: ``sin_documento`` (nunca
    llego a la bitacora) y ``documento_invalido`` (el generador lo intento y
    el numero no era valido, p. ej. ``175-00000000``). Nunca se expone un
    numero invalido como si fuera un comprobante.
    """
    invalido = texto(row.get("DocumentoInvalido"))
    return {
        "id_venta": entero(row.get("IDVenta")),
        "mov": texto(row.get("Mov")),
        "mov_id": texto(row.get("MovID")) or None,
        "documento": texto(row.get("Documento")) or None,
        "documento_invalido": invalido or None,
        "situacion": "documento_invalido" if invalido else "sin_documento",
        "fecha_emision": texto(row.get("FechaEmision"))[:10],
        "sucursal": entero(row.get("Sucursal")),
        "sucursal_nombre": texto(row.get("SucursalNombre")) or "Sin nombre",
        "cliente": texto(row.get("ClienteNombre")),
        "total": round(
            numero(row.get("Importe")) + numero(row.get("Impuestos")), 2
        ),
    }


def proyecto_lista(fila: Mapping[str, Any]) -> dict[str, Any]:
    """Proyecta la fila a los campos que viaja en el listado."""
    return {campo: fila.get(campo) for campo in CAMPOS_LISTA}
