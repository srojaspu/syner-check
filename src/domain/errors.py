"""Domain errors. Pure stdlib, no I/O imports."""

from __future__ import annotations


class DomainError(ValueError):
    """Base for all domain validation failures."""


class InvalidRangeError(DomainError):
    """Raised when a date range is invalid."""


class InvalidDocumentTypeError(DomainError):
    """Raised when a document type literal is unknown."""


class UnauthorizedError(PermissionError):
    """Raised when an identity is not allowed."""


class NotFoundError(LookupError):
    """Raised when a document is not found."""


class UpstreamError(RuntimeError):
    """Raised when an infrastructure provider fails."""
