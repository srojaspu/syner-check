"""Casos de uso del monitoreo de terminales POS.

Modelo «snapshot por ventana»: una sola consulta a SynerCOM por ventana, y
todos los filtros, la paginación y los agregados se resuelven en memoria sobre
ese snapshot. Cambiar de filtro o de página no consume el endpoint.

Sin I/O propio: depende de ``PosLogSource`` y de ``TTLCache``, ambos
inyectados, así que se prueba con fakes.
"""

from __future__ import annotations

import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Iterable, Sequence

from src.application.ports import PosLogSource
from src.application.pos_logs_cache import TTLCache
from src.domain.errors import InvalidPosFilterError, NotFoundError
from src.domain.pos_logs import (
    LIMA_TZ,
    MAX_INSTANCE_CHARS,
    MAX_KEY_CHARS,
    EventLevel,
    PosLogEvent,
    TimeWindow,
    bucket_floor,
    bucket_granularity,
    parse_level,
    safe_text,
)

CACHE_TTL_SECONDS = 60
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
MAX_TEXT_FILTER = 64

_LEVEL_RANK = {
    EventLevel.UNKNOWN: 0,
    EventLevel.INFO: 1,
    EventLevel.WARN: 2,
    EventLevel.ERROR: 3,
}


@dataclass(frozen=True, slots=True)
class PosKpis:
    ultimo_evento: datetime | None


@dataclass(frozen=True, slots=True)
class SeriesBucket:
    bucket: datetime
    info: int
    warn: int
    error: int
    unknown: int


@dataclass(frozen=True, slots=True)
class KeySummary:
    clave: str
    nivel: EventLevel
    conteo: int
    ultima: datetime


@dataclass(frozen=True, slots=True)
class EventPage:
    items: tuple[PosLogEvent, ...]
    total: int
    page: int
    limit: int

    @property
    def hay_mas(self) -> bool:
        return self.page * self.limit < self.total


@dataclass(frozen=True, slots=True)
class PosSnapshot:
    window: TimeWindow
    events: tuple[PosLogEvent, ...]
    kpis: PosKpis
    series: tuple[SeriesBucket, ...]
    claves: tuple[KeySummary, ...]
    versiones: tuple[tuple[str, int], ...]
    generado_en: datetime
    fetch_ms: int


@dataclass(frozen=True, slots=True)
class PosAnalysis:
    snapshot: PosSnapshot
    page: EventPage
    cache_hit: bool


# --- validación de filtros ------------------------------------------------
def parse_niveles(raw: str | None) -> frozenset[EventLevel] | None:
    """``"ERROR,WARN"`` → conjunto de niveles; vacío/None → sin filtro."""
    if not raw:
        return None
    levels: set[EventLevel] = set()
    for part in str(raw).split(","):
        text = part.strip()
        if not text:
            continue
        level = parse_level(text)
        if level is EventLevel.UNKNOWN:
            raise InvalidPosFilterError(f"Nivel inválido: {text}.")
        levels.add(level)
    return frozenset(levels) or None


def _filter_text(raw: Any, limit: int, label: str) -> str | None:
    text = safe_text(raw, limit + 1)
    if not text:
        return None
    if len(text) > limit:
        raise InvalidPosFilterError(
            f"El filtro {label} no puede superar {limit} caracteres."
        )
    return text


def validate_clave(raw: Any) -> str | None:
    return _filter_text(raw, MAX_KEY_CHARS, "clave")


def validate_instancia(raw: Any) -> str | None:
    return _filter_text(raw, MAX_INSTANCE_CHARS, "instancia")


def validate_serial(raw: Any) -> str | None:
    return _filter_text(raw, 40, "serial")


def validate_q(raw: Any) -> str | None:
    return _filter_text(raw, MAX_TEXT_FILTER, "texto")


def validate_orden(raw: Any) -> str:
    text = str(raw or "reciente").strip().lower()
    if text not in ("reciente", "antiguo"):
        raise InvalidPosFilterError("El orden debe ser 'reciente' o 'antiguo'.")
    return text


