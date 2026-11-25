"""Adaptador GraphQL de los logs de terminales POS (SynerCOM).

Único punto que conoce el contrato del endpoint: arma la query con proyección
de campos (``value`` solo en ventanas cortas), limita la concurrencia para no
saturar un endpoint restringido y traduce cualquier fallo a ``UpstreamError``.

No imprime `message` ni `value`: pueden contener datos de la operación.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Callable, Mapping
from typing import Any

from syner_check.graphql_client import GraphQLQueryError
from src.domain.errors import InvalidPosLogError, UpstreamError
from src.domain.pos_logs import MAX_KEY_CHARS, PosLogEvent, TimeWindow, parse_event

logger = logging.getLogger("syner_check.pos_logs")

MAX_FILTER_CHARS = 160
DEFAULT_MAX_ROWS = 60_000
DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_CONCURRENCY = 2
DEFAULT_ACQUIRE_TIMEOUT = 5.0

_SUMMARY_FIELDS = "oid logdatetime level key instance message"
_FIELDS_WITH_VALUE = f"{_SUMMARY_FIELDS} value"

ClientFactory = Callable[[float], Any]


def _graphql_string(value: str) -> str:
    """Serializa un string GraphQL sin permitir inyección de argumentos."""
    return json.dumps(value, ensure_ascii=False)


def _checked_filter(value: str, limit: int, label: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"El filtro {label} no puede estar vacío.")
    if len(text) > limit:
        raise ValueError(f"El filtro {label} supera {limit} caracteres.")
    return text


def _build_default_client(timeout: float):
    """Cliente real; importa el paquete legacy solo cuando se usa.

    Así los tests pueden inyectar un cliente falso sin cargar configuración ni
    credenciales.
    """
    from syner_check import auth
    from syner_check.config import get_graphql_company_id, get_graphql_url
    from syner_check.graphql_client import GraphQLClient

    return GraphQLClient(
        url=get_graphql_url(),
        token=auth.ensure_token(),
        on_unauthorized=lambda: auth.refresh()["access_token"],
        timeout=timeout,
        company_id=get_graphql_company_id() or None,
    )


class PosLogSourceAdapter:
    """Implementación de ``PosLogSource`` sobre el GraphQL de SynerCOM.

    - Una llamada por ventana (el caso de uso se encarga de la caché).
    - Semáforo propio: como máximo ``max_concurrency`` consultas simultáneas.
    - Deduplica por ``oid`` y ordena por fecha, porque el API no garantiza orden.
    """

    def __init__(
        self,
        *,
        client_factory: ClientFactory | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        max_rows: int = DEFAULT_MAX_ROWS,
        max_concurrency: int = DEFAULT_MAX_CONCURRENCY,
        acquire_timeout: float = DEFAULT_ACQUIRE_TIMEOUT,
        semaphore: threading.BoundedSemaphore | None = None,
    ) -> None:
        if max_rows < 1:
            raise ValueError("max_rows debe ser positivo.")
        if max_concurrency < 1:
            raise ValueError("max_concurrency debe ser positivo.")
        self._client_factory = client_factory or _build_default_client
        self._timeout = float(timeout)
        self._max_rows = int(max_rows)
        self._acquire_timeout = float(acquire_timeout)
        self._semaphore = semaphore or threading.BoundedSemaphore(max_concurrency)
        self._client_lock = threading.Lock()
        self._client_obj: Any | None = None

    def fetch(
        self,
        window: TimeWindow,
        *,
        key: str | None = None,
        message: str | None = None,
    ) -> list[PosLogEvent]:
        query = self._build_query(window, key=key, message=message)
        if not self._semaphore.acquire(timeout=self._acquire_timeout):
            raise UpstreamError(
                "Sin cupo para consultar logs POS.",
                code="busy",
                public_message=(
                    "El servicio de logs está ocupado; intenta de nuevo en "
                    "unos segundos."
                ),
            )
        started = time.perf_counter()
        try:
            response = self._client().execute(query)
        except UpstreamError:
            raise
        except Exception as exc:  # noqa: BLE001 - se traduce a error de dominio
            raise self._translate(exc) from exc
        finally:
            self._semaphore.release()

        rows = self._rows(response)
        if len(rows) > self._max_rows:
            raise UpstreamError(
                f"La consulta devolvió {len(rows)} filas (máximo {self._max_rows}).",
                code="too_many",
                public_message=(
                    "La ventana tiene demasiados eventos para analizarla de "
                    "una vez; acota el rango de fechas."
                ),
            )

        events: dict[str, PosLogEvent] = {}
        skipped = 0
        for row in rows:
            try:
                event = parse_event(row)
            except InvalidPosLogError:
                skipped += 1
                continue
            # El API no garantiza unicidad; ante un oid repetido gana el
            # último registro recibido.
            events[event.oid] = event

        result = sorted(events.values(), key=lambda item: (item.at, item.oid))
        logger.debug(
            "pos_logs.fetch rows=%d events=%d skipped=%d ms=%.0f value=%s",
            len(rows),
            len(result),
            skipped,
            (time.perf_counter() - started) * 1000,
            window.includes_value,
        )
        return result

    # --- internos -------------------------------------------------------
    def warm_up(self) -> None:
        """Abre token/TLS con una consulta trivial; no lee logs.

        La primera consulta a SynerCOM después de un arranque puede tardar
        >10 s por DNS/TLS. Este hilo de arranque paga ese costo antes de que
        llegue el primer usuario. Un fallo aquí nunca debe impedir el arranque.
        """
        try:
            self._client().execute("query { __typename }")
        except Exception:  # noqa: BLE001 - warm-up best-effort
            logger.debug("pos_logs.warm_up failed", exc_info=True)

    def _client(self):
        with self._client_lock:
            if self._client_obj is None:
                self._client_obj = self._client_factory(self._timeout)
            return self._client_obj

    def _build_query(
        self,
        window: TimeWindow,
        *,
        key: str | None,
        message: str | None,
    ) -> str:
        args = [
            f"startDate: {_graphql_string(window.start.isoformat())}",
            f"endDate: {_graphql_string(window.end.isoformat())}",
        ]
        if key:
            args.append(
                f"key: {_graphql_string(_checked_filter(key, MAX_KEY_CHARS, 'clave'))}"
            )
        if message:
            args.append(
                f"message: {_graphql_string(_checked_filter(message, MAX_FILTER_CHARS, 'mensaje'))}"
            )
        fields = _FIELDS_WITH_VALUE if window.includes_value else _SUMMARY_FIELDS
        return f"query {{ logs({', '.join(args)}) {{ {fields} }} }}"

    @staticmethod
    def _rows(response: Any) -> list[Mapping[str, Any]]:
        if not isinstance(response, Mapping):
            raise UpstreamError(
                "Respuesta GraphQL inválida.",
                code="malformed",
                public_message="El servicio de logs devolvió una respuesta inesperada.",
            )
        payload = response.get("data")
        rows = payload.get("logs") if isinstance(payload, Mapping) else None
        if rows is None:
            errors = response.get("errors")
            count = len(errors) if isinstance(errors, list) else 0
            raise UpstreamError(
                f"GraphQL no devolvió logs ({count} errores).",
                code="graphql",
                public_message="No se pudieron consultar los logs en este momento.",
            )
        if not isinstance(rows, list):
            raise UpstreamError(
                "El campo logs no es una lista.",
                code="malformed",
                public_message="El servicio de logs devolvió una respuesta inesperada.",
            )
        return rows

    @staticmethod
    def _translate(exc: BaseException) -> UpstreamError:
        code = "graphql" if isinstance(exc, GraphQLQueryError) else "upstream"
        logger.warning(
            "pos_logs.fetch failed code=%s type=%s", code, type(exc).__name__
        )
        return UpstreamError(
            f"Fallo consultando logs POS: {type(exc).__name__}.",
            code=code,
            public_message=(
                "No se pudo consultar el servicio de logs. Intenta de nuevo."
            ),
        )
