"""Domain public surface."""

from .entities import Document, FechaRango, TipoDocumento
from .errors import (
    DomainError,
    InvalidDocumentTypeError,
    InvalidRangeError,
    NotFoundError,
    UnauthorizedError,
    UpstreamError,
)

__all__ = [
    "Document",
    "FechaRango",
    "TipoDocumento",
    "DomainError",
    "InvalidDocumentTypeError",
    "InvalidRangeError",
    "NotFoundError",
    "UnauthorizedError",
    "UpstreamError",
]
