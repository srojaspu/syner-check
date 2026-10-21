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

import logging
import time
import uuid
from typing import Any

from src.domain.entities import TipoDocumento
from src.domain.errors import (
    InvalidDocumentTypeError,
    InvalidRangeError,
    MovSynerPosValidationError,
    NotFoundError,
    UpstreamError,
)
from src.domain.movsynerpos import (
    MAX_DOCUMENTOS,
    DocumentoMovSynerPos,
    build_documento,
    normalize_date_iso,
)

from .key_lock import StripedLock
from .ports import GraphqlGateway, MovSynerPosWriter
from .use_cases import get_detail

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
        return "No fue posible consultar o escribir en SynerPOS."
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
        }
    if not pendientes:
        return {"estado": ESTADO_SIN_CAMBIOS, "insertadas": 0, "error": None}

    inserted = writer.insert_lines(documento, pendientes)
    if not inserted:
        return {"estado": ESTADO_SIN_CAMBIOS, "insertadas": 0, "error": None}
    return {"estado": ESTADO_REPARADO, "insertadas": inserted, "error": None}


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
