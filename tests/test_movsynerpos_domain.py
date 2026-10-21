"""Dominio puro de MovSynerPos: reglas copiadas de docs/posController.js."""

from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import pytest

from src.domain.errors import MovSynerPosValidationError
from src.domain.movsynerpos import (
    COLUMNAS,
    SENTINEL,
    build_documento,
    js_number_str,
    js_truthy,
    linea_boleta,
    linea_factura,
    linea_nc,
    normalize_date_iso,
    or_dash,
    r_js,
    require_int,
    slots_pago_bf,
    slots_pago_nc,
    to_datetime,
    to_money,
)

FIXTURES = Path(__file__).parent / "fixtures" / "movsynerpos"


def load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


# --- F1.1 helpers ---------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "digits", "expected"),
    [
        (2.34565, 4, 2.3457),
        (1.005, 2, 1.0),
        (0, 4, 0.0),
        (-2.34565, 4, -2.3457),
    ],
)
def test_r_js_matches_to_fixed(value, digits, expected):
    assert r_js(value, digits) == expected


def test_js_truthy_distinguishes_zero_and_none():
    assert js_truthy(0) is False
    assert js_truthy(None) is False
    assert js_truthy("") is False
    assert js_truthy("0") is True
    assert js_truthy(0.5) is True


def test_or_dash_uses_js_or_semantics():
    assert or_dash(None) == "-"
    assert or_dash("") == "-"
    assert or_dash(0) == "-"
    assert or_dash("B004-1") == "B004-1"


def test_js_number_str_drops_trailing_zero_for_integers():
    assert js_number_str(12.0) == "12"
    assert js_number_str(12.5) == "12.5"
    assert js_number_str(0.2481) == "0.2481"


def test_to_money_quantizes_to_four_places():
    assert to_money("10.55555") == Decimal("10.5556")
    assert to_money(None) is None


def test_require_int_rejects_missing_and_fractional():
    assert require_int(3, "Idx") == 3
    with pytest.raises(MovSynerPosValidationError):
        require_int(None, "Idx")
    with pytest.raises(MovSynerPosValidationError):
        require_int(1.5, "Cantidad")


def test_to_datetime_normalizes_z_and_plain_dates():
    assert to_datetime("2026-10-20") == datetime(2026, 10, 20)
    assert to_datetime("2026-10-20T10:15:00Z") == datetime(2026, 10, 20, 10, 15)
    assert to_datetime("-") is None


def test_normalize_date_iso_trims_time_component():
    assert normalize_date_iso("2026-10-20T10:15:00Z") == "2026-10-20"
    with pytest.raises(MovSynerPosValidationError):
        normalize_date_iso("no-es-fecha")


# --- F1.2 slots B/F -------------------------------------------------------


def test_slots_bf_multipago_credit_note_and_points():
    slots = slots_pago_bf(load("boleta.json")["payments"])

    assert slots.vuelto == Decimal("10.0000")
    assert slots.bindings()["CardProvider1"] == "VISA"
    assert slots.bindings()["PanMask1"] == "B004-00000999"
    assert slots.bindings()["Monto1"] == Decimal("60.0000")
    assert slots.bindings()["CardProvider2"] == "Abono Cta.BCP"
    assert slots.bindings()["PanMask2"] == "TX-001 - 500"
    assert slots.bindings()["Monto2"] == Decimal("30.5000")
    assert slots.bindings()["CardProvider3"] == "-"
    assert slots.bindings()["Monto3"] == Decimal("0.0000")


def test_slots_bf_usd_cobranza_gets_currency_suffix():
    slots = slots_pago_bf(load("factura.json")["payments"])
    assert slots.bindings()["CardProvider1"] == "Efectivo - Cobranza - USD"
    assert slots.bindings()["PanMask1"] == "-"


def test_slots_bf_ignores_payments_beyond_four():
    payments = [
        {"type": "Tarjeta", "cardProvider": f"P{i}", "amount": i} for i in range(1, 6)
    ]
    slots = slots_pago_bf(payments)
    assert [slot[0] for slot in slots.slots] == ["P1", "P2", "P3", "P4"]


def test_slots_bf_null_payments_returns_empty_slots():
    slots = slots_pago_bf(None)
    assert slots.bindings()["CardProvider1"] == "-"
    assert slots.bindings()["PanMask1"] == "-"
    assert slots.bindings()["Monto1"] is None


# --- F1.3 slots NC --------------------------------------------------------


def test_slots_nc_empty_payments_uses_credit_note_case():
    slots = slots_pago_nc([], "B004-00001234", 45)
    assert slots.bindings()["CardProvider1"] == "Nota Credito"
    assert slots.bindings()["PanMask1"] == "B004-00001234"
    assert slots.bindings()["Monto1"] == Decimal("45.0000")


def test_slots_nc_null_payments_does_not_trigger_special_case():
    slots = slots_pago_nc(None, "B004-00001234", 45)
    assert slots.bindings()["CardProvider1"] == "-"
    assert slots.bindings()["Monto1"] == Decimal("0.0000")


