"""Domain entities and value objects. Stdlib only."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum

from .errors import InvalidDocumentTypeError, InvalidRangeError


class TipoDocumento(Enum):
    FACTURA = "FACTURA"
    BOLETA = "BOLETA"
    NOTA_DE_CREDITO = "NOTA DE CREDITO"

    @classmethod
    def parse(cls, raw: str) -> "TipoDocumento":
        normalized = (raw or "").strip().upper()
        for member in cls:
            if member.value == normalized:
                return member
        raise InvalidDocumentTypeError(f"Unknown document type: {raw!r}.")

    @classmethod
    def parse_many(cls, raw: str) -> list["TipoDocumento"]:
        wanted = [x.strip().upper() for x in (raw or "").split(",") if x.strip()]
        if not wanted:
            raise InvalidDocumentTypeError("Select at least one document type.")
        seen: list["TipoDocumento"] = []
        for item in wanted:
            parsed = cls.parse(item)
            if parsed not in seen:
                seen.append(parsed)
        return seen


@dataclass(frozen=True)
class FechaRango:
    start: date
    end: date

    def __post_init__(self) -> None:
        if self.end < self.start:
            raise InvalidRangeError("End date must be on or after start date.")

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def within(self, max_days: int) -> "FechaRango":
        if self.days > max_days:
            raise InvalidRangeError(f"Range exceeds {max_days} days.")
        return self

    @classmethod
    def from_iso(cls, start_iso: str, end_iso: str, max_days: int) -> "FechaRango":
        try:
            start = date.fromisoformat((start_iso or "").strip())
            end = date.fromisoformat((end_iso or "").strip())
        except ValueError as exc:
            raise InvalidRangeError("Invalid dates.") from exc
        return cls(start=start, end=end).within(max_days)


@dataclass(frozen=True)
class Document:
    oid: str
    number: str
    tipo: TipoDocumento
    doc_date: date
    in_sql: bool = False
    payload: dict = field(default_factory=dict)

    def identity(self) -> tuple[str, str, str]:
        return (self.tipo.value, self.oid.strip().upper(), self.doc_date.isoformat())
