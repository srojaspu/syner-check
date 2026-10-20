"""Infrastructure adapters. Thin delegation to existing code, error translation."""

from __future__ import annotations

import threading
from typing import Sequence

from src.domain.errors import UpstreamError


class SqlReaderAdapter:
    """Adapts app.db to the SqlDocumentReader port."""

    def fetch_by_number(
        self,
        number: str,
        tipos: Sequence[str],
        start_iso: str | None,
        end_iso: str | None,
    ) -> list[dict]:
        from app import db as app_db

        try:
            return app_db.fetch_by_number(number, list(tipos), start_iso, end_iso)
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(f"SQL read failed: {type(exc).__name__}.") from exc

    def fetch_documents(
        self, start_iso: str, end_iso: str, tipos: Sequence[str]
    ) -> list[dict]:
        from app import db as app_db

        try:
            return app_db.fetch_documents(start_iso, end_iso, list(tipos))
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(f"SQL read failed: {type(exc).__name__}.") from exc


class IntelisisReaderAdapter:
    """Adapts app.db Intelisis/Venta fetch to the IntelisisReader port."""

    def fetch_headers(self, start_iso: str, end_iso: str) -> list[dict]:
        from app import db as app_db

        try:
            return app_db.fetch_intelisis_documents(start_iso, end_iso)
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(
                f"Intelisis read failed: {type(exc).__name__}."
            ) from exc


class SunatValidatorAdapter:
    """Adapts syner_check.sunat_client to the SunatValidator port.

    ``requests.Session`` is not thread-safe, so each worker thread gets its
    own client. The web pool and the SUNAT reconciliation worker can then poll
    different jobs concurrently without sharing a session.
    """

    _local = threading.local()

    @classmethod
    def _client_for(cls):
        from syner_check import config as cfg
        from syner_check.sunat_client import SunatValidatorClient

        validator = cfg.get_sunat_validator_config()
        marker = (validator["url"], validator["ruc"])
        client = getattr(cls._local, "client", None)
        if client is None or getattr(cls._local, "key", None) != marker:
            client = SunatValidatorClient(
                validator["url"],
                validator["api_key"],
                submit_timeout=validator.get("submit_timeout_seconds", 180),
            )
            cls._local.client = client
            cls._local.key = marker
        return client

    def submit_batch(
        self, documentos: list[dict], usuario: str = "", origen: str = ""
    ) -> dict:
        from src.domain.errors import UpstreamError as _Upstream
        from syner_check.sunat_client import SunatError

        try:
            return self._client_for().submit_batch(documentos, usuario, origen)
        except SunatError as exc:
            raise _Upstream(
                f"SUNAT submit failed: {exc.code}.",
                code=exc.code,
                http_status=exc.http_status,
            ) from exc
        except _Upstream:
            raise
        except Exception as exc:
            raise _Upstream(f"SUNAT submit failed: {type(exc).__name__}.") from exc

    def job_status(self, trabajo_id: int, detalle: bool = False) -> dict:
        from src.domain.errors import UpstreamError as _Upstream
        from syner_check.sunat_client import SunatError

        try:
            return self._client_for().job_status(trabajo_id, detalle)
        except SunatError as exc:
            raise _Upstream(
                f"SUNAT status failed: {exc.code}.",
                code=exc.code,
                http_status=exc.http_status,
            ) from exc
        except _Upstream:
            raise
        except Exception as exc:
            raise _Upstream(f"SUNAT status failed: {type(exc).__name__}.") from exc

    def validate_single(
        self, documento: dict, usuario: str = "", origen: str = ""
    ) -> dict:
        from src.domain.errors import UpstreamError as _Upstream
        from syner_check.sunat_client import SunatError

        try:
            return self._client_for().validate_single(documento, usuario, origen)
        except SunatError as exc:
            raise _Upstream(
                f"SUNAT validate failed: {exc.code}.",
                code=exc.code,
                http_status=exc.http_status,
            ) from exc
        except _Upstream:
            raise
        except Exception as exc:
            raise _Upstream(f"SUNAT validate failed: {type(exc).__name__}.") from exc


class SunatCacheStoreAdapter:
    """Adapts app.sunat_db to the SunatCacheStore port (writer account)."""

    def fetch_many(
        self, keys: Sequence[tuple[str, str, str, str]]
    ) -> dict[tuple[str, str, str, str], dict]:
        from app import sunat_db as sunat

        try:
            return sunat.fetch_cache(list(keys))
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(f"SUNAT cache read failed: {type(exc).__name__}.") from exc

    def upsert(self, row: dict) -> None:
        from app import sunat_db as sunat

        try:
            sunat.upsert_cache(row)
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(
                f"SUNAT cache write failed: {type(exc).__name__}."
            ) from exc

    def upsert_many(self, rows: Sequence[dict]) -> None:
        from app import sunat_db as sunat

        try:
            sunat.upsert_cache_many(list(rows))
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(
                f"SUNAT cache write failed: {type(exc).__name__}."
            ) from exc

    def job_progress(self, trabajo_id: int) -> dict:
        from app import sunat_db as sunat

        try:
            return sunat.job_progress(int(trabajo_id))
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(
                f"SUNAT job progress failed: {type(exc).__name__}."
            ) from exc

    def pending_jobs(self, limit: int = 50) -> list[dict]:
        from app import sunat_db as sunat

        try:
            return sunat.pending_jobs(int(limit))
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(
                f"SUNAT pending jobs failed: {type(exc).__name__}."
            ) from exc

    def mark_job_missing(self, trabajo_id: int, message: str) -> int:
        from app import sunat_db as sunat

        try:
            return sunat.mark_job_missing(int(trabajo_id), message)
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(
                f"SUNAT job cleanup failed: {type(exc).__name__}."
            ) from exc

    def mark_stale_unsubmitted(self, older_than_minutes: int, message: str) -> int:
        from app import sunat_db as sunat

        try:
            return sunat.mark_stale_unsubmitted(int(older_than_minutes), message)
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(
                f"SUNAT stale cleanup failed: {type(exc).__name__}."
            ) from exc


class GraphqlGatewayAdapter:
    """Adapts app.graphql to the GraphqlGateway port."""

    def detail(
        self,
        tipo: str,
        start_iso: str,
        end_iso: str,
        number: str | None = None,
    ) -> list[dict]:
        from app import graphql as app_gql

        try:
            return app_gql.detail(tipo, start_iso, end_iso, number)
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(f"GraphQL read failed: {type(exc).__name__}.") from exc

    def summary(
        self, start_iso: str, end_iso: str, tipos: Sequence[str]
    ) -> dict[str, list[dict]]:
        from app import graphql as app_gql

        try:
            return app_gql.summary(start_iso, end_iso, list(tipos))
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(f"GraphQL read failed: {type(exc).__name__}.") from exc

    def search_by_serie(self, tipo: str, number: str) -> list[dict]:
        from app import graphql as app_gql

        try:
            return app_gql.search_by_serie(tipo, number)
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(f"GraphQL read failed: {type(exc).__name__}.") from exc

    def detail_by_serie(self, tipo: str, number: str) -> list[dict]:
        from app import graphql as app_gql

        try:
            return app_gql.detail_by_serie(tipo, number)
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(f"GraphQL read failed: {type(exc).__name__}.") from exc