def test_slots_nc_cobranza_adds_vuelto_and_tarjeta_uses_message():
    payments = [
        {"type": "Efectivo - Cobranza", "amount": 5},
        {
            "type": "Tarjeta - Cobranza",
            "message": "MSG-NC",
            "panMask": "IGNORADO",
            "amount": 10,
        },
    ]
    slots = slots_pago_nc(payments, "-", 10)
    assert slots.vuelto == Decimal("5.0000")
    assert slots.bindings()["PanMask1"] == "MSG-NC"
    assert slots.bindings()["Monto1"] == Decimal("10.0000")


# --- F1.4 líneas ----------------------------------------------------------


def test_linea_boleta_discount_is_not_rounded_price():
    line = linea_boleta(load("boleta.json")["items"][0])
    assert line["PrecioLista"] == Decimal("20.0000")
    assert line["crossDiscount"] == Decimal("5.5000")
    assert line["PorcentajeDescuento"] == 27.5
    assert line["promotion"] == "PROMO PRUEBA"
    assert line["CodQR"] == "LOTE-001"


def test_linea_boleta_without_promotion_uses_sentinels():
    line = linea_boleta(load("boleta.json")["items"][1])
    assert line["PrecioLista"] == Decimal("90.0000")
    assert line["crossDiscount"] is None
    assert line["PorcentajeDescuento"] is None
    assert line["promotion"] == SENTINEL


def test_linea_factura_rounds_price_to_two_and_pct_is_varchar():
    line = linea_factura(load("factura.json")["items"][0])
    assert line["PrecioLista"] == Decimal("60.4500")
    assert line["PorcentajeDescuento"] == "0.2481"


def test_linea_nc_uses_money_for_percentage_and_zero_defaults():
    line = linea_nc({"idx": 1, "sku": "SKU-1", "crossPrice": None})
    assert line["Cantidad"] == 0
    assert line["PrecioLista"] == Decimal("0.0000")
    assert line["PorcentajeDescuento"] is None
    assert line["promotion"] == SENTINEL
    assert line["Sku"] == "SKU-1"


# --- F1.5 documento -------------------------------------------------------


def test_build_boleta_has_all_columns_and_header():
    doc = build_documento("BOLETA", load("boleta.json"))
    assert doc.tipo == "BOLETA"
    assert doc.oid == "boleta-sintetica-001"
    assert doc.total_lineas == 2
    for line in doc.lineas:
        assert tuple(line.keys()) == COLUMNAS
    first = doc.lineas[0]
    assert first["Sucursal"] == "104"
    assert first["SerieNumero"] == "B004-00001234"
    assert first["Moneda"] == "PEN"
    assert first["RefNC"] == "-"
    assert first["nota"] is None
    assert first["vuelto"] == Decimal("10.0000")


def test_build_factura_forces_nota_null():
    doc = build_documento("FACTURA", load("factura.json"))
    assert doc.lineas[0]["nota"] is None
    assert doc.lineas[0]["TipoDocumento"] == "FACTURA"
    assert doc.lineas[0]["createdDate"] == datetime(2026, 10, 20, 11, 30)


def test_build_nc_uses_document_date_and_zero_seller():
    doc = build_documento("NOTA DE CREDITO", load("nota_credito.json"))
    line = doc.lineas[0]
    assert line["CodVendedor"] == "0"
    assert line["RefNC"] == "B004-00001234"
    assert line["createdDate"] == datetime(2026, 10, 20)
    assert line["CardProvider1"] == "Nota Credito"


def test_build_rejects_document_without_items():
    doc = load("boleta.json")
    doc["items"] = []
    with pytest.raises(MovSynerPosValidationError):
        build_documento("BOLETA", doc)


def test_build_rejects_missing_quantity():
    doc = load("boleta.json")
    doc["items"][0].pop("quantity")
    with pytest.raises(MovSynerPosValidationError):
        build_documento("BOLETA", doc)


# --- F1.6 longitudes ------------------------------------------------------


@pytest.mark.parametrize(
    ("field", "size", "column"),
    [
        ("NombreCliente", 100, "NombreCliente"),
        ("NombreCliente", 101, "NombreCliente"),
        ("CodQR", 150, "CodQR"),
        ("CodQR", 151, "CodQR"),
    ],
)
def test_length_boundaries(field, size, column):
    doc = load("boleta.json")
    if field == "NombreCliente":
        doc["contact"]["name"] = "X" * size
        expected_limit = 100
    else:
        doc["items"][0]["lote"]["sku"] = "X" * size
        expected_limit = 150

    if size > expected_limit:
        with pytest.raises(MovSynerPosValidationError) as excinfo:
            build_documento("BOLETA", doc)
        assert column in str(excinfo.value)
    else:
        assert build_documento("BOLETA", doc).lineas[0][column] == "X" * size


def test_pan_mask_over_100_is_rejected():
    doc = load("boleta.json")
    doc["payments"][1]["creditNote"] = "X" * 101
    with pytest.raises(MovSynerPosValidationError):
        build_documento("BOLETA", doc)


def test_domain_module_has_no_infrastructure_imports():
    source = (
        Path(__file__).parents[1] / "src" / "domain" / "movsynerpos.py"
    ).read_text(encoding="utf-8")
    imports = [
        line.strip()
        for line in source.splitlines()
        if line.strip().startswith(("import ", "from "))
    ]
    forbidden = ("pyodbc", "requests", "fastapi", "app.", "src.infrastructure")
    assert not [line for line in imports if any(word in line for word in forbidden)]
