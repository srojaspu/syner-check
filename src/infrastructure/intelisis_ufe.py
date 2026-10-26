"""Adaptador de lectura de Intelisis para el universo UFE.

Solo lectura: la conexion usa ``ApplicationIntent=ReadOnly`` y el login no
tiene ``EXECUTE`` sobre ningun procedimiento (D22).
"""

from __future__ import annotations

from typing import Any

from src.domain.errors import UpstreamError


class IntelisisUfeReaderAdapter:
    """Adapts ``app.intelisis_db`` to the IntelisisUfeReader port."""

    def fetch_rows(self, start_iso: str, end_iso: str) -> list[dict[str, Any]]:
        from app import intelisis_db

        try:
            return intelisis_db.fetch_ufe_rows(start_iso, end_iso)
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(
                f"Intelisis UFE read failed: {type(exc).__name__}."
            ) from exc

    def fetch_row(self, id_venta: int) -> list[dict[str, Any]]:
        from app import intelisis_db

        try:
            return intelisis_db.fetch_ufe_row(id_venta)
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(
                f"Intelisis UFE read failed: {type(exc).__name__}."
            ) from exc

    def fetch_attempts(self, id_venta: int) -> list[dict[str, Any]]:
        from app import intelisis_db

        try:
            return intelisis_db.fetch_ufe_attempts(id_venta)
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(
                f"Intelisis UFE read failed: {type(exc).__name__}."
            ) from exc

    def buscar_por_correlativo(self, correlativo: str) -> list[dict[str, Any]]:
        from app import intelisis_db

        try:
            return intelisis_db.fetch_ufe_documento(correlativo)
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(
                f"Intelisis UFE read failed: {type(exc).__name__}."
            ) from exc

    def fetch_resumen_erp(
        self, start_iso: str, end_iso: str
    ) -> list[dict[str, Any]]:
        from app import intelisis_db

        try:
            return intelisis_db.fetch_ufe_resumen_erp(start_iso, end_iso)
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(
                f"Intelisis UFE read failed: {type(exc).__name__}."
            ) from exc

    def fetch_sin_documento(
        self, start_iso: str, end_iso: str
    ) -> list[dict[str, Any]]:
        from app import intelisis_db

        try:
            return intelisis_db.fetch_ufe_sin_documento(start_iso, end_iso)
        except UpstreamError:
            raise
        except Exception as exc:
            raise UpstreamError(
                f"Intelisis UFE read failed: {type(exc).__name__}."
            ) from exc
