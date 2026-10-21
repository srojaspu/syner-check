"""Reglas puras de mapeo SynerCom -> dbo.MovSynerPos.

Fuente de verdad: ``docs/posController.js`` (el que corre en producción).
Este módulo no importa pyodbc, requests ni nada de infraestructura: solo
transforma el detalle GraphQL en filas listas para el adaptador.

Fidelidad JS: producción es JavaScript. Los helpers de abajo replican los
operadores que cambian el resultado almacenado (``||``, ``??``, ``toFixed``),
no una interpretación "más limpia" de los mismos.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import math
from typing import Any, Iterable, Sequence

from .errors import MovSynerPosValidationError

SENTINEL = "-"
SUCURSAL = "104"
TIPOS = ("BOLETA", "FACTURA", "NOTA DE CREDITO")
MAX_DOCUMENTOS = 25

# Columnas que producción escribe. ``EnviadoIntelisis`` existe en la tabla pero
# el POS nunca la inserta (verificado 2026-10-20 con SELECT TOP 0 sobre el
# linked server; en producción solo la tiene un 0,4% de filas que sincronizó
# Intelisis). ``fechaRegistro`` la pone el procedimiento del POS con GETDATE(),
# así que el adaptador la escribe igual (ver src/infrastructure/movsynerpos.py).
COLUMNAS: tuple[str, ...] = (
    "IDSynerPos",
    "Sucursal",
    "SerieNumero",
    "TipoDocumento",
    "FechaDocumento",
    "CodigoCliente",
    "email",
    "NombreCliente",
    "CodVendedor",
    "Moneda",
    "CrossTotal",
    "Idx",
    "Sku",
    "Cantidad",
    "CodQR",
    "CrossUnitPrice",
    "CardProvider1",
    "PanMask1",
    "Monto1",
    "CardProvider2",
    "PanMask2",
    "Monto2",
    "CardProvider3",
    "PanMask3",
    "Monto3",
    "CardProvider4",
    "PanMask4",
    "Monto4",
    "PrecioLista",
    "crossDiscount",
    "PorcentajeDescuento",
    "crossPrice",
    "RefNC",
    "promotion",
    "createdDate",
    "vuelto",
    "nota",
)

# Límites declarados en el esquema (D11: fallar, nunca truncar).
MAX_LENGTHS: dict[str, int] = {
    "email": 100,
    "NombreCliente": 100,
    "promotion": 100,
    "nota": 100,
    "PanMask1": 100,
    "PanMask2": 100,
    "PanMask3": 100,
    "PanMask4": 100,
    "CodQR": 150,
    "PorcentajeDescuento": 10,
}

_MONEY = Decimal("0.0001")


# --- Helpers con semántica de JavaScript ---------------------------------


def js_truthy(value: Any) -> bool:
    """Equivalente a la evaluación booleana de JS."""
    if value is None or value is False:
        return False
    if isinstance(value, (int, float)):
        return value != 0 and not (isinstance(value, float) and math.isnan(value))
    if isinstance(value, str):
        return value != ""
    return True


def js_str(value: Any) -> str:
    """String() de JS, para concatenaciones tipo ``txn + ' - ' + pts``."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, float):
        return js_number_str(value)
    return str(value)


def js_number_str(value: Any) -> str:
    """Number.toString() razonable: 12.0 -> '12', 12.5 -> '12.5'."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if not math.isfinite(number):
        return "NaN" if math.isnan(number) else ("Infinity" if number > 0 else "-Infinity")
    if number == int(number):
        return str(int(number))
    return repr(number)


def or_dash(value: Any) -> str:
    """``value || '-'`` de producción (0 y '' también caen al sentinela)."""
    return js_str(value) if js_truthy(value) else SENTINEL


def to_number(value: Any, default: float = 0.0) -> float:
    """Number(value) tolerante: None/no numérico -> ``default``."""
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def to_money(value: Any, default: Decimal | None = None) -> Decimal | None:
    """Money con 4 decimales (escala real de la columna)."""
    if value is None or value == "":
        return default
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return default
    if not number.is_finite():
        return default
    return number.quantize(_MONEY, rounding=ROUND_HALF_UP)


def r_js(value: float, digits: int) -> float:
    """``Number(value.toFixed(digits))``.

    Python y JS redondean sobre el mismo valor binario; ``format`` reproduce
    el resultado de ``toFixed`` para los casos de producción.
    """
    if value is None or not math.isfinite(value):
        raise MovSynerPosValidationError("Valor numérico inválido.")
    return float(format(value, f".{digits}f"))


def require_int(value: Any, field: str) -> int:
    """``Idx``/``Cantidad`` van a ``sql.Int``: entero obligatorio."""
    if value is None or value == "" or isinstance(value, bool):
        raise MovSynerPosValidationError(f"Falta {field} en una línea del documento.")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise MovSynerPosValidationError(
            f"{field} no es un entero en una línea del documento."
        ) from exc
    if not math.isfinite(number) or number != int(number):
        raise MovSynerPosValidationError(
            f"{field} no es un entero en una línea del documento."
        )
    return int(number)


def _parse_iso(value: Any) -> datetime | None:
    """ISO date/datetime -> datetime (conserva el offset si lo trae)."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text in (SENTINEL, "null"):
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        try:
            return datetime.combine(date.fromisoformat(text[:10]), datetime.min.time())
        except ValueError:
            return None


