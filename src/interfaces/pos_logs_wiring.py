"""Wiring HTTP del módulo de terminales POS.

Traduce los casos de uso a JSON y los errores de dominio/infraestructura a
HTTP. Mantiene los singletons (caché y adaptador) fuera del router para que
``app/routers/pos_logs.py`` quede delgado.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

from fastapi import HTTPException

from src.application.pos_logs import (
    analizar,
    obtener_evento,
    parse_niveles,
    validate_clave,
    validate_instancia,
    validate_q,
    validate_serial,
)
from src.application.pos_logs_cache import TTLCache
from src.domain.errors import (
    InvalidPosFilterError,
    InvalidRangeError,
    NotFoundError,
    UpstreamError,
)
from src.domain.pos_logs import PosLogEvent, TimeWindow, parse_datetime
from src.infrastructure import PosLogSourceAdapter

logger = logging.getLogger("syner_check.pos_logs.api")

AVISO = (
    "La ausencia de un evento no prueba que la operación no ocurrió: el POS "
    "descarta registros si no logra enviarlos en unos 2 minutos."
)

_DOC_TYPE_LABELS = {
    "RECEIPT": "Boleta",
    "INVOICE": "Factura",
    "TICKET": "Ticket",
    "CREDITNOTE": "Nota de crédito",
}

_lock = threading.Lock()
_cache: TTLCache | None = None
_source: PosLogSourceAdapter | None = None


def _env_int(name: str, default: int) -> int:
    raw = (os.getenv(name, "") or "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = (os.getenv(name, "") or "").strip()
    try:
        return float(raw) if raw else default
    except ValueError:
        return default


def _ttl() -> float:
    return max(1.0, _env_float("POS_CACHE_TTL_SECONDS", 60.0))


def precalentar() -> None:
    """Warm-up de arranque: token/TLS, sin consultar logs ni bloquear."""
    try:
        source, _ = _deps()
        source.warm_up()
    except Exception:  # noqa: BLE001 - nunca debe romper el arranque
        logger.debug("pos_logs warm-up unavailable", exc_info=True)


def _deps() -> tuple[PosLogSourceAdapter, TTLCache]:
    """Singletons perezosos: una caché y un adaptador por proceso."""
    global _cache, _source
    with _lock:
        if _cache is None:
            _cache = TTLCache(
                max_entries=max(1, _env_int("POS_CACHE_MAX_ENTRIES", 8)),
                max_bytes=max(
                    1024 * 1024, _env_int("POS_CACHE_MAX_BYTES", 50 * 1024 * 1024)
                ),
            )
        if _source is None:
            _source = PosLogSourceAdapter(
                timeout=_env_float("POS_UPSTREAM_TIMEOUT", 30.0),
                max_concurrency=max(1, _env_int("POS_UPSTREAM_CONCURRENCY", 2)),
            )
    return _source, _cache


def _raise_upstream(exc: UpstreamError) -> None:
    logger.warning("pos_logs upstream failure code=%s: %s", exc.code, exc)
    message = exc.public_message or "No se pudo consultar el servicio de logs."
    if exc.code == "busy":
        raise HTTPException(503, message, headers={"Retry-After": "5"}) from exc
    if exc.code == "too_many":
        raise HTTPException(400, message) from exc
    raise HTTPException(502, message) from exc


def _ventana(window: TimeWindow) -> dict[str, Any]:
    return {
        "desde": window.start.isoformat(),
        "hasta": window.end.isoformat(),
        "tz": "America/Lima",
        "dias": round(window.days, 2),
    }


def _value_dict(value) -> dict[str, Any] | None:
    if value is None:
        return None
    extra = value.safe_extra_fields()
    return {
        "version": value.version,
        "serial": value.serial,
        "pedido": value.order_number,
        "importe": (
            format(value.amount, "f") if value.amount is not None else None
        ),
        "importeCobrado": extra.get("chargedAmount"),
        "moneda": value.currency,
        "elapsedMs": value.elapsed_ms,
        "tipoDocumento": (
            _DOC_TYPE_LABELS.get(value.doc_type, value.doc_type)
            if value.doc_type
            else None
        ),
        "documento": value.document_number,
        "pasarela": value.gateway,
        "marca": extra.get("brand"),
        "panEnmascarado": value.masked_pan,
        "balanceId": extra.get("balanceId"),
        "balanceNumber": extra.get("balanceNumber"),
        "previousState": extra.get("previousState"),
        "failedEndpoint": extra.get("failedEndpoint"),
        "excepcion": extra.get("exception"),
        "excepcionMensaje": extra.get("exceptionMessage"),
    }


def _client_log(event: PosLogEvent) -> dict[str, Any]:
    """Registro liviano con `value` JSON sanitizado para clasificación en el cliente."""
    return {
        "oid": event.oid,
        "fecha": event.at.isoformat(),
        "nivel": event.level.value,
        "clave": event.key,
        "instancia": event.instance,
        "mensaje": event.message,
        "value": (
            event.value.sanitized_raw_json() if event.value is not None else None
        ),
    }


def _event_summary(event: PosLogEvent) -> dict[str, Any]:
    value = event.value
    return {
        "oid": event.oid,
        "fecha": event.at.isoformat(),
        "nivel": event.level.value,
        "clave": event.key,
        "instancia": event.instance,
        "mensaje": event.message,
        "pedido": value.order_number if value is not None else None,
        "importe": (
            format(value.amount, "f")
            if value is not None and value.amount is not None
            else None
        ),
        "moneda": value.currency if value is not None else None,
        "serial": value.serial if value is not None else None,
        "version": value.version if value is not None else None,
    }


def _event_detail(event: PosLogEvent) -> dict[str, Any]:
    data = _event_summary(event)
    data["valor"] = _value_dict(event.value)
    return data


def _analysis_dict(result, latencia_ms: int) -> dict[str, Any]:
    snapshot = result.snapshot
    kpis = snapshot.kpis
    return {
        "ventana": _ventana(snapshot.window),
        "generadoEn": snapshot.generado_en.isoformat(),
        "fuente": {
            "cache": "hit" if result.cache_hit else "miss",
            "latenciaMs": latencia_ms,
            "upstreamMs": snapshot.fetch_ms,
            "parcial": not snapshot.window.includes_value,
        },
        "kpis": {
            "ultimoEvento": (
                kpis.ultimo_evento.isoformat() if kpis.ultimo_evento else None
            ),
        },
        "series": [
            {
                "bucket": item.bucket.isoformat(),
                "info": item.info,
                "warn": item.warn,
                "error": item.error,
                "unknown": item.unknown,
            }
            for item in snapshot.series
        ],
        "claves": [
            {
                "clave": item.clave,
                "nivel": item.nivel.value,
                "conteo": item.conteo,
                "ultima": item.ultima.isoformat(),
            }
            for item in snapshot.claves
        ],
        "versiones": [
            {"version": version, "conteo": count}
            for version, count in snapshot.versiones
        ],
        "eventos": {
            "items": [_event_summary(event) for event in result.page.items],
            "total": result.page.total,
            "page": result.page.page,
            "limit": result.page.limit,
            "hayMas": result.page.hay_mas,
        },
        "logs": [_client_log(event) for event in reversed(snapshot.events)],
        "aviso": AVISO,
    }


def analisis_pos(
    *,
    desde: str,
    hasta: str,
    nivel: str | None = None,
    clave: str | None = None,
    instancia: str | None = None,
    serial: str | None = None,
    q: str | None = None,
    orden: str = "reciente",
    page: int = 1,
    limit: int = 50,
) -> dict[str, Any]:
    source, cache = _deps()
    try:
        window = TimeWindow.parse(desde, hasta)
        started = time.perf_counter()
        result = analizar(
            source,
            cache,
            window,
            niveles=parse_niveles(nivel),
            clave=validate_clave(clave),
            instancia=validate_instancia(instancia),
            serial=validate_serial(serial),
            q=validate_q(q),
            orden=orden,
            page=page,
            limit=limit,
            ttl=_ttl(),
        )
        latencia_ms = int((time.perf_counter() - started) * 1000)
    except (InvalidRangeError, InvalidPosFilterError) as exc:
        raise HTTPException(400, str(exc)) from exc
    except UpstreamError as exc:
        _raise_upstream(exc)
    return _analysis_dict(result, latencia_ms)


def evento_pos(
    *,
    oid: str,
    at: str,
    desde: str,
    hasta: str,
) -> dict[str, Any]:
    source, cache = _deps()
    try:
        window = TimeWindow.parse(desde, hasta)
        moment = parse_datetime(at)
        if moment is None:
            raise InvalidPosFilterError(
                "La fecha del evento debe ser ISO 8601 con zona horaria."
            )
        started = time.perf_counter()
        event, hit = obtener_evento(
            source, cache, window, oid, moment, ttl=_ttl()
        )
        latencia_ms = int((time.perf_counter() - started) * 1000)
    except (InvalidRangeError, InvalidPosFilterError) as exc:
        raise HTTPException(400, str(exc)) from exc
    except NotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except UpstreamError as exc:
        _raise_upstream(exc)
    return {
        "evento": _event_detail(event),
        "fuente": {
            "cache": "hit" if hit else "miss",
            "latenciaMs": latencia_ms,
            "parcial": event.value is None,
        },
    }

