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


class MovSynerPosValidationError(DomainError):
    """Raised when a document cannot be mapped to dbo.MovSynerPos safely."""


class NotFoundError(LookupError):
    """Raised when a document is not found."""


class UpstreamError(RuntimeError):
    """Raised when an infrastructure provider fails.

    ``code``/``http_status`` are optional and let callers distinguish a
    retryable outage (network/5xx) from a definitive answer (e.g. 404 job
    not found) without importing infrastructure exceptions.
    """

    def __init__(
        self,
        message: str = "",
        *,
        code: str | None = None,
        http_status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.http_status = http_status
