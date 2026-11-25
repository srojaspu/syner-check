"""Caché TTL en proceso para los snapshots de logs POS.

Diseñada para un endpoint limitado: una ventana se consulta una sola vez y se
reutiliza durante ``ttl`` segundos. Dos peticiones simultáneas de la misma
ventana comparten una única carga (single-flight por clave), y el número de
entradas y los bytes quedan acotados para que la caché no crezca sin control.

Sin I/O y sin dependencias externas: se puede probar con un reloj falso.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from src.application.key_lock import StripedLock

DEFAULT_MAX_ENTRIES = 8
DEFAULT_MAX_BYTES = 50 * 1024 * 1024


@dataclass(slots=True)
class _Entry:
    value: Any
    expires_at: float
    size: int


@dataclass(frozen=True, slots=True)
class CacheStats:
    """Foto de la caché para logs/métricas (nunca incluye valores)."""

    hits: int
    misses: int
    loads: int
    evictions: int
    entries: int
    bytes: int
    max_entries: int
    max_bytes: int


class TTLCache:
    """LRU + TTL + single-flight, acotada por entradas y bytes.

    ``get_or_load`` es la operación que usa el caso de uso: si la clave está
    vigente, devuelve el valor; si no, llama al ``loader`` una sola vez por
    clave, aunque varias peticiones lleguen a la vez.

    Un valor ``None`` no se cachea (se interpreta como "sin resultado"), para
    no confundir un fallo de carga con un acierto.
    """

    def __init__(
        self,
        *,
        max_entries: int = DEFAULT_MAX_ENTRIES,
        max_bytes: int = DEFAULT_MAX_BYTES,
        clock: Callable[[], float] = time.monotonic,
        stripes: int = 256,
    ) -> None:
        if max_entries < 0:
            raise ValueError("max_entries no puede ser negativo.")
        if max_bytes < 0:
            raise ValueError("max_bytes no puede ser negativo.")
        self._max_entries = max_entries
        self._max_bytes = max_bytes
        self._clock = clock
        self._data: OrderedDict[str, _Entry] = OrderedDict()
        self._lock = threading.Lock()
        self._locks = StripedLock(stripes)
        self._hits = 0
        self._misses = 0
        self._loads = 0
        self._evictions = 0
        self._bytes = 0

    # --- lectura / escritura -------------------------------------------
    def get(self, key: str) -> Any | None:
        now = self._clock()
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                return None
            if entry.expires_at <= now:
                self._drop_locked(key)
                return None
            self._data.move_to_end(key)
            self._hits += 1
            return entry.value

    def put(self, key: str, value: Any, ttl: float, *, size: int = 0) -> None:
        if value is None or ttl <= 0:
            return
        with self._lock:
            self._put_locked(key, value, ttl, max(0, size), self._clock())

    def get_or_load(
        self,
        key: str,
        loader: Callable[[], Any],
        ttl: float,
        *,
        size: int = 0,
        sizer: Callable[[Any], int] | None = None,
    ) -> Any:
        cached = self.get(key)
        if cached is not None:
            return cached

        with self._lock:
            self._misses += 1

        with self._locks.hold([key]):
            cached = self.get(key)
            if cached is not None:
                return cached
            value = loader()
            if value is None:
                return None
            entry_size = max(0, size)
            if sizer is not None:
                try:
                    entry_size = max(0, int(sizer(value)))
                except (TypeError, ValueError):
                    entry_size = max(0, size)
            with self._lock:
                self._loads += 1
                self._put_locked(key, value, ttl, entry_size, self._clock())
            return value

    def invalidate(self, key: str) -> None:
        with self._lock:
            self._drop_locked(key)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()
            self._bytes = 0

    def stats(self) -> CacheStats:
        with self._lock:
            return CacheStats(
                hits=self._hits,
                misses=self._misses,
                loads=self._loads,
                evictions=self._evictions,
                entries=len(self._data),
                bytes=self._bytes,
                max_entries=self._max_entries,
                max_bytes=self._max_bytes,
            )

    # --- internos -------------------------------------------------------
    def _drop_locked(self, key: str) -> None:
        entry = self._data.pop(key, None)
        if entry is not None:
            self._bytes -= entry.size

    def _put_locked(
        self,
        key: str,
        value: Any,
        ttl: float,
        size: int,
        now: float,
    ) -> None:
        # Una entrada más grande que el presupuesto no se guarda (rompería la
        # cota), pero el llamador igual recibe el valor.
        if size > self._max_bytes:
            return
        self._drop_locked(key)
        self._data[key] = _Entry(
            value=value,
            expires_at=now + ttl,
            size=size,
        )
        self._bytes += size
        self._evict_locked()

    def _evict_locked(self) -> None:
        while self._data and (
            len(self._data) > self._max_entries or self._bytes > self._max_bytes
        ):
            _, entry = self._data.popitem(last=False)
            self._bytes -= entry.size
            self._evictions += 1
