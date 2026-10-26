"""Contrato HTTP de la pantalla Intelisis UFE.

No toca Intelisis: el lector se reemplaza por un doble. Lo que se verifica es
la semantica de la API (401 sin sesion, 400 con filtros o periodo invalidos,
404 con un documento que no existe).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from src.interfaces import wiring

client = TestClient(app)


class _ReaderVacio:
    def fetch_rows(self, _start: str, _end: str) -> list[dict]:
        return []

    def fetch_resumen_erp(self, _start: str, _end: str) -> list[dict]:
        return []

    def fetch_sin_documento(self, _start: str, _end: str) -> list[dict]:
        return []

    def fetch_row(self, _id_venta: int) -> list[dict]:
        return []

    def fetch_attempts(self, _id_venta: int) -> list[dict]:
        return []


@pytest.fixture()
def autenticado(monkeypatch):
    monkeypatch.setattr(
        wiring, "_intelisis_ufe_reader", lambda: _ReaderVacio()
    )
    login = client.get("/auth/login", follow_redirects=False)
    assert login.status_code == 303
    return client


@pytest.fixture()
def anonimo():
    """Cliente sin cookies: el login de otra prueba no debe filtrarse."""
    return TestClient(app)


def test_listado_exige_sesion(anonimo) -> None:
    response = anonimo.get(
        "/api/intelisis/ufe",
        params={"desde": "2026-10-20", "hasta": "2026-10-20"},
    )
    assert response.status_code == 401


def test_detalle_exige_sesion(anonimo) -> None:
    assert anonimo.get("/api/intelisis/ufe/7466462").status_code == 401


def test_sin_documento_exige_sesion(anonimo) -> None:
    response = anonimo.get(
        "/api/intelisis/ufe/sin-documento",
        params={"desde": "2026-10-20", "hasta": "2026-10-20"},
    )
    assert response.status_code == 401


def test_sin_documento_no_se_confunde_con_el_detalle(autenticado) -> None:
    """/sin-documento va antes de /{id_venta}: si no, seria un 422."""
    response = autenticado.get(
        "/api/intelisis/ufe/sin-documento",
        params={"desde": "2026-10-20", "hasta": "2026-10-20"},
    )
    assert response.status_code == 200
    assert response.json()["rows"] == []
    assert response.json()["total"] == 0


def test_sin_documento_valida_el_periodo(autenticado) -> None:
    response = autenticado.get(
        "/api/intelisis/ufe/sin-documento",
        params={"desde": "2026-09-01", "hasta": "2026-10-20"},
    )
    assert response.status_code == 400


def test_validar_exige_sesion(anonimo) -> None:
    response = anonimo.post(
        "/api/intelisis/ufe/validar", json={"id_venta": 7466462}
    )
    assert response.status_code == 401


def test_generador_invalido_es_400(autenticado) -> None:
    response = autenticado.get(
        "/api/intelisis/ufe",
        params={
            "desde": "2026-10-20",
            "hasta": "2026-10-20",
            "generador": "NO EXISTE",
        },
    )
    assert response.status_code == 400
    assert "Generador invalido" in response.json()["detail"]


def test_estado_sunat_invalido_es_400(autenticado) -> None:
    response = autenticado.get(
        "/api/intelisis/ufe",
        params={
            "desde": "2026-10-20",
            "hasta": "2026-10-20",
            "sunat": "QUEBO",
        },
    )
    assert response.status_code == 400


def test_estado_derivado_invalido_es_400(autenticado) -> None:
    response = autenticado.get(
        "/api/intelisis/ufe",
        params={
            "desde": "2026-10-20",
            "hasta": "2026-10-20",
            "derivado": "no-existe",
        },
    )
    assert response.status_code == 400
    assert "derivado" in response.json()["detail"].lower()


def test_periodo_mayor_a_31_dias_es_400(autenticado) -> None:
    response = autenticado.get(
        "/api/intelisis/ufe",
        params={"desde": "2026-09-01", "hasta": "2026-10-20"},
    )
    assert response.status_code == 400
    assert "31 dias" in response.json()["detail"]


def test_el_tipo_viaja_como_lista(autenticado) -> None:
    """Los chips de tipo de documento viajan juntos (BO,FA,NC,ND)."""
    response = autenticado.get(
        "/api/intelisis/ufe",
        params={
            "desde": "2026-10-20",
            "hasta": "2026-10-20",
            "tipo": "BO,FA,NC,ND",
        },
    )
    assert response.status_code == 200


def test_un_tipo_desconocido_en_la_lista_es_400(autenticado) -> None:
    response = autenticado.get(
        "/api/intelisis/ufe",
        params={
            "desde": "2026-10-20",
            "hasta": "2026-10-20",
            "tipo": "BO,XX",
        },
    )
    assert response.status_code == 400


def test_documento_inexistente_es_404(autenticado) -> None:
    response = autenticado.get("/api/intelisis/ufe/999999999")
    assert response.status_code == 404


def test_validar_con_id_invalido_es_400(autenticado) -> None:
    response = autenticado.post(
        "/api/intelisis/ufe/validar", json={"id_venta": "no-es-un-id"}
    )
    assert response.status_code == 400


def test_validar_sin_id_es_400(autenticado) -> None:
    response = autenticado.post("/api/intelisis/ufe/validar", json={})
    assert response.status_code == 400