def validate_page(raw: Any) -> int:
    try:
        page = int(raw)
    except (TypeError, ValueError) as exc:
        raise InvalidPosFilterError("La página debe ser un número entero.") from exc
    if page < 1:
        raise InvalidPosFilterError("La página debe ser mayor o igual a 1.")
    return page


def validate_limit(raw: Any) -> int:
    try:
        limit = int(raw)
    except (TypeError, ValueError) as exc:
        raise InvalidPosFilterError("El límite debe ser un número entero.") from exc
    if limit < 1 or limit > MAX_PAGE_SIZE:
        raise InvalidPosFilterError(
            f"El límite debe estar entre 1 y {MAX_PAGE_SIZE}."
        )
    return limit


# --- snapshot --------------------------------------------------------------
def snapshot_key(
    window: TimeWindow,
    *,
    clave: str | None = None,
    message: str | None = None,
) -> str:
    return (
        f"pos:{window.start.isoformat()}:{window.end.isoformat()}"
        f":{clave or ''}:{message or ''}"
    )


def _snapshot_size(snapshot: PosSnapshot) -> int:
    per_event = 2400 if snapshot.window.includes_value else 800
    return 400 + len(snapshot.events) * per_event


def _max_level(current: EventLevel, candidate: EventLevel) -> EventLevel:
    return candidate if _LEVEL_RANK[candidate] > _LEVEL_RANK[current] else current


def _series(
    events: Sequence[PosLogEvent], window: TimeWindow
) -> tuple[SeriesBucket, ...]:
    granularity = bucket_granularity(window)
    step = timedelta(hours=1) if granularity == "hour" else timedelta(days=1)
    cursor = bucket_floor(window.start, granularity)
    buckets: dict[datetime, list[int]] = {}
    while cursor < window.end:
        buckets[cursor] = [0, 0, 0, 0]
        cursor += step

    index = {
        EventLevel.INFO: 0,
        EventLevel.WARN: 1,
        EventLevel.ERROR: 2,
        EventLevel.UNKNOWN: 3,
    }
    for event in events:
        bucket = bucket_floor(event.at, granularity)
        counters = buckets.setdefault(bucket, [0, 0, 0, 0])
        counters[index[event.level]] += 1

    return tuple(
        SeriesBucket(
            bucket=bucket,
            info=counters[0],
            warn=counters[1],
            error=counters[2],
            unknown=counters[3],
        )
        for bucket, counters in sorted(buckets.items())
    )


def _assemble(
    window: TimeWindow,
    events: Sequence[PosLogEvent],
    *,
    fetch_ms: int,
    now: datetime | None = None,
) -> PosSnapshot:
    ordered = tuple(sorted(events, key=lambda event: (event.at, event.oid)))
    versions = Counter(
        event.value.version
        for event in ordered
        if event.value is not None and event.value.version
    )

    key_stats: dict[str, list[Any]] = {}
    for event in ordered:
        stat = key_stats.get(event.key)
        if stat is None:
            key_stats[event.key] = [1, event.level, event.at]
        else:
            stat[0] += 1
            stat[1] = _max_level(stat[1], event.level)
            stat[2] = max(stat[2], event.at)

    kpis = PosKpis(ultimo_evento=ordered[-1].at if ordered else None)

    claves = tuple(
        KeySummary(
            clave=key,
            nivel=stat[1],
            conteo=stat[0],
            ultima=stat[2],
        )
        for key, stat in sorted(
            key_stats.items(), key=lambda item: (-item[1][0], item[0])
        )
    )

    return PosSnapshot(
        window=window,
        events=ordered,
        kpis=kpis,
        series=_series(ordered, window),
        claves=claves,
        versiones=tuple(versions.most_common()),
        generado_en=(now or datetime.now(LIMA_TZ)).astimezone(LIMA_TZ),
        fetch_ms=fetch_ms,
    )