def to_datetime(value: Any) -> datetime | None:
    """ISO date/datetime -> datetime naive; ``None`` si falta o es inválido.

    No convierte de zona: se usa para campos que SynerPOS guarda tal cual
    (``FechaDocumento``, que es fecha sin hora).
    """
    parsed = _parse_iso(value)
    if parsed is None:
        return None
    return parsed.replace(tzinfo=None) if parsed.tzinfo is not None else parsed


def to_utc_datetime(value: Any) -> datetime | None:
    """ISO con offset -> datetime naive **en UTC**.

    SynerCom devuelve ``createdDate`` con offset (-05:00) y el POS lo manda
    crudo a SQL Server, que lo guarda como instante UTC (verificado contra
    producción el 2026-10-21). Convertimos para escribir lo mismo que
    producción; los valores sin offset se toman tal cual.
    """
    parsed = _parse_iso(value)
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        return parsed
    return parsed.astimezone(timezone.utc).replace(tzinfo=None)


def normalize_date_iso(value: Any) -> str:
    """Fecha del request normalizada a YYYY-MM-DD (riesgo: fecha con hora)."""
    text = str(value or "").strip()
    if len(text) >= 10:
        try:
            return date.fromisoformat(text[:10]).isoformat()
        except ValueError:
            pass
    raise MovSynerPosValidationError("Fecha del documento inválida.")


# --- Pagos ---------------------------------------------------------------


@dataclass
class PaymentSlots:
    """(CardProvider, PanMask, Monto) x4 + vuelto, con centinelas de bind."""

    slots: list[tuple[Any, Any, Any]]
    vuelto: Decimal

    def bindings(self) -> dict[str, Any]:
        out: dict[str, Any] = {"vuelto": self.vuelto}
        for index, (provider, pan_mask, monto) in enumerate(self.slots, start=1):
            out[f"CardProvider{index}"] = or_dash(provider)
            out[f"PanMask{index}"] = or_dash(pan_mask)
            out[f"Monto{index}"] = monto
        return out


def _empty_slots(first_monto: Any) -> list[tuple[Any, Any, Any]]:
    return [
        (None, None, first_monto),
        ("", "", Decimal("0.0000")),
        ("", "", Decimal("0.0000")),
        ("", "", Decimal("0.0000")),
    ]


def _abono_provider(message: Any) -> str:
    text = str(message or "").lower()
    if "bcp" in text:
        return "Abono Cta.BCP"
    if "bbva" in text:
        return "Abono Cta.BBVA"
    if "scotia" in text:
        return "Abono Cta.Scotia"
    if "interbank" in text:
        return "Abono Cta.Interbank"
    if "visa" in text:
        return "Visa Soles"
    if "mastercard" in text:
        return "Mastercard Soles"
    if "diners" in text:
        return "Diners Soles"
    if "amex" in text:
        return "AMEX"
    return "Abono Cta.OTRO"


def _fill_first_free(
    slots: list[tuple[Any, Any, Any]], provider: Any, pan_mask: Any, monto: Any
) -> None:
    """Ocupa el primer slot con proveedor falsy; ignora el pago si no hay."""
    for index, slot in enumerate(slots):
        if not js_truthy(slot[0]):
            slots[index] = (provider, pan_mask, monto)
            return


