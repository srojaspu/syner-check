"""Bounded, thread-safe pool for pyodbc connections.

Each logical database (server/database/user/read-only flag) gets its own
small pool. Connections are handed to one caller at a time (pyodbc
connections are not thread-safe), rolled back before reuse, and discarded on
any error or after ``_IDLE_SECONDS`` so the server can reclaim them.

Why: every request used to open/close a TLS+login session. Under a handful of
concurrent users that dominates latency. The pool keeps a few warm
connections instead.
"""

from __future__ import annotations

import logging
import threading
import time
from contextlib import contextmanager
from typing import Any, Callable, Iterator

from .db_client import connect

logger = logging.getLogger("syner_check.db_pool")

_IDLE_SECONDS = 300.0
_MAX_IDLE = 4


def _close(connection: Any) -> None:
    try:
        connection.close()
    except Exception:  # noqa: BLE001 - closing must never mask the real error
        logger.debug("Ignoring error while closing a pooled connection")


class _Pool:
    def __init__(
        self,
        factory: Callable[[], Any],
        *,
        max_idle: int = _MAX_IDLE,
        idle_seconds: float = _IDLE_SECONDS,
    ) -> None:
        self._factory = factory
        self._max_idle = max_idle
        self._idle_seconds = idle_seconds
        self._free: list[tuple[Any, float]] = []
        self._lock = threading.Lock()

    def checkout(self) -> Any:
        stale: list[Any] = []
        fresh = None
        now = time.monotonic()
        with self._lock:
            while self._free:
                connection, released_at = self._free.pop()
                expired = (now - released_at) > self._idle_seconds
                if not expired and not getattr(connection, "closed", False):
                    fresh = connection
                    break
                stale.append(connection)
        for connection in stale:
            _close(connection)
        return fresh if fresh is not None else self._factory()

    def checkin(self, connection: Any) -> None:
        with self._lock:
            if len(self._free) < self._max_idle:
                self._free.append((connection, time.monotonic()))
                return
        _close(connection)

    def discard(self, connection: Any) -> None:
        _close(connection)

    def close_all(self) -> None:
        with self._lock:
            free, self._free = self._free, []
        for connection, _released_at in free:
            _close(connection)


_pools: dict[tuple, _Pool] = {}
_registry_lock = threading.Lock()


def _pool_key(db_config: dict[str, Any]) -> tuple:
    """Identity of a logical connection. Never includes the password."""
    return (
        db_config.get("driver"),
        db_config.get("server"),
        db_config.get("port"),
        db_config.get("instance"),
        db_config.get("database"),
        db_config.get("uid"),
        bool(db_config.get("trusted")),
        bool(db_config.get("application_intent_read_only", True)),
    )


def _pool_for(db_config: dict[str, Any], password: str) -> _Pool:
    key = _pool_key(db_config)
    with _registry_lock:
        pool = _pools.get(key)
        if pool is None:
            pool = _Pool(lambda: connect(db_config, password))
            _pools[key] = pool
        return pool


@contextmanager
def pooled_connection(
    db_config: dict[str, Any], password: str
) -> Iterator[Any]:
    """Check out a connection and return it (or discard it) safely."""
    pool = _pool_for(db_config, password)
    connection = pool.checkout()
    try:
        yield connection
    except BaseException:
        pool.discard(connection)
        raise
    else:
        try:
            # Ends any implicit transaction before the connection is reused.
            connection.rollback()
        except Exception:  # noqa: BLE001 - dead connection: replace it
            pool.discard(connection)
        else:
            pool.checkin(connection)


def close_all() -> None:
    """Close every idle connection (used by tests and graceful shutdown)."""
    with _registry_lock:
        pools = list(_pools.values())
        _pools.clear()
    for pool in pools:
        pool.close_all()
