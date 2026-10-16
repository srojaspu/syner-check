"""Application ports. Stdlib only; infrastructure implements these."""

from __future__ import annotations

from typing import Protocol, Sequence


class SqlDocumentReader(Protocol):
    def fetch_by_number(
        self,
        number: str,
        tipos: Sequence[str],
        start_iso: str | None,
        end_iso: str | None,
    ) -> list[dict]:
        ...

    def fetch_documents(
        self, start_iso: str, end_iso: str, tipos: Sequence[str]
    ) -> list[dict]:
        ...


class IntelisisReader(Protocol):
    """Reads Intelisis/Venta headers (SynerPOS origin only: SE-* Movs)."""

    def fetch_headers(self, start_iso: str, end_iso: str) -> list[dict]:
        ...


class GraphqlGateway(Protocol):
    def detail(
        self,
        tipo: str,
        start_iso: str,
        end_iso: str,
        number: str | None = None,
    ) -> list[dict]:
        ...

    def summary(
        self, start_iso: str, end_iso: str, tipos: Sequence[str]
    ) -> dict[str, list[dict]]:
        ...

    def search_by_serie(self, tipo: str, number: str) -> list[dict]:
        """Light docs filtered server-side by `serie` (<number>%).

        Only FACTURA and BOLETA support it.
        """
        ...

    def detail_by_serie(self, tipo: str, number: str) -> list[dict]:
        """Full detail docs filtered server-side by `serie` (<number>%).

        Only FACTURA and BOLETA support it.
        """
        ...