def _pago_bf(payment: dict) -> tuple[Any, Any, Any]:
    provider: Any = None
    pan_mask: Any = None
    monto: Any = Decimal("0.0000")

    if payment.get("pointsPaymentTypeKey") is not None:
        if payment.get("pointsPaymentTypeKey") == "ABONO_CUENTA":
            provider = _abono_provider(payment.get("message"))
        else:
            provider = payment.get("pointsPaymentTypeValue")
        pan_mask = (
            f"{js_str(payment.get('transactionId'))} - "
            f"{js_str(payment.get('pointsAmount'))}"
        )
        monto = to_money(payment.get("amount"), Decimal("0.0000"))
    elif payment.get("type") != "Efectivo - Pago":
        currency = payment.get("currency") or {}
        if (
            payment.get("type") == "Efectivo - Cobranza"
            and currency.get("isoCode") == "USD"
        ):
            provider = payment.get("cardProvider") or (
                f"{js_str(payment.get('type'))} - {js_str(currency.get('isoCode'))}"
            )
        else:
            provider = payment.get("cardProvider") or payment.get("type")
        if payment.get("type") == "Tarjeta - Cobranza":
            pan_mask = payment.get("message") or SENTINEL
        else:
            pan_mask = payment.get("panMask") or SENTINEL
        monto = to_money(payment.get("amount"), Decimal("0.0000"))

    # Override de producción (solo B/F): la NC usada como medio de pago
    # ocupa el PanMask del slot sin reordenar medios.
    if payment.get("creditNote") is not None:
        pan_mask = payment.get("creditNote")
    return provider, pan_mask, monto


def slots_pago_bf(payments: Iterable[dict] | None) -> PaymentSlots:
    """Slots de pago de BOLETA/FACTURA (idénticos en producción)."""
    slots = _empty_slots(None)
    vuelto = Decimal("0.0000")
    for payment in payments or []:
        if not isinstance(payment, dict):
            continue
        if payment.get("type") == "Efectivo - Pago":
            vuelto += to_money(payment.get("amount"), Decimal("0.0000"))
            continue
        provider, pan_mask, monto = _pago_bf(payment)
        _fill_first_free(slots, provider, pan_mask, monto)
    return PaymentSlots(slots, vuelto)


def _pago_nc(payment: dict) -> tuple[Any, Any, Any]:
    provider: Any = None
    pan_mask: Any = SENTINEL
    monto = Decimal("0.0000")

    if payment.get("pointsPaymentTypeKey") is not None:
        if payment.get("pointsPaymentTypeKey") == "ABONO_CUENTA":
            provider = _abono_provider(payment.get("message"))
        else:
            provider = payment.get("pointsPaymentTypeValue") or "Puntos"
        transaction = payment.get("transactionId")
        points = payment.get("pointsAmount")
        pan_mask = (
            f"{js_str(transaction if transaction is not None else SENTINEL)} - "
            f"{js_str(points if points is not None else 0)}"
        )
        monto = to_money(payment.get("amount"), Decimal("0.0000"))
    elif payment.get("type") != "Efectivo - Cobranza":
        currency = payment.get("currency") or {}
        if (
            payment.get("type") == "Efectivo - Pago"
            and currency.get("isoCode") == "USD"
        ):
            provider = payment.get("cardProvider") or (
                f"{js_str(payment.get('type') or 'Pago')} - USD"
            )
        else:
            provider = payment.get("cardProvider") or payment.get("type") or "Pago"
        if payment.get("type") == "Tarjeta - Cobranza":
            pan_mask = payment.get("message") or SENTINEL
        else:
            pan_mask = payment.get("panMask") or SENTINEL
        monto = to_money(payment.get("amount"), Decimal("0.0000"))
    return provider, pan_mask, monto


def slots_pago_nc(
    payments: Sequence[dict] | None, doc_ref: Any, cross_total: Any
) -> PaymentSlots:
    """Slots de NOTA DE CREDITO, con el caso especial ``payments == []``.

    Solo un array vacío dispara "Nota Credito"; ``None`` no (producción
    distingue ambos casos con ``Array.isArray``).
    """
    slots = _empty_slots(Decimal("0.0000"))
    vuelto = Decimal("0.0000")
    for payment in payments or []:
        if not isinstance(payment, dict):
            continue
        if payment.get("type") == "Efectivo - Cobranza":
            vuelto += to_money(payment.get("amount"), Decimal("0.0000"))
            continue
        provider, pan_mask, monto = _pago_nc(payment)
        _fill_first_free(slots, provider, pan_mask, monto)

    if isinstance(payments, (list, tuple)) and len(payments) == 0:
        slots[0] = (
            "Nota Credito",
            doc_ref or SENTINEL,
            to_money(cross_total, Decimal("0.0000")),
        )
    return PaymentSlots(slots, vuelto)


