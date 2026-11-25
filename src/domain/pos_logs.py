"""Modelo de dominio del monitoreo de terminales POS (eventos de SynerCOM).

Capa pura: sin I/O, sin framework, sin base de datos. Todo lo que hay aquí se
puede probar con datos en memoria.

El evento (`PosLogEvent`) es la unidad de telemetría; el terminal es una
proyección derivada de `(instance, serial)`. El parseo de `value` es defensivo:
una fila con JSON corrupto pierde su detalle, nunca tumba el lote completo.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any, Mapping, Sequence

from src.domain.errors import InvalidPosLogError, InvalidRangeError

# Zona horaria operativa de Perú (sin DST). Las fechas del API siempre llegan
# con offset; se normalizan aquí para que los buckets y las comparaciones sean
# consistentes.
LIMA_TZ = timezone(timedelta(hours=-5))

MAX_WINDOW_DAYS = 31
# El detalle técnico (`value`) solo se descarga para ventanas cortas: en 30
# días el payload completo ronda varios MB y no aporta a los agregados.
VALUE_WINDOW_DAYS = 7

MAX_VALUE_BYTES = 64 * 1024
MAX_VALUE_DEPTH = 3
MAX_MESSAGE_CHARS = 600
MAX_KEY_CHARS = 80
MAX_INSTANCE_CHARS = 120
MAX_OID_CHARS = 40
MAX_SERIAL_CHARS = 40
MAX_VERSION_CHARS = 20
MAX_CURRENCY_CHARS = 8
MAX_GATEWAY_CHARS = 20
MAX_DOC_TYPE_CHARS = 20
MAX_ORDER_CHARS = 12
MAX_ELAPSED_MS = 24 * 60 * 60 * 1000

_ORDER_RE = re.compile(r"^\d{1,12}$")
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# El API documenta `docType`, pero los eventos reales de emisión solo traen
# `documentNumber` (BS02-…, FA01-…). Se deriva el tipo del prefijo cuando falta.
_DOC_TYPE_BY_PREFIX = {
    "BS": "RECEIPT",
    "FA": "INVOICE",
    "NC": "CREDITNOTE",
    "TK": "TICKET",
}


class EventLevel(str, Enum):
    """Nivel del evento. `UNKNOWN` evita romper ante un valor nuevo del API."""

    INFO = "INFO"
    WARN = "WARN"
    ERROR = "ERROR"
    UNKNOWN = "UNKNOWN"


class TerminalHealth(str, Enum):
    """Salud categórica y explicable (sin scores inventados)."""

    OK = "OK"
    DEGRADED = "DEGRADED"
    CRITICAL = "CRITICAL"
    NO_DATA = "NO_DATA"


_LEVEL_ALIASES = {
    "INFO": EventLevel.INFO,
    "INFORMATION": EventLevel.INFO,
    "WARN": EventLevel.WARN,
    "WARNING": EventLevel.WARN,
    "ERROR": EventLevel.ERROR,
    "ERR": EventLevel.ERROR,
}


def safe_text(raw: Any, limit: int) -> str:
    """Normaliza texto de terceros: sin controles, sin saltos, acotado.

    `key`, `instance` y `message` vienen de la app del POS: se tratan como
    contenido no confiable. El límite evita filas gigantes y abusos.
    """
    text = "" if raw is None else str(raw)
    text = _CONTROL_RE.sub(" ", text)
    text = " ".join(text.split())
    return text[:limit]


def parse_level(raw: Any) -> EventLevel:
    """Convierte ``"[WARN]"`` en ``WARN``; lo desconocido cae en ``UNKNOWN``."""
    text = safe_text(raw, 20).upper()
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1].strip()
    return _LEVEL_ALIASES.get(text, EventLevel.UNKNOWN)


def parse_datetime(raw: Any) -> datetime | None:
    """ISO 8601 con offset obligatorio, normalizado a hora de Perú.

    Una fecha sin zona horaria es un error de contrato (el API la rechaza
    igual), así que aquí se descarta en vez de asumir una zona.
    """
    if isinstance(raw, datetime):
        value = raw
    elif isinstance(raw, str) and raw.strip():
        text = raw.strip().replace("Z", "+00:00")
        try:
            value = datetime.fromisoformat(text)
        except ValueError:
            return None
    else:
        return None
    if value.tzinfo is None:
        return None
    return value.astimezone(LIMA_TZ)


def _to_decimal(raw: Any) -> Decimal | None:
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    try:
        value = Decimal(str(raw).strip())
    except (InvalidOperation, ValueError):
        return None
    if not value.is_finite() or value < 0:
        return None
    return value


def _to_int(raw: Any, maximum: int) -> int | None:
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return None
    if value < 0 or value > maximum:
        return None
    return value


def _json_depth(value: Any, current: int = 0) -> int:
    """Profundidad de contenedores (los escalares no suman nivel).

    ``value`` real es plano (strings, números); el límite protege contra JSON
    anidado malicioso o corrupto sin rechazar payloads normales.
    """
    if isinstance(value, (Mapping, list, tuple)):
        base = current + 1
        if base > MAX_VALUE_DEPTH:
            return base
        items = value.values() if isinstance(value, Mapping) else value
        depth = base
        for item in items:
            depth = max(depth, _json_depth(item, base))
        return depth
    return current


@dataclass(frozen=True, slots=True)
class PosValue:
    """Datos de `value` ya normalizados.

    `raw` conserva el objeto original para la vista técnica; no se expone por
    defecto porque puede incluir códigos de autorización y el trace completo
    de la pasarela.
    """

    version: str | None = None
    serial: str | None = None
    order_number: str | None = None
    amount: Decimal | None = None
    currency: str | None = None
    elapsed_ms: int | None = None
    doc_type: str | None = None
    document_number: str | None = None
    gateway: str | None = None
    authorization: str | None = None
    masked_pan: str | None = None
    merchant_id: str | None = None
    raw: Mapping[str, Any] | None = field(default=None, repr=False, compare=False)

    def public_dict(self) -> dict[str, Any]:
        """Vista segura para listados y export: sin datos técnicos sensibles."""
        return {
            "version": self.version,
            "serial": self.serial,
            "order_number": self.order_number,
            "amount": format(self.amount, "f") if self.amount is not None else None,
            "currency": self.currency,
            "elapsed_ms": self.elapsed_ms,
            "doc_type": self.doc_type,
            "document_number": self.document_number,
            "gateway": self.gateway,
            "masked_pan": self.masked_pan,
        }


def parse_value(raw: Any) -> PosValue | None:
    """Parsea `value` de forma defensiva.

    Acepta el string JSON que devuelve el API o un ``dict`` ya cargado. Ante
    cualquier anomalía (vacío, inválido, demasiado grande o demasiado
    profundo) devuelve ``None``: el evento conserva `message` y sigue siendo
    útil para diagnóstico.
    """
    if raw is None:
        return None
    if isinstance(raw, str):
        text = raw.strip()
        if not text or text == "{}":
            return None
        if len(text) > MAX_VALUE_BYTES:
            return None
        try:
            data = json.loads(text)
        except (ValueError, RecursionError):
            return None
    elif isinstance(raw, Mapping):
        data = dict(raw)
    else:
        return None
    if not isinstance(data, dict) or not data:
        return None
    if _json_depth(data) > MAX_VALUE_DEPTH:
        return None

    order_number = safe_text(data.get("orderNumber"), MAX_ORDER_CHARS + 1) or None
    if order_number is not None and not _ORDER_RE.match(order_number):
        order_number = None

    document_number = safe_text(data.get("documentNumber"), 40) or None
    doc_type = safe_text(data.get("docType"), MAX_DOC_TYPE_CHARS) or None
    if doc_type is None and document_number:
        doc_type = _DOC_TYPE_BY_PREFIX.get(document_number[:2].upper())

    return PosValue(
        version=safe_text(data.get("version"), MAX_VERSION_CHARS) or None,
        serial=safe_text(data.get("serial"), MAX_SERIAL_CHARS) or None,
        order_number=order_number,
        amount=_to_decimal(data.get("amount")),
        currency=safe_text(data.get("currency"), MAX_CURRENCY_CHARS) or None,
        elapsed_ms=_to_int(data.get("elapsedMs"), MAX_ELAPSED_MS),
        doc_type=doc_type,
        document_number=document_number,
        gateway=safe_text(data.get("gateway"), MAX_GATEWAY_CHARS) or None,
        authorization=safe_text(data.get("authorization"), 40) or None,
        masked_pan=safe_text(data.get("maskedPan"), 40) or None,
        merchant_id=safe_text(data.get("merchantId"), 40) or None,
        raw=data,
    )


@dataclass(frozen=True, slots=True)
class TerminalRef:
    """Identidad de terminal: la instancia (NUC) y el serial cuando se conoce.

    El serial solo aparece después de la primera venta con tarjeta de la
    sesión, así que puede ser ``None``. En ese caso el terminal se agrupa por
    instancia y la UI lo marca como «sin serial».
    """

    instance: str
    serial: str | None = None

    @property
    def has_serial(self) -> bool:
        return bool(self.serial)


@dataclass(frozen=True, slots=True)
class PosLogEvent:
    """Un registro de evento del POS, ya normalizado."""

    oid: str
    at: datetime
    level: EventLevel
    key: str
    instance: str
    message: str
    value: PosValue | None = None

    @property
    def terminal(self) -> TerminalRef:
        return TerminalRef(
            instance=self.instance,
            serial=self.value.serial if self.value is not None else None,
        )

    @property
    def is_failure(self) -> bool:
        return self.level in (EventLevel.WARN, EventLevel.ERROR)

    def public_dict(self) -> dict[str, Any]:
        return {
            "oid": self.oid,
            "at": self.at.isoformat(),
            "level": self.level.value,
            "key": self.key,
            "instance": self.instance,
            "message": self.message,
            "terminal": {
                "instance": self.instance,
                "serial": self.terminal.serial,
            },
            "value": self.value.public_dict() if self.value is not None else None,
        }


def parse_event(raw: Mapping[str, Any] | None) -> PosLogEvent:
    """Construye un ``PosLogEvent`` a partir de una fila cruda del API.

    Solo falla cuando falta la identidad mínima (``oid``) o la fecha no es
    utilizable. Todo lo demás degrada: nivel desconocido, `value` corrupto,
    textos largos.
    """
    if not isinstance(raw, Mapping):
        raise InvalidPosLogError("El registro del log no es un objeto.")
    oid = safe_text(raw.get("oid"), MAX_OID_CHARS)
    if not oid:
        raise InvalidPosLogError("El registro del log no tiene oid.")
    at = parse_datetime(raw.get("logdatetime"))
    if at is None:
        raise InvalidPosLogError("El registro del log no tiene una fecha válida.")

    return PosLogEvent(
        oid=oid,
        at=at,
        level=parse_level(raw.get("level")),
        key=safe_text(raw.get("key"), MAX_KEY_CHARS) or "SIN_CLAVE",
        instance=safe_text(raw.get("instance"), MAX_INSTANCE_CHARS)
        or "SIN_INSTANCIA",
        message=safe_text(raw.get("message"), MAX_MESSAGE_CHARS),
        value=parse_value(raw.get("value")),
    )


@dataclass(frozen=True, slots=True)
class TimeWindow:
    """Ventana de consulta: inicio inclusivo, fin exclusivo, hora de Perú."""

    start: datetime
    end: datetime

    def __post_init__(self) -> None:
        if self.start.tzinfo is None or self.end.tzinfo is None:
            raise InvalidRangeError("La ventana debe incluir zona horaria.")
        if self.end <= self.start:
            raise InvalidRangeError("El fin de la ventana debe ser posterior al inicio.")
        if self.duration > timedelta(days=MAX_WINDOW_DAYS):
            raise InvalidRangeError(
                f"La ventana no puede superar {MAX_WINDOW_DAYS} días."
            )

    @classmethod
    def parse(cls, start_raw: Any, end_raw: Any) -> "TimeWindow":
        start = parse_datetime(start_raw)
        end = parse_datetime(end_raw)
        if start is None or end is None:
            raise InvalidRangeError(
                "Las fechas deben ser ISO 8601 con zona horaria."
            )
        return cls(start=start, end=end)

    @classmethod
    def last_days(cls, days: int, now: datetime | None = None) -> "TimeWindow":
        """Ventana de ``days`` días que termina ahora (útil para presets)."""
        if days < 1:
            raise InvalidRangeError("La ventana debe ser de al menos un día.")
        end = (now or datetime.now(LIMA_TZ)).astimezone(LIMA_TZ)
        return cls(start=end - timedelta(days=days), end=end)

    @property
    def duration(self) -> timedelta:
        return self.end - self.start

    @property
    def days(self) -> float:
        return self.duration.total_seconds() / 86400

    @property
    def includes_value(self) -> bool:
        """El detalle técnico solo tiene sentido en ventanas cortas."""
        return self.days <= VALUE_WINDOW_DAYS

    def contains(self, moment: datetime) -> bool:
        return self.start <= moment < self.end


@dataclass(frozen=True, slots=True)
class FaultGroup:
    """Fallas agrupadas por clave e instancia: la vista de diagnóstico."""

    key: str
    instance: str
    level: EventLevel
    count: int
    first_at: datetime
    last_at: datetime
    sample_oid: str


def group_faults(events: Sequence[PosLogEvent]) -> list[FaultGroup]:
    """Agrupa WARN/ERROR por ``(key, instance)``, de más a menos frecuente.

    La muestra es el evento más reciente del grupo (el que el operador quiere
    abrir para ver el `value` actual). Los INFO se ignoran.
    """
    buckets: dict[tuple[str, str], list[PosLogEvent]] = {}
    for event in events:
        if not event.is_failure:
            continue
        buckets.setdefault((event.key, event.instance), []).append(event)

    groups: list[FaultGroup] = []
    for (key, instance), items in buckets.items():
        ordered = sorted(items, key=lambda item: item.at)
        newest = ordered[-1]
        groups.append(
            FaultGroup(
                key=key,
                instance=instance,
                level=(
                    EventLevel.ERROR
                    if any(item.level is EventLevel.ERROR for item in items)
                    else EventLevel.WARN
                ),
                count=len(items),
                first_at=ordered[0].at,
                last_at=newest.at,
                sample_oid=newest.oid,
            )
        )
    groups.sort(key=lambda group: (-group.count, group.key, group.instance))
    return groups


def terminal_health(events: Sequence[PosLogEvent]) -> TerminalHealth:
    """Salud del terminal en la ventana: CRITICAL > DEGRADED > OK > NO_DATA."""
    if not events:
        return TerminalHealth.NO_DATA
    if any(event.level is EventLevel.ERROR for event in events):
        return TerminalHealth.CRITICAL
    if any(event.level is EventLevel.WARN for event in events):
        return TerminalHealth.DEGRADED
    return TerminalHealth.OK


def bucket_floor(moment: datetime, granularity: str) -> datetime:
    """Redondea hacia abajo a hora o día, en hora de Perú."""
    local = moment.astimezone(LIMA_TZ)
    if granularity == "day":
        return local.replace(hour=0, minute=0, second=0, microsecond=0)
    if granularity == "hour":
        return local.replace(minute=0, second=0, microsecond=0)
    raise ValueError("Granularidad inválida: usa 'hour' o 'day'.")


def bucket_granularity(window: TimeWindow) -> str:
    """Horaria hasta 72 h; diaria para ventanas más largas."""
    return "hour" if window.duration <= timedelta(hours=72) else "day"
