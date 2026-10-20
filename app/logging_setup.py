"""Structured logging with a per-request correlation id.

The request id lives in a ``ContextVar`` set by the HTTP middleware, so any
log emitted while handling a request (including inside worker threads, which
receive a copy of the context) carries the same id without threading it
through every function signature.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from contextvars import ContextVar
from datetime import datetime, timezone

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = request_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(
                record.created, tz=timezone.utc
            ).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def _log_format() -> str:
    configured = (os.getenv("LOG_FORMAT", "") or "").strip().lower()
    if configured in ("json", "text"):
        return configured
    # Default: human-readable locally, structured in production.
    return "json" if os.getenv("APP_ENV", "production").lower() == "production" else "text"


def configure_logging() -> None:
    """Install a single stdout handler with the chosen format."""
    level = (os.getenv("LOG_LEVEL", "INFO") or "INFO").upper()
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(RequestIdFilter())
    if _log_format() == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s"
            )
        )
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)
    # Every request is already logged with a request_id; uvicorn's access log
    # would duplicate it in a different (non-JSON) format.
    logging.getLogger("uvicorn.access").disabled = True
