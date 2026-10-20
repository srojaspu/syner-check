"""HTTP hardening for the FastAPI app.

Three small, dependency-free layers:

* ``RateLimitMiddleware`` — per-identity sliding window for ``/api/*``.
  SUNAT *writes* (which spend quota) get their own, tighter bucket.
* ``OriginCheckMiddleware`` — rejects cross-site browser writes (CSRF
  defense in depth; complements ``SameSite=Lax`` session cookies).
* ``BodySizeLimitMiddleware`` + ``read_json_limited`` — caps request bodies
  before parsing, so a huge JSON payload cannot exhaust worker memory.

The limiter is in-process (one uvicorn worker, as deployed). If the app is
ever scaled to multiple workers/instances, move the counters to Redis.
"""

from __future__ import annotations

import json
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


@dataclass
class SlidingWindowLimiter:
    """Fixed-window buckets keyed by an opaque identity string."""

    limit: int
    window: float
    _hits: dict[str, deque[float]] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def allow(self, key: str, now: float | None = None) -> tuple[bool, int]:
        """Return ``(allowed, retry_after_seconds)`` and record the hit."""
        current = time.monotonic() if now is None else now
        cutoff = current - self.window
        with self._lock:
            bucket = self._hits.get(key)
            if bucket is None:
                bucket = deque()
                self._hits[key] = bucket
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self.limit:
                retry = max(1, int(self.window - (current - bucket[0])) + 1)
                return False, retry
            bucket.append(current)
            if len(self._hits) > 5_000:
                # Drop identities with no live hits so the dict is bounded.
                for stale in [
                    k for k, v in self._hits.items() if not v or v[-1] <= cutoff
                ]:
                    self._hits.pop(stale, None)
            return True, 0


class RateLimitMiddleware:
    """Per-user (or per-IP) limit for API calls."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        limit: int,
        sunat_write_limit: int,
        window_seconds: int,
    ) -> None:
        self.app = app
        self._general = SlidingWindowLimiter(limit, window_seconds)
        self._sunat_write = SlidingWindowLimiter(sunat_write_limit, window_seconds)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        if not path.startswith("/api/"):
            return await self.app(scope, receive, send)

        limiter = self._general
        if path.startswith("/api/sunat/") and scope.get("method") == "POST":
            limiter = self._sunat_write

        allowed, retry_after = limiter.allow(_identity(scope))
        if not allowed:
            response = JSONResponse(
                {
                    "detail": (
                        "Demasiadas solicitudes. Espera unos segundos e "
                        "intenta de nuevo."
                    )
                },
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


def _identity(scope: Scope) -> str:
    """Prefer the authenticated email; fall back to the client IP."""
    session = scope.get("session") or {}
    user = session.get("user") if isinstance(session, dict) else None
    if isinstance(user, dict) and user.get("email"):
        return "u:" + str(user["email"]).strip().lower()
    client = scope.get("client")
    host = client[0] if client else "unknown"
    return "ip:" + str(host)


class OriginCheckMiddleware:
    """Block cross-site writes when the browser sends an ``Origin`` header.

    Same-origin requests send ``Origin`` too, so the comparison is against
    ``Host``. Requests without ``Origin`` (curl, server-to-server) are left
    alone: they are not CSRF vectors.
    """

    def __init__(self, app: ASGIApp, allowed_origins: tuple[str, ...] = ()) -> None:
        self.app = app
        self.allowed_origins = tuple(
            origin.rstrip("/").lower() for origin in allowed_origins
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope.get("method") not in _SAFE_METHODS
            and not self._origin_ok(scope)
        ):
            response = JSONResponse(
                {"detail": "Origen no permitido."}, status_code=403
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)

    def _origin_ok(self, scope: Scope) -> bool:
        headers = Headers(scope=scope)
        origin = headers.get("origin")
        if not origin:
            return True
        normalized = origin.rstrip("/").lower()
        if self.allowed_origins:
            return normalized in self.allowed_origins
        host = (headers.get("host") or "").strip().lower()
        if not host:
            return False
        parts = urlsplit(normalized)
        return _drop_default_port(parts.netloc, parts.scheme) == _drop_default_port(
            host, parts.scheme
        )


def _drop_default_port(netloc: str, scheme: str) -> str:
    """``app.example:443`` (https) / ``:80`` (http) are the same host."""
    if scheme == "https" and netloc.endswith(":443"):
        return netloc[:-4]
    if scheme == "http" and netloc.endswith(":80"):
        return netloc[:-3]
    return netloc


class BodySizeLimitMiddleware:
    """Reject oversized requests early using ``Content-Length``.

    Chunked bodies have no such header; ``read_json_limited`` enforces the
    real cap for the two JSON endpoints.
    """

    def __init__(self, app: ASGIApp, *, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            raw = Headers(scope=scope).get("content-length")
            if raw and raw.isdigit() and int(raw) > self.max_bytes:
                response = JSONResponse(
                    {"detail": "Cuerpo de la solicitud demasiado grande."},
                    status_code=413,
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


async def read_json_limited(request: Request, max_bytes: int) -> object:
    """Parse a JSON body while enforcing ``max_bytes`` (chunked included)."""
    raw_length = request.headers.get("content-length")
    if raw_length and raw_length.isdigit() and int(raw_length) > max_bytes:
        raise HTTPException(413, "Cuerpo de la solicitud demasiado grande.")

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > max_bytes:
            raise HTTPException(413, "Cuerpo de la solicitud demasiado grande.")
    if not body:
        raise HTTPException(400, "Cuerpo JSON inválido.")
    try:
        return json.loads(body)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(400, "Cuerpo JSON inválido.") from exc
