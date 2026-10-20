"""SUNAT Validator HTTP client (see docs/, v1.1.1).

Secrets policy: the API key travels only in the X-API-Key header and is
never logged, printed or returned. Errors only mention error CODES.
No blind resubmits: batch POST has no idempotency key server-side, so a
timed-out submit must be followed up via job status, never resent.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import requests

logger = logging.getLogger("syner_check.sunat")


class SunatError(Exception):
    """Validator failure with HTTP status + service error code (no secrets)."""

    def __init__(self, http_status: int | None, code: str, message: str = ""):
        super().__init__(f"SUNAT validator HTTP {http_status}: {code}.")
        self.http_status = http_status
        self.code = code
        self.detail = message


def _error_code(payload: object, http_status: int | None) -> tuple[str, str]:
    if isinstance(payload, dict):
        code = str(payload.get("error") or payload.get("code") or "UNKNOWN")
        message = str(payload.get("message") or "")[:200]
        return code, message
    return "INVALID_JSON", f"HTTP {http_status}"


class SunatValidatorClient:
    """Thin wrapper over the validator microservice (cache/queue/OAuth inside)."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 60.0,
        submit_timeout: float = 180.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = float(timeout)
        # Registering a chunk can legitimately take >60 s while the validator
        # enqueues the work. A too-short read timeout creates ambiguous POSTs
        # whose job id is lost, and resending would duplicate SUNAT work.
        self.submit_timeout = max(float(submit_timeout), self.timeout)
        self.session = requests.Session()
        # Header only; never log session headers (they hold the key).
        self.session.headers.update({
            "X-API-Key": api_key,
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
        })

    def _post(
        self,
        path: str,
        payload: dict[str, Any],
        timeout: float | None = None,
    ) -> dict[str, Any]:
        try:
            response = self.session.post(
                self.base_url + path,
                json=payload,
                timeout=self.timeout if timeout is None else float(timeout),
            )
        except requests.RequestException as exc:
            raise SunatError(None, "NETWORK_ERROR", type(exc).__name__) from exc
        try:
            body = response.json()
        except ValueError as exc:
            raise SunatError(
                response.status_code, "INVALID_JSON", "Non-JSON response."
            ) from exc
        if response.status_code not in (200, 202):
            code, message = _error_code(body, response.status_code)
            raise SunatError(response.status_code, code, message)
        if not isinstance(body, dict):
            raise SunatError(response.status_code, "INVALID_JSON", "")
        return body

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        try:
            response = self.session.get(
                self.base_url + path, params=params, timeout=self.timeout
            )
        except requests.RequestException as exc:
            raise SunatError(None, "NETWORK_ERROR", type(exc).__name__) from exc
        try:
            body = response.json()
        except ValueError as exc:
            raise SunatError(
                response.status_code, "INVALID_JSON", "Non-JSON response."
            ) from exc
        if response.status_code != 200:
            code, message = _error_code(body, response.status_code)
            raise SunatError(response.status_code, code, message)
        if not isinstance(body, dict):
            raise SunatError(response.status_code, "INVALID_JSON", "")
        return body

    def submit_batch(
        self, documentos: list[dict[str, Any]], usuario: str = "", origen: str = ""
    ) -> dict[str, Any]:
        """Register an async batch job. Single attempt (no idempotency key)."""
        payload: dict[str, Any] = {"documentos": documentos}
        if usuario:
            payload["usuario"] = usuario[:100]
        payload["origen"] = (origen or "syner-check")[:100]
        body = self._post(
            "/api/v1/comprobantes/validar-lote.php",
            payload,
            timeout=self.submit_timeout,
        )
        if "trabajo_id" not in body:
            raise SunatError(202, "MISSING_JOB_ID", "")
        return body

    def job_status(self, trabajo_id: int, detalle: bool = False) -> dict[str, Any]:
        """Poll a batch job. Safe to retry (idempotent GET)."""
        params: dict[str, Any] = {"id": int(trabajo_id)}
        if detalle:
            params["detalle"] = 1
        last: SunatError | None = None
        for attempt in range(3):
            try:
                return self._get("/api/v1/trabajos/estado.php", params)
            except SunatError as exc:
                if exc.http_status is not None and exc.http_status < 500:
                    raise
                last = exc
                logger.warning(
                    "Sunat job status attempt %d failed: %s",
                    attempt + 1,
                    exc.code,
                )
                time.sleep(2**attempt)
        assert last is not None
        raise last

    def validate_single(
        self, documento: dict[str, Any], usuario: str = "", origen: str = ""
    ) -> dict[str, Any]:
        """Synchronous single validation (manual revalidate only)."""
        payload = dict(documento)
        if usuario:
            payload["usuario"] = usuario[:100]
        payload["origen"] = (origen or "syner-check")[:100]
        return self._post("/api/v1/comprobantes/validar.php", payload)
