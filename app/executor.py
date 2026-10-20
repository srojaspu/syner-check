"""Bounded thread pool for blocking DB/GraphQL work.

``asyncio.to_thread`` uses the loop's default executor, shared with any other
library that offloads work. A dedicated, bounded pool gives predictable
backpressure: at most ``WEB_THREAD_POOL_SIZE`` requests hit SQL Server /
GraphQL at once; the rest wait in the event loop.

Context variables are copied into the worker so logs keep the request id.
"""

from __future__ import annotations

import asyncio
import contextvars
import functools
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, TypeVar

T = TypeVar("T")


def _pool_size() -> int:
    raw = (os.getenv("WEB_THREAD_POOL_SIZE", "") or "").strip()
    try:
        size = int(raw) if raw else 8
    except ValueError:
        size = 8
    return max(2, min(32, size))


_executor = ThreadPoolExecutor(
    max_workers=_pool_size(), thread_name_prefix="syner-web"
)


async def run_blocking(func: Callable[..., T], /, *args: Any, **kwargs: Any) -> T:
    """Run ``func`` in the shared pool, preserving the logging context."""
    loop = asyncio.get_running_loop()
    context = contextvars.copy_context()
    call = functools.partial(func, *args, **kwargs)
    return await loop.run_in_executor(_executor, context.run, call)


def shutdown_executor() -> None:
    """Stop accepting work and drop queued tasks (graceful shutdown)."""
    _executor.shutdown(wait=False, cancel_futures=True)
