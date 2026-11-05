"""Domain model and validation for SerieSucursal (catálogo de series por sucursal).

Pure domain layer: zero external/database dependencies.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any

from src.domain.errors import SerieSucursalValidationError

MAX_NOMBRE_LENGTH = 100
MAX_PREFIJO_LENGTH = 10
MAX_SERIE_LENGTH = 10
_SERIE_REGEX = re.compile(r"^[A-Z0-9_-]+$")


@dataclass(frozen=True)
class SerieSucursal:
    """Representa una sucursal y su configuración de serie en SynerPOS."""

    sucursal: int
    nombre: str
    prefijo: str
    seriesynerpos: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def validate_sucursal(value: Any) -> int:
    """Valida que el código de sucursal sea un entero positivo válido."""
    if value is None or str(value).strip() == "":
        raise SerieSucursalValidationError("El código de sucursal es obligatorio.")
    try:
        sucursal_int = int(value)
    except (TypeError, ValueError) as exc:
        raise SerieSucursalValidationError(
            "El código de sucursal debe ser un número entero."
        ) from exc

    if sucursal_int <= 0 or sucursal_int > 999999:
        raise SerieSucursalValidationError(
            "El código de sucursal debe estar entre 1 y 999999."
        )
    return sucursal_int


def validate_nombre(value: Any) -> str:
    """Valida el nombre descriptivo de la sucursal (1 a 100 caracteres)."""
    text = str(value or "").strip()
    if not text:
        raise SerieSucursalValidationError(
            "El nombre de la sucursal es obligatorio."
        )
    if len(text) > MAX_NOMBRE_LENGTH:
        raise SerieSucursalValidationError(
            f"El nombre no puede exceder {MAX_NOMBRE_LENGTH} caracteres."
        )
    return text


def validate_prefijo(value: Any, sucursal: int) -> str:
    """Valida el prefijo contable. Si no se provee, asigna '{sucursal}- '."""
    text = str(value or "").strip()
    if not text:
        return f"{sucursal}- "
    if len(text) > MAX_PREFIJO_LENGTH:
        raise SerieSucursalValidationError(
            f"El prefijo no puede exceder {MAX_PREFIJO_LENGTH} caracteres."
        )
    # Conserva un espacio al final si el patrón común lo tiene, o normaliza con espacio
    if not text.endswith(" ") and len(text) < MAX_PREFIJO_LENGTH:
        text = f"{text} "
    return text


def validate_seriesynerpos(value: Any) -> str | None:
    """Valida el código de serie en SynerPOS.

    Puede ser None o vacío (sucursal sin serie asignada). Si se asigna, debe
    tener de 1 a 10 caracteres alfanuméricos en mayúsculas (ej. 'S02', '004', 'S20').
    """
    if value is None:
        return None
    text = str(value).strip().upper()
    if not text or text == "-" or text == "NULL":
        return None
    if len(text) > MAX_SERIE_LENGTH:
        raise SerieSucursalValidationError(
            f"La serie SynerPOS no puede exceder {MAX_SERIE_LENGTH} caracteres."
        )
    if not _SERIE_REGEX.match(text):
        raise SerieSucursalValidationError(
            "La serie SynerPOS solo permite letras, números y guiones."
        )
    return text


def validate_serie_sucursal_payload(
    data: dict[str, Any], *, is_create: bool = True
) -> dict[str, Any]:
    """Normaliza y valida el payload completo para creación o actualización."""
    if not isinstance(data, dict):
        raise SerieSucursalValidationError("El payload debe ser un objeto JSON.")

    sucursal = validate_sucursal(data.get("sucursal"))
    nombre = validate_nombre(data.get("nombre"))
    prefijo = validate_prefijo(data.get("prefijo"), sucursal)
    seriesynerpos = validate_seriesynerpos(data.get("seriesynerpos"))

    return {
        "sucursal": sucursal,
        "nombre": nombre,
        "prefijo": prefijo,
        "seriesynerpos": seriesynerpos,
    }