def build_snapshot(
    source: PosLogSource,
    cache: TTLCache,
    window: TimeWindow,
    *,
    clave: str | None = None,
    message: str | None = None,
    ttl: float = CACHE_TTL_SECONDS,
    now: datetime | None = None,
) -> tuple[PosSnapshot, bool]:
    """Devuelve ``(snapshot, cache_hit)``. La clave del caché es la ventana."""
    key = snapshot_key(window, clave=clave, message=message)
    cache_hit = cache.get(key) is not None

    def load() -> PosSnapshot:
        started = time.perf_counter()
        events = source.fetch(window, key=clave, message=message)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return _assemble(window, events, fetch_ms=elapsed_ms, now=now)

    snapshot = cache.get_or_load(
        key,
        load,
        ttl,
        sizer=_snapshot_size,
    )
    return snapshot, cache_hit


# --- consultas -------------------------------------------------------------
def filter_events(
    snapshot: PosSnapshot,
    *,
    niveles: frozenset[EventLevel] | None = None,
    clave: str | None = None,
    instancia: str | None = None,
    serial: str | None = None,
    q: str | None = None,
    orden: str = "reciente",
    page: int = 1,
    limit: int = DEFAULT_PAGE_SIZE,
) -> EventPage:
    page = validate_page(page)
    limit = validate_limit(limit)
    orden = validate_orden(orden)

    items: Iterable[PosLogEvent] = snapshot.events
    if niveles:
        items = (event for event in items if event.level in niveles)
    if clave:
        items = (event for event in items if event.key == clave)
    if instancia:
        items = (event for event in items if event.instance == instancia)
    if serial:
        items = (event for event in items if event.terminal.serial == serial)
    if q:
        needle = q.casefold()
        items = (
            event
            for event in items
            if needle in event.message.casefold() or needle in event.key.casefold()
        )

    selected = list(items)
    if orden == "reciente":
        selected.reverse()
    total = len(selected)
    start = (page - 1) * limit
    return EventPage(
        items=tuple(selected[start : start + limit]),
        total=total,
        page=page,
        limit=limit,
    )


def analizar(
    source: PosLogSource,
    cache: TTLCache,
    window: TimeWindow,
    *,
    niveles: frozenset[EventLevel] | None = None,
    clave: str | None = None,
    instancia: str | None = None,
    serial: str | None = None,
    q: str | None = None,
    orden: str = "reciente",
    page: int = 1,
    limit: int = DEFAULT_PAGE_SIZE,
    ttl: float = CACHE_TTL_SECONDS,
    now: datetime | None = None,
) -> PosAnalysis:
    snapshot, cache_hit = build_snapshot(source, cache, window, ttl=ttl, now=now)
    return PosAnalysis(
        snapshot=snapshot,
        page=filter_events(
            snapshot,
            niveles=niveles,
            clave=clave,
            instancia=instancia,
            serial=serial,
            q=q,
            orden=orden,
            page=page,
            limit=limit,
        ),
        cache_hit=cache_hit,
    )


def obtener_evento(
    source: PosLogSource,
    cache: TTLCache,
    window: TimeWindow,
    oid: str,
    at: datetime,
    *,
    ttl: float = CACHE_TTL_SECONDS,
    now: datetime | None = None,
) -> tuple[PosLogEvent, bool]:
    """Detalle de un evento, con ``value`` si está disponible.

    1. Si el snapshot de la ventana está en caché y trae ``value``, se usa.
    2. Si no, se consulta una ventana estrecha (±2 h) alrededor del evento.

    Devuelve ``(evento, cache_hit)``.
    """
    oid = safe_text(oid, 40)
    if not oid:
        raise InvalidPosFilterError("El evento requiere un oid.")
    if at.tzinfo is None:
        raise InvalidPosFilterError("La fecha del evento requiere zona horaria.")

    cached = cache.get(snapshot_key(window))
    if isinstance(cached, PosSnapshot) and cached.window.includes_value:
        found = next((event for event in cached.events if event.oid == oid), None)
        if found is not None:
            return found, True

    narrow = TimeWindow(
        start=at - timedelta(hours=2),
        end=at + timedelta(hours=2),
    )
    snapshot, _ = build_snapshot(source, cache, narrow, ttl=ttl, now=now)
    found = next((event for event in snapshot.events if event.oid == oid), None)
    if found is None:
        raise NotFoundError(
            "El evento no aparece en la ventana indicada; acota el rango."
        )
    return found, False