# --- Líneas --------------------------------------------------------------


def _promotion(item: dict) -> tuple[Any, Any]:
    promotion = item.get("promotion")
    if isinstance(promotion, dict):
        return promotion, promotion.get("crossDiscount")
    return None, None


def _base_linea(item: dict) -> dict[str, Any]:
    lote = item.get("lote") if isinstance(item.get("lote"), dict) else {}
    return {
        "Idx": require_int(item.get("idx"), "Idx"),
        "Sku": or_dash(item.get("sku")),
        "CodQR": or_dash(lote.get("sku")),
        "CrossUnitPrice": to_money(item.get("crossUnitPrice"), Decimal("0.0000")),
    }


def linea_boleta(item: dict) -> dict[str, Any]:
    promotion, discount = _promotion(item)
    cross_price = item.get("crossPrice")
    precio_lista = cross_price
    porcentaje: float | None = None
    name = SENTINEL
    if js_truthy(discount):
        precio_lista = to_number(discount) + to_number(cross_price)
        name = (promotion or {}).get("name") or SENTINEL
        if precio_lista:
            porcentaje = r_js(to_number(discount) / precio_lista * 100, 4)

    line = _base_linea(item)
    line.update(
        {
            "Cantidad": require_int(item.get("quantity"), "Cantidad"),
            "PrecioLista": to_money(precio_lista, Decimal("0.0000")),
            "crossDiscount": (
                to_money(discount, Decimal("0.0000")) if js_truthy(discount) else None
            ),
            "PorcentajeDescuento": (
                porcentaje if js_truthy(porcentaje) else None
            ),
            "crossPrice": (
                to_money(cross_price, Decimal("0.0000"))
                if js_truthy(cross_price)
                else None
            ),
            "promotion": name,
        }
    )
    return line


def linea_factura(item: dict) -> dict[str, Any]:
    promotion, discount = _promotion(item)
    cross_price = item.get("crossPrice")
    precio_lista = cross_price
    porcentaje: float | None = None
    name = SENTINEL
    if isinstance(promotion, dict):
        if js_truthy(discount):
            name = promotion.get("name") or SENTINEL
            precio_lista = r_js(
                to_number(discount) + to_number(cross_price), 2
            )
            denominator = to_number(discount) + to_number(cross_price)
            if denominator:
                porcentaje = r_js(to_number(discount) / denominator * 100, 4)
        else:
            precio_lista = cross_price

    line = _base_linea(item)
    line.update(
        {
            "Cantidad": require_int(item.get("quantity"), "Cantidad"),
            "PrecioLista": to_money(precio_lista, Decimal("0.0000")),
            "crossDiscount": (
                to_money(discount, Decimal("0.0000")) if js_truthy(discount) else None
            ),
            # Producción bindea VarChar aquí (no Float).
            "PorcentajeDescuento": (
                js_number_str(porcentaje) if js_truthy(porcentaje) else None
            ),
            "crossPrice": (
                to_money(cross_price, Decimal("0.0000"))
                if js_truthy(cross_price)
                else None
            ),
            "promotion": name,
        }
    )
    return line


def linea_nc(item: dict) -> dict[str, Any]:
    line = _base_linea(item)
    cross_price = item.get("crossPrice")
    line.update(
        {
            "Cantidad": 0
            if item.get("quantity") is None
            else require_int(item.get("quantity"), "Cantidad"),
            "PrecioLista": to_money(cross_price, Decimal("0.0000")),
            "crossDiscount": None,
            "PorcentajeDescuento": None,
            "crossPrice": to_money(cross_price, Decimal("0.0000")),
            "promotion": SENTINEL,
        }
    )
    return line


# --- Documento -----------------------------------------------------------


@dataclass(frozen=True)
class DocumentoMovSynerPos:
    """Filas listas para el adaptador (sin I/O)."""

    tipo: str
    oid: str
    number: str
    fecha: str
    lineas: tuple[dict[str, Any], ...]
    warnings: tuple[str, ...] = ()

    @property
    def total_lineas(self) -> int:
        return len(self.lineas)


