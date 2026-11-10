import logging
import os
import time
from collections.abc import Callable
from typing import Any

import requests

logger = logging.getLogger("syner_check.graphql")


class GraphQLQueryError(RuntimeError):
    """GraphQL respondió con errores y sin datos utilizables.

    Conserva la lista ``errors`` del proveedor para que la capa que conoce
    los campos opcionales (``app.graphql``) pueda distinguir un error de
    validación de esquema (campo inexistente en esta instancia) de un fallo
    real de la consulta.
    """

    def __init__(self, message: str, errors: list[dict] | None = None):
        super().__init__(message)
        self.errors = list(errors or [])


class GraphQLClient:
    def __init__(
        self,
        url: str,
        token: str | None = None,
        on_unauthorized: Callable[[], str] | None = None,
        timeout: float | None = None,
        company_id: str | None = None,
    ):
        self.url = url
        self.on_unauthorized = on_unauthorized
        if timeout is not None:
            self.timeout = float(timeout)
        else:
            self.timeout = float(os.getenv("GRAPHQL_TIMEOUT", "60"))
        self.session = requests.Session()

        self.session.headers.update({
            "Content-Type": "application/json",
            "Accept": "application/json",
        })

        if token:
            self.session.headers.update({
                "Authorization": f"Bearer {token}"
            })

        # Company context (integration manual §1, critical). Falls back to
        # env so direct GraphQLClient users also send it.
        resolved_company = (company_id or os.getenv("GRAPHQL_COMPANY_ID", "") or "").strip()
        if resolved_company:
            self.session.headers.update({
                "X-CONTEXT-COMPANY": resolved_company
            })

    def execute(self, query: str, variables: dict | None = None) -> dict[str, Any]:
        payload = {
            "query": query,
        }

        if variables:
            payload["variables"] = variables

        # Per-request flag (not instance state): the client is shared across
        # threads, so a single auth retry must be scoped to this call.
        auth_retried = False
        timeout = self.timeout
        for attempt in range(1, 4):
            try:
                response = self.session.post(
                    self.url,
                    json=payload,
                    timeout=timeout,
                )
            except (requests.Timeout, requests.ConnectionError) as exc:
                if attempt >= 3:
                    raise RuntimeError(
                        f"Error conectando con GraphQL: {exc}"
                    ) from exc
                delay = 2 ** (attempt - 1)
                logger.warning(
                    "GraphQL retry %d/3 after network error "
                    "(attempt %d failed, waiting %ds)...",
                    attempt + 1,
                    attempt,
                    delay,
                )
                time.sleep(delay)
                continue
            except requests.RequestException as exc:
                raise RuntimeError(
                    f"Error conectando con GraphQL: {exc}"
                ) from exc

            status = response.status_code
            if status in (401, 403) and self.on_unauthorized is not None:
                if auth_retried:
                    raise RuntimeError(
                        f"HTTP {status}: GraphQL request failed."
                    )
                auth_retried = True
                try:
                    new_token = self.on_unauthorized()
                except Exception as exc:
                    raise RuntimeError(
                        f"HTTP {status}: token refresh failed."
                    ) from exc
                if not new_token:
                    raise RuntimeError(
                        f"HTTP {status}: token refresh failed."
                    )
                self.session.headers.update({
                    "Authorization": f"Bearer {new_token}"
                })
                try:
                    response = self.session.post(
                        self.url,
                        json=payload,
                        timeout=timeout,
                    )
                except requests.RequestException as exc:
                    raise RuntimeError(
                        f"Error conectando con GraphQL: {exc}"
                    ) from exc
                status = response.status_code
            if 500 <= status <= 599:
                if attempt >= 3:
                    raise RuntimeError(
                        f"HTTP {status}: GraphQL request failed."
                    )
                delay = 2 ** (attempt - 1)
                logger.warning(
                    "GraphQL retry %d/3 after HTTP %s "
                    "(attempt %d failed, waiting %ds)...",
                    attempt + 1,
                    status,
                    attempt,
                    delay,
                )
                time.sleep(delay)
                continue

            if status != 200:
                raise RuntimeError(
                    f"HTTP {status}: GraphQL request failed."
                )

            try:
                result = response.json()
            except ValueError as exc:
                raise RuntimeError(
                    "La respuesta no es un JSON válido."
                ) from exc

            if "errors" in result:
                data = result.get("data")
                has_data = isinstance(data, dict) and any(
                    v is not None for v in data.values()
                )
                if not has_data:
                    raise GraphQLQueryError(
                        "GraphQL devolvió un error en la consulta.",
                        result.get("errors"),
                    )
                logger.warning(
                    "GraphQL partial errors returned alongside data (count=%d)",
                    len(result.get("errors") or []),
                )

            return result

        raise RuntimeError("Error conectando con GraphQL: reintentos agotados.")
