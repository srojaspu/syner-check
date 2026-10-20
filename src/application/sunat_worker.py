"""Server-side safety net for SUNAT batch jobs.

The validator keeps working after the browser stops polling. This loop is the
piece that closes the loop: it reconciles every locally pending job and writes
the terminal result, so the next page load sees the truth instead of a stale
``PENDIENTE`` row.

It lives in the application layer because it only orchestrates a use case
through an injected ``tick`` callable; adapters and the event loop wiring stay
in ``app``.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

logger = logging.getLogger("syner_check.sunat_worker")


async def run_sunat_reconcile_worker(
    tick: Callable[[], Awaitable[dict]],
    *,
    interval_seconds: int,
    stop: asyncio.Event,
) -> None:
    """Run ``tick`` immediately and then every ``interval_seconds``.

    A failed round is logged and retried on the next interval: SUNAT/DB
    outages must not kill the worker. Cancellation is propagated so shutdown
    can stop it deterministically.
    """
    interval = max(2, int(interval_seconds))
    logger.info("SUNAT reconcile worker started interval=%ss", interval)
    while not stop.is_set():
        try:
            summary = await tick()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - one bad round must not stop the loop
            logger.exception("SUNAT reconcile round failed")
        else:
            data = summary if isinstance(summary, dict) else {}
            if data.get("reconciliados") or data.get("errores"):
                logger.info(
                    "SUNAT reconcile jobs=%s reconciled=%s pending=%s errors=%s",
                    data.get("jobs", 0),
                    data.get("reconciliados", 0),
                    data.get("pendientes", 0),
                    data.get("errores", 0),
                )
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue
    logger.info("SUNAT reconcile worker stopped")
