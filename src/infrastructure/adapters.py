"""Infrastructure adapters. Thin delegation to existing code, error translation."""

from __future__ import annotations

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
