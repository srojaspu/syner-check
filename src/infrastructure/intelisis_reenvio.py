"""Adaptador de la cola de reenvios del ERP (``dbo.FE_Reenvio``).

Traduce ``syner_check.intelisis_fe_reenvio`` (pyodbc) al puerto de la capa de
aplicacion. La aplicacion nunca ve pyodbc, ni los locks, ni el nombre de la
tabla.

No hay adaptador de generador: el SP lo ejecuta el worker PHP del ERP en su
tarea programada, no esta aplicacion.
"""

from __future__ import annotations

import logging
from typing import Any

from src.domain.errors import NotFoundError, ReenvioNoPermitidoError, UpstreamError

logger = logging.getLogger("syner_check.intelisis_reenvio")


class IntelisisFeReenvioAdapter:
    """Adapta ``syner_check.intelisis_fe_reenvio`` al puerto de cola."""

    def encolar(
        self,
        *,
        id_venta: int,
        usuario: str,
        motivo: str,
        token: str,
        correlation_id: str = "",
    ) -> dict[str, Any]:
        from syner_check import intelisis_fe_reenvio as cola

        try:
            return cola.encolar(
                id_venta=id_venta,
                usuario=usuario,
                motivo=motivo,
                token=token,
                correlation_id=correlation_id,
            )
        except (NotFoundError, ReenvioNoPermitidoError):
            raise
        except Exception as exc:  # noqa: BLE001 - se traduce a error de upstream
            raise UpstreamError(
                f"FE_Reenvio enqueue failed: {type(exc).__name__}."
            ) from exc

    def panel(self, *, limit: int = 20, estado: str = "") -> dict[str, Any]:
        from syner_check import intelisis_fe_reenvio as cola

        try:
            return cola.panel(limit=limit, estado=estado)
        except Exception as exc:  # noqa: BLE001
            raise UpstreamError(
                f"FE_Reenvio panel failed: {type(exc).__name__}."
            ) from exc

    def resolver(self, queue_id: int, *, actor: str, nota: str) -> dict[str, Any]:
        from syner_check import intelisis_fe_reenvio as cola

        try:
            return cola.resolver(queue_id, actor=actor, nota=nota)
        except (NotFoundError, ReenvioNoPermitidoError):
            raise
        except Exception as exc:  # noqa: BLE001
            raise UpstreamError(
                f"FE_Reenvio resolve failed: {type(exc).__name__}."
            ) from exc


__all__ = ["IntelisisFeReenvioAdapter"]
