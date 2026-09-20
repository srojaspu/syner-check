"""Interface wiring. Translates domain outcomes to HTTP semantics."""

from __future__ import annotations

import logging
from datetime import date
from typing import Sequence

from fastapi import HTTPException

from src.application import get_detail, search_by_number, summarize
from src.domain.entities import TipoDocumento
from src.domain.errors import (
    InvalidDocumentTypeError,
    InvalidRangeError,
    NotFoundError,
    UpstreamError,
)
from src.infrastructure import GraphqlGatewayAdapter, SqlReaderAdapter

logger = logging.getLogger("syner_check.wiring")


def _tipos(values: Sequence[str]) -> list[TipoDocumento]:
    try:
        return [TipoDocumento.parse(v) for v in values]
    except InvalidDocumentTypeError:
        raise HTTPException(400, "Tipo de documento inválido.")


def summary(
    start_iso: str, end_iso: str, tipo_values: Sequence[str], max_range_days: int
) -> dict:
    try:
        result = summarize(
            SqlReaderAdapter(),
            GraphqlGatewayAdapter(),
            start_iso=start_iso,
            end_iso=end_iso,
            tipos=_tipos(tipo_values),
            max_range_days=max_range_days,
        )
    except InvalidRangeError:
        raise HTTPException(400, "Fechas inválidas.")
    except UpstreamError:
        logger.exception("Summary upstream failure")
        raise HTTPException(502, "No fue posible consultar los comprobantes.")
    return result


def search(number: str, fallback_days: int, today: date) -> dict:
    try:
        return search_by_number(
            SqlReaderAdapter(),
            GraphqlGatewayAdapter(),
            number=number,
            fallback_days=fallback_days,
            today=today,
        )
    except InvalidRangeError as exc:
        raise HTTPException(400, str(exc) if str(exc) else "Fechas inválidas.")
    except UpstreamError:
        logger.exception("Number search upstream failure")
        raise HTTPException(502, "No fue posible completar la búsqueda.")


def document_detail(
    tipo_value: str, oid: str, doc_date_iso: str, number: str | None = None
) -> dict:
    """Blocking call (run it off the event loop). Same contract as before."""
    try:
        tipo = TipoDocumento.parse(tipo_value)
    except InvalidDocumentTypeError:
        raise HTTPException(400, "Tipo inválido")
    try:
        return get_detail(
            GraphqlGatewayAdapter(),
            tipo=tipo,
            oid=oid,
            doc_date_iso=doc_date_iso,
            number=number,
        )
    except InvalidRangeError:
        raise HTTPException(400, "Fechas inválidas.")
    except NotFoundError:
        raise HTTPException(404, "Documento no encontrado")
    except UpstreamError:
        logger.exception("Document detail upstream failure")
        raise HTTPException(502, "No fue posible cargar el detalle.")
