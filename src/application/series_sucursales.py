"""Application use cases for SerieSucursal (CRUD de series por sucursal).

Clean architecture: depends only on domain and application ports.
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from src.application.ports import SerieSucursalRepository
from src.domain.errors import (
    SerieSucursalDuplicateError,
    SerieSucursalNotFoundError,
)
from src.domain.series_sucursales import (
    validate_serie_sucursal_payload,
    validate_sucursal,
)

logger = logging.getLogger("syner_check.series_sucursales")


def listar_series_sucursales(
    repo: SerieSucursalRepository,
    search: str | None = None,
) -> list[dict[str, Any]]:
    """Lista las sucursales con soporte de filtro de búsqueda."""
    items = repo.list_all()
    q = (search or "").strip().lower()
    if not q:
        return items

    filtrados: list[dict[str, Any]] = []
    for item in items:
        sucursal_str = str(item.get("sucursal", ""))
        nombre_str = str(item.get("nombre", "")).lower()
        prefijo_str = str(item.get("prefijo", "")).lower()
        serie_str = str(item.get("seriesynerpos") or "").lower()

        if (
            q in sucursal_str
            or q in nombre_str
            or q in prefijo_str
            or q in serie_str
        ):
            filtrados.append(item)
    return filtrados


def obtener_serie_sucursal(
    repo: SerieSucursalRepository,
    sucursal_id: int,
) -> dict[str, Any]:
    """Obtiene una sucursal por su código numérico."""
    sucursal = validate_sucursal(sucursal_id)
    item = repo.get_by_sucursal(sucursal)
    if not item:
        raise SerieSucursalNotFoundError(
            f"No se encontró la sucursal {sucursal}."
        )
    return item


def crear_serie_sucursal(
    repo: SerieSucursalRepository,
    payload: dict[str, Any],
    actor: str,
    correlation_id: str = "",
) -> dict[str, Any]:
    """Crea una nueva sucursal con validación de unicidad."""
    valid = validate_serie_sucursal_payload(payload, is_create=True)
    sucursal = valid["sucursal"]
    serie = valid["seriesynerpos"]
    correlation = (correlation_id or "").strip() or str(uuid.uuid4())
    started = time.monotonic()

    # 1. Unicidad de código de sucursal
    existing_sucursal = repo.get_by_sucursal(sucursal)
    if existing_sucursal:
        raise SerieSucursalDuplicateError(
            f"Ya existe una sucursal con el código {sucursal} "
            f"({existing_sucursal.get('nombre')})."
        )

    # 2. Unicidad de serie en SynerPOS si no es nula
    if serie:
        existing_serie = repo.get_by_serie(serie)
        if existing_serie:
            raise SerieSucursalDuplicateError(
                f"La serie '{serie}' ya está asignada a la sucursal "
                f"{existing_serie.get('sucursal')} ({existing_serie.get('nombre')})."
            )

    created = repo.create(valid)
    logger.info(
        "SerieSucursal created correlation_id=%s actor=%s sucursal=%d "
        "nombre=%s prefijo=%s seriesynerpos=%s elapsed_ms=%d",
        correlation,
        actor or "-",
        sucursal,
        valid["nombre"],
        valid["prefijo"],
        serie or "-",
        int((time.monotonic() - started) * 1000),
    )
    return created


def actualizar_serie_sucursal(
    repo: SerieSucursalRepository,
    sucursal_id: int,
    payload: dict[str, Any],
    actor: str,
    correlation_id: str = "",
) -> dict[str, Any]:
    """Actualiza una sucursal existente."""
    sucursal = validate_sucursal(sucursal_id)
    correlation = (correlation_id or "").strip() or str(uuid.uuid4())
    started = time.monotonic()

    # 1. Verificar existencia
    current = repo.get_by_sucursal(sucursal)
    if not current:
        raise SerieSucursalNotFoundError(
            f"No se encontró la sucursal {sucursal} para actualizar."
        )

    # 2. Validar payload (forzando el sucursal_id de la URL)
    payload_with_id = {**payload, "sucursal": sucursal}
    valid = validate_serie_sucursal_payload(payload_with_id, is_create=False)
    new_serie = valid["seriesynerpos"]

    # 3. Unicidad de serie si cambió y no es nula
    if new_serie and new_serie != current.get("seriesynerpos"):
        existing_serie = repo.get_by_serie(new_serie)
        if (
            existing_serie
            and int(existing_serie.get("sucursal", 0)) != sucursal
        ):
            raise SerieSucursalDuplicateError(
                f"La serie '{new_serie}' ya está asignada a la sucursal "
                f"{existing_serie.get('sucursal')} ({existing_serie.get('nombre')})."
            )

    updated = repo.update(sucursal, valid)
    logger.info(
        "SerieSucursal updated correlation_id=%s actor=%s sucursal=%d "
        "nombre=%s prefijo=%s seriesynerpos=%s elapsed_ms=%d",
        correlation,
        actor or "-",
        sucursal,
        valid["nombre"],
        valid["prefijo"],
        new_serie or "-",
        int((time.monotonic() - started) * 1000),
    )
    return updated


def eliminar_serie_sucursal(
    repo: SerieSucursalRepository,
    sucursal_id: int,
    actor: str,
    correlation_id: str = "",
) -> dict[str, Any]:
    """Elimina una sucursal."""
    sucursal = validate_sucursal(sucursal_id)
    correlation = (correlation_id or "").strip() or str(uuid.uuid4())
    started = time.monotonic()

    current = repo.get_by_sucursal(sucursal)
    if not current:
        raise SerieSucursalNotFoundError(
            f"No se encontró la sucursal {sucursal} para eliminar."
        )

    deleted = repo.delete(sucursal)
    if not deleted:
        raise SerieSucursalNotFoundError(
            f"No se pudo eliminar la sucursal {sucursal}."
        )

    logger.info(
        "SerieSucursal deleted correlation_id=%s actor=%s sucursal=%d "
        "nombre=%s serie=%s elapsed_ms=%d",
        correlation,
        actor or "-",
        sucursal,
        current.get("nombre", "-"),
        current.get("seriesynerpos", "-") or "-",
        int((time.monotonic() - started) * 1000),
    )
    return {
        "solicitud_id": correlation,
        "sucursal": sucursal,
        "mensaje": f"Sucursal {sucursal} eliminada exitosamente.",
    }
