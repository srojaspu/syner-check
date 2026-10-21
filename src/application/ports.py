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


class SunatValidator(Protocol):
    """SUNAT Validator microservice (batch submit + job polling)."""

    def submit_batch(
        self,
        documentos: list[dict],
        usuario: str = "",
        origen: str = "",
        forzar_consulta: bool = False,
    ) -> dict:
        ...

    def job_status(self, trabajo_id: int, detalle: bool = False) -> dict:
        ...

    def validate_single(
        self, documento: dict, usuario: str = "", origen: str = ""
    ) -> dict:
        ...


class SunatCacheStore(Protocol):
    """Persistent SUNAT validation cache (dbo.SunatValidacion).

    Keys are the SUNAT identity (Ruc, Tipo, Serie, Numero) — always 4-tuples.
    """

    def fetch_many(
        self, keys: Sequence[tuple[str, str, str, str]]
    ) -> dict[tuple[str, str, str, str], dict]:
        ...

    def upsert(self, row: dict) -> None:
        ...

    def upsert_many(self, rows: Sequence[dict]) -> None:
        """Write several rows over one connection/transaction."""
        ...

    def job_progress(self, trabajo_id: int) -> dict:
        """Durable counts for one validator job (local cache)."""
        ...

    def pending_jobs(self, limit: int = 50) -> list[dict]:
        """Jobs that still have PENDIENTE/PROCESANDO rows."""
        ...

    def mark_job_missing(self, trabajo_id: int, message: str) -> int:
        """Mark pending rows of a job SUNAT no longer knows as ERROR."""
        ...

    def mark_stale_unsubmitted(self, older_than_minutes: int, message: str) -> int:
        """Mark pending rows whose submit never got a TrabajoID as ERROR."""
        ...


class MovSynerPosWriter(Protocol):
    """Escritura idempotente en dbo.MovSynerPos (solo SELECT + INSERT)."""

    def existing_lines(self, oid: str, tipo: str) -> dict[int, str]:
        """``Idx`` existentes para el documento -> ``SerieNumero``."""
        ...

    def serie_conflicts(
        self, tipo: str, serie: str, idxs: Sequence[int]
    ) -> dict[int, str]:
        """``Idx`` que ya existen con la misma serie/tipo y otro ``IDSynerPos``."""
        ...

    def insert_lines(self, documento: object, lineas: Sequence[dict]) -> int:
        """Inserta las líneas en una transacción; devuelve cuántas insertó."""
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
