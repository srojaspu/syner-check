"""Contrato HTTP de la pantalla Terminales (fuente y caché reemplazadas)."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.main import app
from src.application.pos_logs_cache import TTLCache
from src.domain.errors import UpstreamError
from src.domain.pos_logs import EventLevel, PosLogEvent, PosValue
from src.interfaces import pos_logs_wiring as wiring

client = TestClient(app)

DESDE = "2026-11-24T00:00:00-05:00"
HASTA = "2026-11-25T00:00:00-05:00"
EVENT_AT = "2026-11-24T14:00:00-05:00"


def _event(
    oid: str = "80957.1",
    *,
    level: EventLevel = EventLevel.WARN,
    key: str = "SALE_GATEWAY_REGISTER_FAILED",
    instance: str = "La Rambla",
    serial: str | None = "S1",
    with_value: bool = True,
) -> PosLogEvent:
    value = (
        PosValue(
            version="3.2.3",
            serial=serial,
            order_number="03902",
            amount=Decimal("53.47"),
            currency="PEN",
            elapsed_ms=1200,
            doc_type="RECEIPT",
            gateway="IZIPAY",
        )
        if with_value
        else None
    )
    return PosLogEvent(
        oid=oid,
        at=datetime.fromisoformat(EVENT_AT),
        level=level,
        key=key,
        instance=instance,
        message="Register failed. Order 03902, PEN 53.47.",
        value=value,
    )


class FakeSource:
    def __init__(self, events: list[PosLogEvent] | None = None, error=None) -> None:
        self.events = events or []
        self.error = error
        self.calls: list[tuple] = []

    def fetch(self, window, *, key=None, message=None):
        self.calls.append((window, key, message))
        if self.error is not None:
            raise self.error
        return list(self.events)


def _patch(monkeypatch, source: FakeSource) -> TTLCache:
    cache = TTLCache(max_entries=8, max_bytes=10_000_000)
    monkeypatch.setattr(wiring, "_deps", lambda: (source, cache))
    return cache


@pytest.fixture()
def sesion():
    response = client.get("/auth/login", follow_redirects=False)
    assert response.status_code == 303
    return client


def test_analisis_exige_sesion() -> None:
    anonimo = TestClient(app)
    response = anonimo.get(
        "/api/pos/analisis", params={"desde": DESDE, "hasta": HASTA}
    )
    assert response.status_code == 401


def test_analisis_shape_y_cache(sesion, monkeypatch) -> None:
    source = FakeSource([_event()])
    _patch(monkeypatch, source)

    response = sesion.get(
        "/api/pos/analisis",
        params={"desde": DESDE, "hasta": HASTA, "page": 1, "limit": 50},
    )
    assert response.status_code == 200
    body = response.json()

    assert set(body) >= {"ventana", "fuente", "kpis", "series", "eventos"}
    assert "terminales" not in body
    assert "fallas" not in body
    assert body["fuente"]["cache"] == "miss"
    assert body["ventana"]["tz"] == "America/Lima"
    assert body["kpis"]["ultimoEvento"] == EVENT_AT
    assert body["eventos"]["total"] == 1
    item = body["eventos"]["items"][0]
    assert item["pedido"] == "03902"
    assert "valor" not in item  # el listado no expone el detalle técnico
    assert "logs" in body
    assert len(body["logs"]) == 1
    assert body["logs"][0]["oid"] == "80957.1"
    assert body["logs"][0]["clave"] == "SALE_GATEWAY_REGISTER_FAILED"
    assert '"orderNumber":"03902"' in (body["logs"][0]["value"] or "")
    assert "authorization" not in (body["logs"][0]["value"] or "")
    assert "gatewayTrace" not in (body["logs"][0]["value"] or "")

    second = sesion.get(
        "/api/pos/analisis",
        params={"desde": DESDE, "hasta": HASTA, "page": 1, "limit": 50},
    )
    assert second.status_code == 200
    assert second.json()["fuente"]["cache"] == "hit"
    assert len(source.calls) == 1


def test_filtros_no_consultan_el_endpoint(sesion, monkeypatch) -> None:
    source = FakeSource([_event(), _event(oid="2", level=EventLevel.ERROR)])
    _patch(monkeypatch, source)

    first = sesion.get(
        "/api/pos/analisis",
        params={"desde": DESDE, "hasta": HASTA, "nivel": "ERROR"},
    )
    second = sesion.get(
        "/api/pos/analisis",
        params={"desde": DESDE, "hasta": HASTA, "clave": "NO_EXISTE"},
    )
    assert first.json()["eventos"]["total"] == 1
    assert second.json()["eventos"]["total"] == 0
    assert len(source.calls) == 1


def test_ventana_larga_marca_kpis_parciales(sesion, monkeypatch) -> None:
    source = FakeSource([_event()])
    _patch(monkeypatch, source)

    response = sesion.get(
        "/api/pos/analisis",
        params={
            "desde": "2026-10-25T00:00:00-05:00",
            "hasta": "2026-11-25T00:00:00-05:00",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["fuente"]["parcial"] is True


def test_filtro_serial_filtra_eventos(sesion, monkeypatch) -> None:
    source = FakeSource(
        [
            _event(oid="1", serial="S1"),
            _event(oid="2", serial="S2"),
        ]
    )
    _patch(monkeypatch, source)

    response = sesion.get(
        "/api/pos/analisis",
        params={"desde": DESDE, "hasta": HASTA, "serial": "S1"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["eventos"]["total"] == 1
    assert body["eventos"]["items"][0]["serial"] == "S1"


def test_rango_invalido_400(sesion) -> None:
    response = sesion.get(
        "/api/pos/analisis",
        params={"desde": "2026-10-01T00:00:00-05:00", "hasta": HASTA},
    )
    assert response.status_code == 400


def test_nivel_invalido_400(sesion) -> None:
    response = sesion.get(
        "/api/pos/analisis",
        params={"desde": DESDE, "hasta": HASTA, "nivel": "DEBUG"},
    )
    assert response.status_code == 400


def test_upstream_502(sesion, monkeypatch) -> None:
    error = UpstreamError(
        "fallo", code="upstream", public_message="No disponible."
    )
    _patch(monkeypatch, FakeSource(error=error))

    response = sesion.get(
        "/api/pos/analisis", params={"desde": DESDE, "hasta": HASTA}
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "No disponible."


def test_upstream_ocupado_503(sesion, monkeypatch) -> None:
    error = UpstreamError("ocupado", code="busy", public_message="Reintenta.")
    _patch(monkeypatch, FakeSource(error=error))

    response = sesion.get(
        "/api/pos/analisis", params={"desde": DESDE, "hasta": HASTA}
    )
    assert response.status_code == 503
    assert response.headers["retry-after"] == "5"


def test_evento_200(sesion, monkeypatch) -> None:
    source = FakeSource([_event()])
    _patch(monkeypatch, source)

    response = sesion.get(
        "/api/pos/evento",
        params={
            "oid": "80957.1",
            "at": EVENT_AT,
            "desde": DESDE,
            "hasta": HASTA,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["evento"]["oid"] == "80957.1"
    assert body["evento"]["valor"]["importe"] == "53.47"
    assert body["evento"]["valor"]["pasarela"] == "IZIPAY"


def test_evento_404(sesion, monkeypatch) -> None:
    _patch(monkeypatch, FakeSource([_event()]))

    response = sesion.get(
        "/api/pos/evento",
        params={
            "oid": "NO-EXISTE",
            "at": EVENT_AT,
            "desde": DESDE,
            "hasta": HASTA,
        },
    )
    assert response.status_code == 404


def test_evento_fecha_invalida_400(sesion, monkeypatch) -> None:
    _patch(monkeypatch, FakeSource([_event()]))

    response = sesion.get(
        "/api/pos/evento",
        params={
            "oid": "80957.1",
            "at": "2026-11-24T14:00:00",
            "desde": DESDE,
            "hasta": HASTA,
        },
    )
    assert response.status_code == 400



