"""Interface wiring. Translates domain outcomes to HTTP semantics."""

from __future__ import annotations

import logging
from datetime import date
from typing import Sequence

from fastapi import HTTPException

from src.application import (
    get_detail,
    reconcile_pending_sunat_jobs,
    search_by_number,
    submit_sunat_batch,
    summarize,
    sunat_job_status,
    sunat_revalidate,
)
from src.domain.entities import TipoDocumento
from src.domain.errors import (
    InvalidDocumentTypeError,
    InvalidRangeError,
    NotFoundError,
    UpstreamError,
)
from src.infrastructure import (
    GraphqlGatewayAdapter,
    IntelisisReaderAdapter,
    SqlReaderAdapter,
    SunatCacheStoreAdapter,
    SunatValidatorAdapter,
)

logger = logging.getLogger("syner_check.wiring")


def _tipos(values: Sequence[str]) -> list[TipoDocumento]:
    try:
        return [TipoDocumento.parse(v) for v in values]
    except InvalidDocumentTypeError:
        raise HTTPException(400, "Tipo de documento inválido.")


def _intelisis_reader():
    """Intelisis adapter when configured, else None (degraded flow)."""
    from app import db as app_db

    try:
        if app_db.intelisis_enabled():
            return IntelisisReaderAdapter()
    except Exception:
        logger.warning("Intelisis check failed; continuing degraded")
    return None


def _sunat_pair() -> tuple:
    """(validator, store, ruc, revalidate_hours) or (None, None, '', 24)."""
    from app import sunat_db as app_sunat
    from syner_check import config as cfg

    try:
        if not app_sunat.sunat_available():
            return None, None, "", 24
        validator = cfg.get_sunat_validator_config()
        return (
            SunatValidatorAdapter(),
            SunatCacheStoreAdapter(),
            validator["ruc"],
            int(validator.get("revalidate_hours", 24)),
        )
    except Exception:
        logger.warning("Sunat check failed; continuing without cache")
        return None, None, "", 24


def summary(
    start_iso: str, end_iso: str, tipo_values: Sequence[str], max_range_days: int
) -> dict:
    try:
        _sunat_validator, sunat_store, sunat_ruc, _hours = _sunat_pair()
        result = summarize(
            SqlReaderAdapter(),
            GraphqlGatewayAdapter(),
            start_iso=start_iso,
            end_iso=end_iso,
            tipos=_tipos(tipo_values),
            max_range_days=max_range_days,
            intelisis=_intelisis_reader(),
            sunat_store=sunat_store,
            sunat_ruc=sunat_ruc,
        )
    except InvalidRangeError:
        raise HTTPException(400, "Fechas inválidas.")
    except UpstreamError:
        logger.exception("Summary upstream failure")
        raise HTTPException(502, "No fue posible consultar los comprobantes.")
    return result


def search(number: str, fallback_days: int, today: date) -> dict:
    try:
        _sunat_validator, sunat_store, sunat_ruc, _hours = _sunat_pair()
        return search_by_number(
            SqlReaderAdapter(),
            GraphqlGatewayAdapter(),
            number=number,
            fallback_days=fallback_days,
            today=today,
            intelisis=_intelisis_reader(),
            sunat_store=sunat_store,
            sunat_ruc=sunat_ruc,
        )
    except InvalidRangeError as exc:
        raise HTTPException(400, str(exc) if str(exc) else "Fechas inválidas.")
    except UpstreamError:
        logger.exception("Number search upstream failure")
        raise HTTPException(502, "No fue posible completar la búsqueda.")


def sunat_submit(documentos: list[dict], usuario: str) -> dict:
    """Explicit SUNAT batch validation (quota-spending, user-triggered)."""
    validator, store, ruc, hours = _sunat_pair()
    if validator is None or store is None or not ruc:
        raise HTTPException(400, "Validación SUNAT no configurada.")
    if not isinstance(documentos, list) or not documentos:
        raise HTTPException(400, "Sin documentos para validar.")
    from syner_check import config as cfg

    try:
        return submit_sunat_batch(
            validator,
            store,
            documentos=documentos,
            usuario=usuario or "",
            ruc=ruc,
            revalidate_hours=hours,
            batch_max=int(
                cfg.get_sunat_validator_config().get("batch_size", 50)
            ),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc) if str(exc) else "Solicitud inválida.")
    except UpstreamError:
        logger.exception("Sunat submit upstream failure")
        raise HTTPException(502, "No fue posible registrar el lote SUNAT.")


def sunat_status(trabajo_id: int, usuario: str) -> dict:
    try:
        validator, store, _ruc, _hours = _sunat_pair()
        if validator is None or store is None:
            raise HTTPException(400, "Validación SUNAT no configurada.")
        return sunat_job_status(
            validator, store, trabajo_id=int(trabajo_id), usuario=usuario or ""
        )
    except ValueError:
        raise HTTPException(400, "ID de trabajo inválido.")
    except UpstreamError:
        logger.exception("Sunat status upstream failure")
        raise HTTPException(502, "No fue posible consultar el trabajo SUNAT.")


def sunat_reconcile(usuario: str) -> dict:
    """Reconcile every locally pending job with SUNAT (no new submissions)."""
    validator, store, _ruc, _hours = _sunat_pair()
    if validator is None or store is None:
        raise HTTPException(400, "Validación SUNAT no configurada.")
    try:
        return reconcile_pending_sunat_jobs(
            validator, store, usuario=usuario or ""
        )
    except UpstreamError:
        logger.exception("Sunat reconcile upstream failure")
        raise HTTPException(502, "No fue posible reconciliar los lotes SUNAT.")


def sunat_worker_pair() -> tuple | None:
    """Adapters and settings for the background reconciliation worker."""
    validator, store, _ruc, _hours = _sunat_pair()
    if validator is None or store is None:
        return None
    from syner_check import config as cfg

    try:
        settings = cfg.get_sunat_validator_config()
    except Exception:
        return None
    return validator, store, settings


def sunat_single(
    tipo_value: str, number: str, doc_date_iso: str, importe: object, usuario: str
) -> dict:
    """Manual single-doc revalidation (forces a fresh SUNAT query)."""
    validator, store, ruc, _hours = _sunat_pair()
    if validator is None or store is None or not ruc:
        raise HTTPException(400, "Validación SUNAT no configurada.")
    try:
        tipo = TipoDocumento.parse(tipo_value)
    except InvalidDocumentTypeError:
        raise HTTPException(400, "Tipo inválido")
    try:
        return sunat_revalidate(
            validator,
            store,
            tipo=tipo.value,
            number=(number or "").strip(),
            date_iso=(doc_date_iso or "").strip(),
            importe=importe,
            usuario=usuario or "",
            ruc=ruc,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc) if str(exc) else "Solicitud inválida.")
    except UpstreamError:
        logger.exception("Sunat revalidate upstream failure")
        raise HTTPException(502, "No fue posible validar en SUNAT.")


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
