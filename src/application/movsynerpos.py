"""Caso de uso: reenvío manual de documentos SynerCom -> dbo.MovSynerPos.

Reglas de negocio (D2-D8 del plan):
- El cliente solo envía identidad ``{tipo, oid, number, date}``; el backend
  re-consulta el detalle y nunca confía en montos ni líneas del navegador.
- Idempotencia por línea ``(IDSynerPos, TipoDocumento, Idx)`` y detección de
  colisión por ``(SerieNumero, TipoDocumento, Idx)``.
- ``reparar=false`` omite documentos que ya tienen líneas; ``reparar=true``
  inserta solo las faltantes. No hay UPDATE ni DELETE.
- Un fallo de un documento no aborta el lote.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any

from src.domain.entities import TipoDocumento
from src.domain.errors import (
    InvalidDocumentTypeError,
    InvalidRangeError,
    MovSynerPosDeleteBlockedError,
    MovSynerPosValidationError,
    NotFoundError,
    UpstreamError,
)
from src.domain.movsynerpos import (
    ESTADO_ELIMINADO,
    MAX_DOCUMENTOS,
    DocumentoMovSynerPos,
    build_documento,
    normalize_date_iso,
    validate_delete_params,
)

from .key_lock import StripedLock
from .ports import GraphqlGateway, IntelisisReader, MovSynerPosWriter
from .use_cases import _flow_key, _intelisis_index, _norm_receipt, get_detail

logger = logging.getLogger("syner_check.movsynerpos")

ESTADO_INSERTADO = "insertado"
ESTADO_REPARADO = "reparado"
ESTADO_SIN_CAMBIOS = "sin_cambios"
ESTADO_CONFLICTO = "conflicto"
ESTADO_ERROR = "error"

# Un lock por (tipo, oid): dos sesiones no pueden verificar+insertar a la vez.
_MOVSYNERPOS_LOCK = StripedLock(4096)


def _normalize_request(documentos: Any) -> list[dict[str, str]]:
    """Valida el payload del borde; lanza ValueError (HTTP 400)."""
    if not isinstance(documentos, list) or not documentos:
        raise ValueError("Sin documentos para enviar.")
    if len(documentos) > MAX_DOCUMENTOS:
        raise ValueError(f"Límite por solicitud: {MAX_DOCUMENTOS} documentos.")

    normalized: list[dict[str, str]] = []
    for raw in documentos:
        if not isinstance(raw, dict):
            raise ValueError("Cada documento debe ser un objeto.")
        try:
            tipo = TipoDocumento.parse(str(raw.get("tipo", ""))).value
        except InvalidDocumentTypeError as exc:
            raise ValueError("Tipo de documento no permitido.") from exc
        oid = str(raw.get("oid", "") or "").strip()
        if not oid:
            raise ValueError("Cada documento necesita oid.")
        try:
            fecha = normalize_date_iso(raw.get("date"))
        except MovSynerPosValidationError as exc:
            raise ValueError(str(exc)) from exc
        normalized.append(
            {
                "tipo": tipo,
                "oid": oid,
                "number": str(raw.get("number", "") or "").strip(),
                "date": fecha,
            }
        )
    return normalized


def _error_message(exc: Exception) -> str:
    if isinstance(exc, NotFoundError):
        return "Documento no encontrado en SynerCom."
    if isinstance(exc, MovSynerPosValidationError):
        return str(exc) or "El documento no se puede mapear a SynerPOS."
    if isinstance(exc, InvalidRangeError):
        return "Fecha del documento inválida."
    if isinstance(exc, UpstreamError):
        # El adaptador deja aquí una causa accionable y saneada (permiso,
        # columna/tabla inexistente, dato inválido). Si no la trae, se mantiene
        # el mensaje genérico para no filtrar detalles internos.
        return (
            getattr(exc, "public_message", None)
            or "No fue posible consultar o escribir en SynerPOS."
        )
    return "No se pudo reenviar el documento."


def _detalle(tipo: str, oid: str, number: str, estado: str, **kwargs: Any) -> dict:
    return {
        "tipo": tipo,
        "oid": oid,
        "number": number,
        "estado": estado,
        "lineas_insertadas": int(kwargs.get("insertadas", 0)),
        "lineas_existentes": int(kwargs.get("existentes", 0)),
        "lineas_faltantes": int(kwargs.get("faltantes", 0)),
        "error": kwargs.get("error"),
        # Registros existentes que bloquean la inserción (identidad completa
        # para que el operador sepa exactamente qué eliminaría).
        "conflictos": list(kwargs.get("conflictos") or []),
    }


def _process(
    gateway: GraphqlGateway,
    writer: MovSynerPosWriter,
    item: dict[str, str],
    *,
    reparar: bool,
    correlation_id: str,
) -> dict:
    tipo = item["tipo"]
    oid = item["oid"]
    number = item["number"]
    started = time.monotonic()
    estado = ESTADO_ERROR
    conflictos: list[dict[str, Any]] = []
    inserted = 0
    existing = 0
    missing = 0
    error: str | None = None

    try:
        detail = get_detail(
            gateway,
            tipo=TipoDocumento.parse(tipo),
            oid=oid,
            doc_date_iso=item["date"],
            number=number or None,
        )
        documento: DocumentoMovSynerPos = build_documento(
            tipo, detail["document"]
        )
        number = documento.number or number
        total = documento.total_lineas
        serie = (documento.number or "").strip().upper()

        with _MOVSYNERPOS_LOCK.hold([(tipo, oid.upper())]):
            existentes = writer.existing_lines(oid, tipo)
            idxs = [int(line["Idx"]) for line in documento.lineas]
            existing = sum(1 for idx in idxs if idx in existentes)
            missing = total - existing

            if existentes:
                mismatch = [
                    idx
                    for idx, serie_existente in existentes.items()
                    if str(serie_existente or "").strip().upper() != serie
                ]
                if mismatch:
                    estado = ESTADO_CONFLICTO
                    # El conflicto está en las series ya registradas para el
                    # mismo oid; se reportan con su identidad para poder
                    # eliminarlas desde la UI.
                    todas = _conflicto_entries(
                        writer, tipo, oid, fallback_serie=serie
                    )
                    conflictos = [
                        entry
                        for entry in todas
                        if str(entry.get("number") or "").strip().upper()
                        != serie
                    ] or todas
                    error = (
                        "Ya existen líneas de este oid con otra serie; "
                        "no se insertó nada."
                    )
                elif not reparar or missing == 0:
                    estado = ESTADO_SIN_CAMBIOS
                else:
                    outcome = _insertar_faltantes(
                        writer,
                        documento,
                        existentes,
                        serie,
                        tipo,
                        oid,
                    )
                    inserted = int(outcome["insertadas"])
                    error = outcome["error"]
                    estado = outcome["estado"]
                    conflictos = list(outcome.get("conflictos") or [])
            else:
                outcome = _insertar_faltantes(
                    writer,
                    documento,
                    existentes,
                    serie,
                    tipo,
                    oid,
                    all_lines=True,
                )
                inserted = int(outcome["insertadas"])
                error = outcome["error"]
                estado = outcome["estado"]
                conflictos = list(outcome.get("conflictos") or [])
                if estado == ESTADO_REPARADO:
                    estado = ESTADO_INSERTADO
    except Exception as exc:  # noqa: BLE001 - un documento no aborta el lote
        estado = ESTADO_ERROR
        error = _error_message(exc)
        logger.warning(
            "MovSynerPos doc correlation_id=%s tipo=%s oid=%s estado=error "
            "error_class=%s elapsed_ms=%d",
            correlation_id,
            tipo,
            oid,
            type(exc).__name__,
            int((time.monotonic() - started) * 1000),
        )
        return _detalle(
            tipo,
            oid,
            number,
            estado,
            insertadas=inserted,
            existentes=existing,
            faltantes=missing,
            error=error,
            conflictos=conflictos,
        )

    logger.info(
        "MovSynerPos doc correlation_id=%s tipo=%s oid=%s number=%s estado=%s "
        "lineas_insertadas=%d lineas_existentes=%d elapsed_ms=%d",
        correlation_id,
        tipo,
        oid,
        number,
        estado,
        inserted,
        existing,
        int((time.monotonic() - started) * 1000),
    )
    return _detalle(
        tipo,
        oid,
        number,
        estado,
        insertadas=inserted,
        existentes=existing,
        faltantes=missing,
        error=error,
        conflictos=conflictos,
    )


def _insertar_faltantes(
    writer: MovSynerPosWriter,
    documento: DocumentoMovSynerPos,
    existentes: dict[int, str],
    serie: str,
    tipo: str,
    oid: str,
    *,
    all_lines: bool = False,
) -> dict[str, Any]:
    """Inserta solo líneas que no existen; detecta colisión de serie."""
    pendientes = [
        line
        for line in documento.lineas
        if all_lines or int(line["Idx"]) not in existentes
    ]
    conflicts = writer.serie_conflicts(
        tipo, serie, [int(line["Idx"]) for line in pendientes]
    )
    # El mismo oid en la PK no es una colisión: es una línea ya insertada.
    foreign = {
        idx: owner
        for idx, owner in conflicts.items()
        if str(owner or "").strip().upper() != oid.strip().upper()
    }
    if foreign:
        return {
            "estado": ESTADO_CONFLICTO,
            "insertadas": 0,
            "error": (
                "Existe otra línea con la misma serie y número de línea; "
                "no se insertó nada."
            ),
            "conflictos": [
                entry
                for owner in sorted({str(value) for value in foreign.values()})
                for entry in _conflicto_entries(
                    writer, tipo, owner, fallback_serie=serie
                )
            ],
        }
    if not pendientes:
        return {
            "estado": ESTADO_SIN_CAMBIOS,
            "insertadas": 0,
            "error": None,
            "conflictos": [],
        }

    inserted = writer.insert_lines(documento, pendientes)
    if not inserted:
        return {
            "estado": ESTADO_SIN_CAMBIOS,
            "insertadas": 0,
            "error": None,
            "conflictos": [],
        }
    return {
        "estado": ESTADO_REPARADO,
        "insertadas": inserted,
        "error": None,
        "conflictos": [],
    }


def send_movsynerpos(
    gateway: GraphqlGateway,
    writer: MovSynerPosWriter,
    *,
    documentos: Any,
    reparar: bool = False,
    actor: str = "",
    correlation_id: str = "",
) -> dict:
    """Reenvía los documentos pedidos; nunca confía en datos del navegador."""
    items = _normalize_request(documentos)
    correlation = (correlation_id or "").strip() or str(uuid.uuid4())
    started = time.monotonic()
    logger.info(
        "MovSynerPos send start correlation_id=%s actor=%s total=%d reparar=%s",
        correlation,
        actor or "-",
        len(items),
        bool(reparar),
    )

    detalle = [
        _process(
            gateway,
            writer,
            item,
            reparar=bool(reparar),
            correlation_id=correlation,
        )
        for item in items
    ]

    def count(state: str) -> int:
        return sum(1 for row in detalle if row["estado"] == state)

    result = {
        "solicitud_id": correlation,
        "total": len(detalle),
        "insertados": count(ESTADO_INSERTADO),
        "reparados": count(ESTADO_REPARADO),
        "sin_cambios": count(ESTADO_SIN_CAMBIOS),
        "conflictos": count(ESTADO_CONFLICTO),
        "errores": count(ESTADO_ERROR),
        "detalle": detalle,
    }
    logger.info(
        "MovSynerPos send done correlation_id=%s total=%d insertados=%d "
        "reparados=%d sin_cambios=%d conflictos=%d errores=%d elapsed_ms=%d",
        correlation,
        result["total"],
        result["insertados"],
        result["reparados"],
        result["sin_cambios"],
        result["conflictos"],
        result["errores"],
        int((time.monotonic() - started) * 1000),
    )
    return result


def _iso_date(value: Any) -> str:
    """``datetime``/``date``/``str`` -> ``YYYY-MM-DD`` (vacío si inválido)."""
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return str(value.isoformat())[:10]
    return str(value)[:10]


def _single_line(value: str) -> str:
    """Neutraliza saltos de línea en texto libre antes de loguearlo.

    El motivo lo escribe el operador y en formato de log ``text`` un ``\\n``
    podría falsear una línea nueva del log de auditoría.
    """
    return " ".join(str(value).split())


def _conflicto_entries(
    writer: MovSynerPosWriter,
    tipo: str,
    owner_oid: str,
    *,
    fallback_serie: str = "",
) -> list[dict[str, Any]]:
    """Identidad y resumen del registro que bloquea la inserción.

    Se agrupa por serie porque el borrado es ``oid + tipo + serie``: si el
    mismo oid tuviera líneas de dos series, la UI debe ofrecer ambas y el
    operador ve exactamente qué desaparecería. Si el snapshot falla se
    devuelve la identidad mínima y el flujo sigue siendo accionable.
    """
    rows: list[dict] = []
    try:
        rows = writer.document_lines(owner_oid, tipo)
    except Exception as exc:  # noqa: BLE001 - el conflicto no debe caerse
        logger.warning(
            "MovSynerPos conflict snapshot failed oid=%s error_class=%s",
            owner_oid,
            type(exc).__name__,
        )

    grouped: dict[str, list[dict]] = {}
    for row in rows:
        serie = str(row.get("SerieNumero") or "").strip() or fallback_serie
        grouped.setdefault(serie, []).append(row)

    if not grouped:
        return [
            {
                "oid": owner_oid,
                "number": fallback_serie,
                "lineas": 0,
                "total": None,
                "fecha": "",
            }
        ]

    entries: list[dict[str, Any]] = []
    for serie, group in grouped.items():
        try:
            total: Decimal | None = sum(
                (
                    Decimal(str(row.get("CrossTotal") or "0"))
                    for row in group
                ),
                Decimal("0"),
            )
        except (InvalidOperation, ValueError):
            total = None
        entries.append(
            {
                "oid": owner_oid,
                "number": serie,
                "lineas": len(group),
                "total": str(total) if total is not None else None,
                "fecha": _iso_date(group[0].get("FechaDocumento")),
            }
        )
    return entries


def _intelisis_estatus(
    reader: IntelisisReader | None,
    *,
    tipo: str,
    number: str,
    fecha_iso: str,
    correlation_id: str,
) -> str | None:
    """Best-effort Intelisis status for the document, or ``None``.

    A failure here never blocks the deletion: Intelisis is a cross-system
    read and the operator already confirmed the document is wrong. The
    returned value is only used to refuse deleting a *concluded* sale.
    """
    if reader is None or not fecha_iso:
        return None
    try:
        headers = reader.fetch_headers(fecha_iso, fecha_iso)
    except Exception as exc:  # noqa: BLE001 - degraded mode, no bloquea
        logger.warning(
            "MovSynerPos delete intelisis check failed correlation_id=%s "
            "error_class=%s",
            correlation_id,
            type(exc).__name__,
        )
        return None
    row = _intelisis_index(headers).get(
        _flow_key(tipo, _norm_receipt(number), fecha_iso)
    )
    if row is None:
        return ""
    return str(row.get("EstatusIntelisis") or "").strip().upper()


def delete_movsynerpos(
    writer: MovSynerPosWriter,
    intelisis: IntelisisReader | None,
    *,
    oid: Any,
    tipo: Any,
    number: Any,
    motivo: Any,
    forzar: bool = False,
    actor: str = "",
    correlation_id: str = "",
) -> dict:
    """Elimina de MovSynerPos las líneas de un documento erróneo.

    Es la contraparte destructiva del reenvío manual: SynerCom a veces duplica
    un comprobante y migra el equivocado, y la colisión por serie impide
    insertar el correcto. El borrado es quirúrgico (un documento), auditado y
    bloqueado si Intelisis ya concluyó la venta.
    """
    params = validate_delete_params(oid, tipo, number, motivo)
    clean_oid = params["oid"]
    clean_tipo = params["tipo"]
    clean_number = params["number"]
    clean_motivo = params["motivo"]
    correlation = (correlation_id or "").strip() or str(uuid.uuid4())
    started = time.monotonic()

    logger.info(
        "MovSynerPos delete start correlation_id=%s actor=%s tipo=%s oid=%s "
        "number=%s forzar=%s",
        correlation,
        actor or "-",
        clean_tipo,
        clean_oid,
        clean_number,
        bool(forzar),
    )

    with _MOVSYNERPOS_LOCK.hold([(clean_tipo, clean_oid.upper())]):
        rows = writer.document_lines(clean_oid, clean_tipo)
        if not rows:
            raise NotFoundError(
                "No se encontraron líneas en MovSynerPos para el comprobante indicado."
            )

        series = {
            str(row.get("SerieNumero") or "").strip().upper() for row in rows
        }
        if series != {clean_number}:
            raise ValueError(
                "La serie/número enviada no coincide con la registrada para ese oid; "
                "no se eliminó nada."
            )

        fecha_iso = _iso_date(rows[0].get("FechaDocumento"))
        estatus = _intelisis_estatus(
            intelisis,
            tipo=clean_tipo,
            number=clean_number,
            fecha_iso=fecha_iso,
            correlation_id=correlation,
        )
        if estatus == "CONCLUIDO" and not forzar:
            raise MovSynerPosDeleteBlockedError(
                "El comprobante ya fue concluido en Intelisis; anúlalo en el ERP "
                "antes de eliminarlo de SynerPOS."
            )

        deleted = writer.delete_document(clean_oid, clean_tipo, clean_number)
        if deleted <= 0:
            raise NotFoundError(
                "No se encontraron líneas en MovSynerPos para el comprobante indicado."
            )

    snapshot = [
        {
            "idx": row.get("Idx"),
            "sku": row.get("Sku"),
            "cantidad": row.get("Cantidad"),
            "crossTotal": str(row.get("CrossTotal")),
        }
        for row in rows
    ]
    logger.info(
        "MovSynerPos delete done correlation_id=%s actor=%s tipo=%s oid=%s "
        "number=%s estado=%s lineas_eliminadas=%d intelisis=%s motivo=%s "
        "snapshot=%s elapsed_ms=%d",
        correlation,
        actor or "-",
        clean_tipo,
        clean_oid,
        clean_number,
        ESTADO_ELIMINADO,
        deleted,
        estatus if estatus is not None else "-",
        _single_line(clean_motivo),
        json.dumps(snapshot, ensure_ascii=False, default=str),
        int((time.monotonic() - started) * 1000),
    )

    return {
        "solicitud_id": correlation,
        "oid": clean_oid,
        "tipo": clean_tipo,
        "number": clean_number,
        "estado": ESTADO_ELIMINADO,
        "lineas_eliminadas": deleted,
        "mensaje": "Comprobante eliminado exitosamente de MovSynerPos.",
        "intelisis_estatus": estatus or None,
    }
