"""Acceso de solo lectura a Intelisis/Punidas para el universo UFE.

Capa de pegamento entre ``syner_check`` (cliente SQL heredado) y
``src`` (arquitectura limpia). No escribe nada y nunca ejecuta
procedimientos almacenados: el login de lectura no tiene ``EXECUTE``.
"""

from __future__ import annotations

from typing import Any

from src.domain.errors import UpstreamError
from syner_check.config import (
    get_intelisis_config,
    get_intelisis_password,
    is_intelisis_configured,
)
from syner_check.intelisis_ufe_client import (
    fetch_intelisis_ufe_attempts,
    fetch_intelisis_ufe_documento,
    fetch_intelisis_ufe_resumen_erp,
    fetch_intelisis_ufe_row,
    fetch_intelisis_ufe_rows,
    fetch_intelisis_ufe_sin_documento,
)


def intelisis_enabled() -> bool:
    """True cuando la conexion a Intelisis esta configurada."""
    return is_intelisis_configured()


def fetch_ufe_rows(start_date: str, end_date: str) -> list[dict[str, Any]]:
    """Comprueba del universo UFE con su ultimo intento en la bitacora.

    Raises UpstreamError cuando la consulta falla; la pantalla degrada a
    "Intelisis no disponible" en vez de romperse.
    """
    if not is_intelisis_configured():
        raise UpstreamError("Intelisis no configurado.")
    try:
        return fetch_intelisis_ufe_rows(start_date, end_date)
    except UpstreamError:
        raise
    except Exception as exc:  # noqa: BLE001 - se traduce a error de upstream
        raise UpstreamError(
            f"Intelisis read failed: {type(exc).__name__}."
        ) from exc


def fetch_ufe_row(id_venta: int) -> list[dict[str, Any]]:
    """Un comprobante del universo UFE (vacio si no existe)."""
    if not is_intelisis_configured():
        raise UpstreamError("Intelisis no configurado.")
    try:
        return fetch_intelisis_ufe_row(id_venta)
    except UpstreamError:
        raise
    except Exception as exc:
        raise UpstreamError(
            f"Intelisis read failed: {type(exc).__name__}."
        ) from exc


def fetch_ufe_documento(correlativo: str) -> list[dict[str, Any]]:
    """Candidatos por correlativo de documento (busqueda por numero)."""
    if not is_intelisis_configured():
        raise UpstreamError("Intelisis no configurado.")
    try:
        return fetch_intelisis_ufe_documento(correlativo)
    except UpstreamError:
        raise
    except Exception as exc:
        raise UpstreamError(
            f"Intelisis read failed: {type(exc).__name__}."
        ) from exc


def fetch_ufe_attempts(id_venta: int) -> list[dict[str, Any]]:
    """Todos los intentos de la bitacora para un comprobante."""
    if not is_intelisis_configured():
        raise UpstreamError("Intelisis no configurado.")
    try:
        return fetch_intelisis_ufe_attempts(id_venta)
    except UpstreamError:
        raise
    except Exception as exc:
        raise UpstreamError(
            f"Intelisis read failed: {type(exc).__name__}."
        ) from exc


def fetch_ufe_resumen_erp(
    start_date: str, end_date: str
) -> list[dict[str, Any]]:
    """Ventas del eje agrupadas por estatus del ERP (los 4 estados)."""
    if not is_intelisis_configured():
        raise UpstreamError("Intelisis no configurado.")
    try:
        return fetch_intelisis_ufe_resumen_erp(start_date, end_date)
    except UpstreamError:
        raise
    except Exception as exc:
        raise UpstreamError(
            f"Intelisis read failed: {type(exc).__name__}."
        ) from exc


def fetch_ufe_sin_documento(
    start_date: str, end_date: str
) -> list[dict[str, Any]]:
    """Ventas SINAFECTAR del periodo (dialogo "Ventas sin documentar")."""
    if not is_intelisis_configured():
        raise UpstreamError("Intelisis no configurado.")
    try:
        return fetch_intelisis_ufe_sin_documento(start_date, end_date)
    except UpstreamError:
        raise
    except Exception as exc:
        raise UpstreamError(
            f"Intelisis read failed: {type(exc).__name__}."
        ) from exc


__all__ = [
    "fetch_ufe_attempts",
    "fetch_ufe_documento",
    "fetch_ufe_resumen_erp",
    "fetch_ufe_row",
    "fetch_ufe_rows",
    "fetch_ufe_sin_documento",
    "get_intelisis_config",
    "get_intelisis_password",
    "intelisis_enabled",
]