def _header(tipo: str, doc: dict) -> dict[str, Any]:
    contact = doc.get("contact") if isinstance(doc.get("contact"), dict) else {}
    currency = doc.get("currency") if isinstance(doc.get("currency"), dict) else {}
    if tipo == "NOTA DE CREDITO":
        return {
            "IDSynerPos": doc.get("oid"),
            "Sucursal": SUCURSAL,
            "SerieNumero": or_dash(doc.get("number")),
            "TipoDocumento": tipo,
            "FechaDocumento": to_datetime(doc.get("date")),
            "CodigoCliente": or_dash(contact.get("idNumber")),
            "email": contact.get("email") or None,
            "NombreCliente": or_dash(contact.get("name")),
            "CodVendedor": "0",
            "Moneda": or_dash(currency.get("isoCode")),
            "CrossTotal": to_money(doc.get("crossTotal"), Decimal("0.0000")),
            "RefNC": or_dash(doc.get("docRef")),
            "createdDate": to_datetime(doc.get("date")),
            "nota": None,
        }
    return {
        "IDSynerPos": or_dash(doc.get("oid")),
        "Sucursal": SUCURSAL,
        "SerieNumero": or_dash(doc.get("number")),
        "TipoDocumento": tipo,
        "FechaDocumento": to_datetime(doc.get("date")),
        "CodigoCliente": or_dash(contact.get("idNumber")),
        "email": contact.get("email") or None,
        "NombreCliente": or_dash(contact.get("name")),
        "CodVendedor": or_dash(doc.get("seller")),
        "Moneda": or_dash(currency.get("isoCode")),
        "CrossTotal": to_money(doc.get("crossTotal"), Decimal("0.0000")),
        "RefNC": SENTINEL,
        "createdDate": to_utc_datetime(doc.get("createdDate")),
        "nota": (doc.get("nota") or None) if tipo == "BOLETA" else None,
    }


def _linea(tipo: str, item: dict) -> dict[str, Any]:
    if tipo == "BOLETA":
        return linea_boleta(item)
    if tipo == "FACTURA":
        return linea_factura(item)
    return linea_nc(item)


def _validar_longitudes(lineas: Sequence[dict[str, Any]]) -> None:
    for line in lineas:
        for column, limit in MAX_LENGTHS.items():
            value = line.get(column)
            if isinstance(value, str) and len(value) > limit:
                raise MovSynerPosValidationError(
                    f"{column} excede {limit} caracteres."
                )


def build_documento(tipo: str, doc: dict) -> DocumentoMovSynerPos:
    """Construye las filas del documento. Sin I/O, sin escribir nada."""
    canonical = str(tipo or "").strip().upper()
    if canonical not in TIPOS:
        raise MovSynerPosValidationError("Tipo de documento no permitido.")
    if not isinstance(doc, dict):
        raise MovSynerPosValidationError("Detalle del documento inválido.")

    oid = str(doc.get("oid") or "").strip()
    if not oid:
        raise MovSynerPosValidationError("El documento no tiene oid.")

    date_iso = normalize_date_iso(doc.get("date"))
    items = doc.get("items")
    if not isinstance(items, list) or not items:
        raise MovSynerPosValidationError("El documento no tiene líneas.")

    warnings: list[str] = []
    header = _header(canonical, doc)
    if header["FechaDocumento"] is None:
        raise MovSynerPosValidationError("El documento no tiene fecha válida.")
    if header["createdDate"] is None:
        warnings.append("createdDate_missing")
    if header["IDSynerPos"] is None:
        raise MovSynerPosValidationError("El documento no tiene oid.")

    if canonical == "NOTA DE CREDITO":
        payments = doc.get("payments")
        slots = slots_pago_nc(payments, doc.get("docRef"), doc.get("crossTotal"))
    else:
        slots = slots_pago_bf(doc.get("payments"))
    header.update(slots.bindings())

    lineas: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            raise MovSynerPosValidationError("Línea de detalle inválida.")
        line = dict(header)
        line.update(_linea(canonical, item))
        lineas.append({column: line.get(column) for column in COLUMNAS})

    _validar_longitudes(lineas)
    return DocumentoMovSynerPos(
        tipo=canonical,
        oid=oid,
        number=str(doc.get("number") or ""),
        fecha=date_iso,
        lineas=tuple(lineas),
        warnings=tuple(warnings),
    )
