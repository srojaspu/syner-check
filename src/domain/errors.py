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


class MovSynerPosDeleteBlockedError(DomainError):
    """Raised when a document cannot be deleted from MovSynerPos safely.

    Today the only blocking reason is that Intelisis already concluded the
    sale: deleting the MovSynerPos rows first would desynchronize the ERP.
    """


class ReenvioNoPermitidoError(DomainError):
    """Raised when a document cannot be queued for regeneration."""


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
        public_message: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.http_status = http_status
        # Safe, actionable text for the operator (never a stack trace, SQL,
        # connection string or raw row values). The technical ``message``
        # stays in the logs; this is what the UI may show per document.
        self.public_message = public_message


class MovSynerPosPermissionError(UpstreamError):
    """Raised when the write login lacks DELETE on the configured table.

    It is an infrastructure/configuration failure (HTTP 503), not a data
    problem: the DBA must grant ``DELETE`` to ``DB_USER`` before the feature
    can be enabled in production.
    """


class SerieSucursalValidationError(DomainError):
    """Raised when data for SerieSucursal fails domain validation."""


class SerieSucursalDuplicateError(DomainError):
    """Raised when a sucursal or seriesynerpos already exists."""


class SerieSucursalNotFoundError(NotFoundError):
    """Raised when a sucursal is not found in SerieSucursal."""

