"""Interface wiring. Translates domain outcomes to HTTP semantics."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import date
from typing import Any, Sequence

from fastapi import HTTPException

from src.application import (
    SUNAT_SCOPE_NO_ACEPTADOS,
    get_detail,
    reconcile_pending_sunat_jobs,
    search_by_number,
    send_movsynerpos,
    submit_sunat_batch,
    summarize,
    sunat_job_status,
    sunat_revalidate,
)
from src.application.intelisis_ufe import (
    RangoInvalidoError,
    detalle_ufe,
    listar_ufe,
    validar_ufe,
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
    MovSynerPosWriterAdapter,
    SqlReaderAdapter,
    SunatCacheStoreAdapter,
    SunatValidatorAdapter,
)
from src.infrastructure.intelisis_ufe import IntelisisUfeReaderAdapter

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


def _intelisis_ufe_reader():
    """Intelisis UFE adapter when configured, else None (degraded)."""
    from app import intelisis_db

    try:
        if intelisis_db.intelisis_enabled():
            return IntelisisUfeReaderAdapter()
    except Exception:
        logger.warning("Intelisis UFE check failed; continuing degraded")
    return None


def _sunat_pair() -> tuple:
    """(validator, store, ruc) or (None, None, '')."""
    from app import sunat_db as app_sunat
    from syner_check import config as cfg

    try:
        if not app_sunat.sunat_available():
            return None, None, ""
        validator = cfg.get_sunat_validator_config()
        return (
            SunatValidatorAdapter(),
            SunatCacheStoreAdapter(),
            validator["ruc"],
        )
    except Exception:
        logger.warning("Sunat check failed; continuing without cache")
        return None, None, ""


def summary(
    start_iso: str, end_iso: str, tipo_values: Sequence[str], max_range_days: int
) -> dict:
    try:
        _sunat_validator, sunat_store, sunat_ruc = _sunat_pair()
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
        _sunat_validator, sunat_store, sunat_ruc = _sunat_pair()
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


def sunat_submit(
    documentos: list[dict],
    usuario: str,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
    alcance: str = SUNAT_SCOPE_NO_ACEPTADOS,
) -> dict:
    """Explicit SUNAT batch validation (quota-spending, user-triggered)."""
    validator, store, ruc = _sunat_pair()
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
            alcance=alcance,
            batch_max=int(
                cfg.get_sunat_validator_config().get("batch_size", 50)
            ),
            on_progress=on_progress,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc) if str(exc) else "Solicitud inválida.")
    except UpstreamError:
        logger.exception("Sunat submit upstream failure")
        raise HTTPException(502, "No fue posible registrar el lote SUNAT.")


def sunat_status(trabajo_id: int, usuario: str) -> dict:
    try:
        validator, store, _ruc = _sunat_pair()
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
    validator, store, _ruc = _sunat_pair()
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
    validator, store, _ruc = _sunat_pair()
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
    validator, store, ruc = _sunat_pair()
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


def intelisis_ufe_list(
    start_iso: str,
    end_iso: str,
    *,
    resultado: str = "",
    estados: Sequence[str] = (),
    incidencia: str = "",
    tipo: str = "",
    sucursal: int | None = None,
    q: str = "",
) -> dict:
    """Comprobantes del universo UFE con su estado de generacion y SUNAT."""
    reader = _intelisis_ufe_reader()
    if reader is None:
        # Degradado: la pantalla avisa y no rompe (mismo criterio que
        # intelisis_enabled=false en el resumen).
        return {
            "desde": start_iso,
            "hasta": end_iso,
            "intelisis_enabled": False,
            "bitacora_desde": "",
            "kpis": {
                "total": 0,
                "conformes": 0,
                "con_incidencia": 0,
                "sin_traza": 0,
                "en_espera": 0,
                "no_aplica": 0,
                "sin_cobertura_sunat": 0,
                "por_generador": [],
                "por_incidencia": [],
                "por_sucursal": [],
            },
            "filtrados": 0,
            "rows": [],
        }
    _validator, sunat_store, sunat_ruc = _sunat_pair()
    try:
        return listar_ufe(
            reader,
            start_iso=start_iso,
            end_iso=end_iso,
            sunat_store=sunat_store,
            sunat_ruc=sunat_ruc,
            resultado=resultado,
            estados=estados,
            incidencia=incidencia,
            tipo=tipo,
            sucursal=sucursal,
            q=q,
        )
    except RangoInvalidoError as exc:
        raise HTTPException(400, str(exc) or "Periodo invalido.")
    except UpstreamError:
        logger.exception("Intelisis UFE read failure")
        raise HTTPException(
            502, "No fue posible consultar los comprobantes de Intelisis."
        )


def intelisis_ufe_detail(id_venta: int) -> dict:
    """Trazabilidad de un comprobante UFE (venta, intentos, SUNAT)."""
    reader = _intelisis_ufe_reader()
    if reader is None:
        raise HTTPException(503, "Intelisis no disponible.")
    _validator, sunat_store, sunat_ruc = _sunat_pair()
    try:
        return detalle_ufe(
            reader,
            id_venta=int(id_venta),
            sunat_store=sunat_store,
            sunat_ruc=sunat_ruc,
        )
    except NotFoundError:
        raise HTTPException(404, "Comprobante no encontrado.")
    except UpstreamError:
        logger.exception("Intelisis UFE detail failure")
        raise HTTPException(
            502, "No fue posible consultar la trazabilidad del comprobante."
        )


def intelisis_ufe_validate(id_venta: int, usuario: str) -> dict:
    """Consulta individual en SUNAT (no escribe en Intelisis)."""
    reader = _intelisis_ufe_reader()
    if reader is None:
        raise HTTPException(503, "Intelisis no disponible.")
    validator, store, ruc = _sunat_pair()
    if validator is None or store is None or not ruc:
        raise HTTPException(400, "Validación SUNAT no configurada.")
    try:
        return validar_ufe(
            reader,
            validator,
            store,
            id_venta=int(id_venta),
            sunat_ruc=ruc,
            usuario=usuario or "",
        )
    except NotFoundError:
        raise HTTPException(404, "Comprobante no encontrado.")
    except ValueError as exc:
        raise HTTPException(400, str(exc) or "Solicitud inválida.")
    except UpstreamError:
        logger.exception("Intelisis UFE validation failure")
        raise HTTPException(502, "No fue posible validar en SUNAT.")


def movsynerpos_send(
    documentos: list[dict],
    reparar: bool,
    actor: str,
    correlation_id: str = "",
) -> dict:
    """Blocking manual resend to dbo.MovSynerPos (real production write)."""
    from syner_check import config as cfg

    if not cfg.movsynerpos_enabled():
        raise HTTPException(503, "El reenvío a SynerPOS está deshabilitado.")
    if not cfg.is_movsynerpos_configured():
        raise HTTPException(503, "Reenvío a SynerPOS no configurado.")

    try:
        return send_movsynerpos(
            GraphqlGatewayAdapter(),
            MovSynerPosWriterAdapter(),
            documentos=documentos,
            reparar=bool(reparar),
            actor=actor or "",
            correlation_id=correlation_id or "",
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc) if str(exc) else "Solicitud inválida.")
    except UpstreamError:
        logger.exception("MovSynerPos upstream failure")
        raise HTTPException(502, "No fue posible reenviar los documentos.")
    except HTTPException:
        raise
    except Exception:
        logger.exception("MovSynerPos unexpected failure")
        raise HTTPException(500, "No se pudo reenviar a SynerPOS.")
