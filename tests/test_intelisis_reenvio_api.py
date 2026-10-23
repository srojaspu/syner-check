"""Contrato HTTP del reenvío manual a la cola del ERP (``dbo.FE_Reenvio``).

No toca Intelisis ni la base: el caso de uso se reemplaza por un doble en el
borde del router. Lo que se verifica es la semántica de la API (401 sin
sesión, 503 con el flag apagado o sin writer, 400 con una solicitud inválida,
409 cuando ningún documento se puede encolar, 502 si la cola no responde) y
que el borde valide lo mismo que el PHP: motivo 1..500 y token 32 hex.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from src.domain.errors import (
    NotFoundError,
    ReenvioNoPermitidoError,
    UpstreamError,
)
from src.interfaces import wiring

client = TestClient(app)

TOKEN = "c" * 32


class _ReaderVacio:
    def fetch_rows(self, _start: str, _end: str) -> list[dict]:
        return []

    def fetch_row(self, _id_venta: int) -> list[dict]:
        return []

    def fetch_attempts(self, _id_venta: int) -> list[dict]:
        return []


@pytest.fixture()
def autenticado(monkeypatch):
    monkeypatch.setattr(wiring, "_intelisis_ufe_reader", lambda: _ReaderVacio())
    login = client.get("/auth/login", follow_redirects=False)
    assert login.status_code == 303
    return client


@pytest.fixture()
def habilitado(monkeypatch):
    from syner_check import config as cfg

    monkeypatch.setattr(cfg, "intelisis_resend_enabled", lambda: True)
    monkeypatch.setattr(cfg, "is_intelisis_write_configured", lambda: True)
    monkeypatch.setattr(cfg, "intelisis_resend_max_batch", lambda: 10)


def _respuesta(encolados: int = 1, duplicados: int = 0) -> dict:
    """Respuesta del caso de uso con un solo documento en el detalle."""
    if duplicados and not encolados:
        detalle = [
            {
                "id_venta": 1,
                "documento": "602-00142702",
                "tipo": "03",
                "procedimiento": "SPPUFE_UBL21",
                "estado": "ya_registrado",
                "motivo": "Solicitud ya registrada; no se duplico.",
                "queue_id": 1,
            }
        ]
    elif encolados:
        detalle = [
            {
                "id_venta": 1,
                "documento": "602-00142702",
                "tipo": "03",
                "procedimiento": "SPPUFE_UBL21",
                "estado": "encolado",
                "motivo": "",
                "queue_id": 1,
            }
        ]
    else:
        detalle = [
            {
                "id_venta": 1,
                "documento": "602-00142702",
                "tipo": "",
                "procedimiento": "",
                "estado": "rechazado",
                "motivo": "Solo se puede reenviar un concluido.",
                "queue_id": None,
            }
        ]
    return {
        "total": 1,
        "encolados": encolados,
        "duplicados": duplicados,
        "rechazados": 0 if (encolados or duplicados) else 1,
        "detalle": detalle,
    }


def _parchear_encolar(monkeypatch, funcion) -> None:
    monkeypatch.setattr(wiring, "encolar_reenvio", funcion)


def _post(autenticado, payload: dict):
    return autenticado.post("/api/intelisis/ufe/reenviar", json=payload)


# --- Sesión ----------------------------------------------------------------


def test_reenviar_exige_sesion() -> None:
    response = client.post(
        "/api/intelisis/ufe/reenviar", json={"ids": [1], "motivo": "x"}
    )
    assert response.status_code == 401


def test_la_cola_exige_sesion() -> None:
    assert client.get("/api/intelisis/ufe/reenvios").status_code == 401


def test_resolver_exige_sesion() -> None:
    response = client.post(
        "/api/intelisis/ufe/reenvios/1/resolver", json={"nota": "ok"}
    )
    assert response.status_code == 401


# --- Kill switch y configuración ------------------------------------------


def test_con_el_flag_apagado_responde_503(autenticado, monkeypatch) -> None:
    from syner_check import config as cfg

    monkeypatch.setattr(cfg, "intelisis_resend_enabled", lambda: False)
    monkeypatch.setattr(cfg, "is_intelisis_write_configured", lambda: True)

    response = _post(autenticado, {"ids": [1], "motivo": "sin traza"})

    assert response.status_code == 503
    assert "deshabilitado" in response.json()["detail"]


def test_sin_writer_configurado_responde_503(
    autenticado, habilitado, monkeypatch
) -> None:
    from syner_check import config as cfg

    monkeypatch.setattr(cfg, "is_intelisis_write_configured", lambda: False)

    assert _post(autenticado, {"ids": [1], "motivo": "x"}).status_code == 503
    assert autenticado.get("/api/intelisis/ufe/reenvios").status_code == 503
    assert (
        autenticado.post(
            "/api/intelisis/ufe/reenvios/5/resolver", json={"nota": "ok"}
        ).status_code
        == 503
    )


def test_sin_lector_de_intelisis_responde_503(
    autenticado, habilitado, monkeypatch
) -> None:
    monkeypatch.setattr(wiring, "_intelisis_ufe_reader", lambda: None)

    response = _post(autenticado, {"ids": [1], "motivo": "sin traza"})

    assert response.status_code == 503
    assert "no disponible" in response.json()["detail"]


# --- Validación del borde --------------------------------------------------


def test_sin_ids_es_400(autenticado, habilitado) -> None:
    assert _post(autenticado, {"motivo": "x"}).status_code == 400
    assert _post(autenticado, {"ids": [], "motivo": "x"}).status_code == 400


def test_un_id_invalido_es_400(autenticado, habilitado) -> None:
    response = _post(
        autenticado, {"ids": ["no-es-un-id"], "motivo": "sin traza"}
    )
    assert response.status_code == 400


def test_el_motivo_es_obligatorio(autenticado, habilitado) -> None:
    assert _post(autenticado, {"ids": [1]}).status_code == 400
    assert _post(autenticado, {"ids": [1], "motivo": ""}).status_code == 400
    assert _post(autenticado, {"ids": [1], "motivo": "   "}).status_code == 400


def test_un_motivo_de_mas_de_500_es_400(autenticado, habilitado) -> None:
    assert (
        _post(autenticado, {"ids": [1], "motivo": "x" * 501}).status_code
        == 400
    )


def test_un_motivo_de_500_pasa(autenticado, habilitado, monkeypatch) -> None:
    recibido: dict = {}

    def _encolar(_reader, _queue, *, motivo, **kwargs):
        recibido["motivo"] = motivo
        return _respuesta()

    _parchear_encolar(monkeypatch, _encolar)

    assert (
        _post(autenticado, {"ids": [1], "motivo": "x" * 500}).status_code
        == 200
    )
    assert len(recibido["motivo"]) == 500


@pytest.mark.parametrize(
    "token",
    ["abc", "g" * 32, "c" * 31, "c" * 33, 12345, ["c" * 32]],
)
def test_un_token_invalido_es_400(autenticado, habilitado, token) -> None:
    response = _post(
        autenticado, {"ids": [1], "motivo": "sin traza", "token": token}
    )
    assert response.status_code == 400
    assert "Token" in response.json()["detail"]


def test_un_token_valido_llega_al_caso_de_uso(
    autenticado, habilitado, monkeypatch
) -> None:
    recibido: dict = {}

    def _encolar(_reader, _queue, *, token, **kwargs):
        recibido["token"] = token
        return _respuesta()

    _parchear_encolar(monkeypatch, _encolar)

    assert (
        _post(
            autenticado,
            {"ids": [1], "motivo": "sin traza", "token": TOKEN},
        ).status_code
        == 200
    )
    assert recibido["token"] == TOKEN


# --- Encolado --------------------------------------------------------------


def test_un_id_venta_suelto_tambien_basta(
    autenticado, habilitado, monkeypatch
) -> None:
    recibido: dict = {}

    def _encolar(_reader, _queue, *, ids, motivo, forzar, **kwargs):
        recibido.update(ids=ids, motivo=motivo, forzar=forzar)
        return _respuesta()

    _parchear_encolar(monkeypatch, _encolar)

    response = _post(autenticado, {"id_venta": 1, "motivo": "sin traza"})

    assert response.status_code == 200
    assert recibido["ids"] == [1]


def test_un_encolado_exitoso_devuelve_el_detalle(
    autenticado, habilitado, monkeypatch
) -> None:
    _parchear_encolar(monkeypatch, lambda *args, **kwargs: _respuesta())

    response = _post(
        autenticado, {"ids": [1], "motivo": "sin traza"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["encolados"] == 1
    assert body["duplicados"] == 0
    assert body["detalle"][0]["documento"] == "602-00142702"
    assert body["detalle"][0]["procedimiento"] == "SPPUFE_UBL21"


def test_un_reintento_idempotente_se_reporta_como_tal(
    autenticado, habilitado, monkeypatch
) -> None:
    _parchear_encolar(
        monkeypatch,
        lambda *args, **kwargs: _respuesta(encolados=0, duplicados=1),
    )

    response = _post(
        autenticado,
        {"ids": [1], "motivo": "sin traza", "token": TOKEN},
    )

    assert response.status_code == 200
    assert response.json()["duplicados"] == 1
    assert response.json()["encolados"] == 0


def test_si_ningun_documento_se_encola_es_409(
    autenticado, habilitado, monkeypatch
) -> None:
    _parchear_encolar(
        monkeypatch, lambda *args, **kwargs: _respuesta(encolados=0)
    )

    response = _post(autenticado, {"ids": [1], "motivo": "sin traza"})

    assert response.status_code == 409
    assert "concluido" in response.json()["detail"]


def test_una_solicitud_invalida_es_400(
    autenticado, habilitado, monkeypatch
) -> None:
    def _fallar(*args, **kwargs):
        raise ValueError("Selecciona al menos un comprobante.")

    _parchear_encolar(monkeypatch, _fallar)

    assert (
        _post(autenticado, {"ids": [1], "motivo": "sin traza"}).status_code
        == 400
    )


def test_una_caida_de_intelisis_es_502(
    autenticado, habilitado, monkeypatch
) -> None:
    def _caido(*args, **kwargs):
        raise UpstreamError("sin conexion")

    _parchear_encolar(monkeypatch, _caido)

    assert (
        _post(autenticado, {"ids": [1], "motivo": "sin traza"}).status_code
        == 502
    )


def test_forzar_solo_con_el_booleano_true(
    autenticado, habilitado, monkeypatch
) -> None:
    recibido: list[bool] = []

    def _encolar(_reader, _queue, *, forzar, **kwargs):
        recibido.append(forzar)
        return _respuesta()

    _parchear_encolar(monkeypatch, _encolar)

    _post(autenticado, {"ids": [1], "motivo": "x", "forzar": "false"})
    _post(autenticado, {"ids": [1], "motivo": "x", "forzar": True})

    assert recibido == [False, True]


# --- Panel de cola ---------------------------------------------------------


def test_la_cola_devuelve_el_panel_del_erp(
    autenticado, habilitado, monkeypatch
) -> None:
    monkeypatch.setattr(
        wiring,
        "listar_reenvios",
        lambda _queue, *, limit, estado: {
            "ocupado": True,
            "worker": {"ID": 1, "Estado": "EN_ESPERA"},
            "pendientes": 2,
            "sin_confirmar": 1,
            "activos": [{"ID": 1, "Estado": "EN_COLA"}],
            "historial": [{"ID": 2, "Estado": "FINALIZADO_OK"}],
            "resumen": {"EN_COLA": 2},
            "total": 2,
        },
    )

    response = autenticado.get("/api/intelisis/ufe/reenvios")

    assert response.status_code == 200
    body = response.json()
    assert body["pendientes"] == 2
    assert body["worker"]["Estado"] == "EN_ESPERA"
    assert body["resumen"] == {"EN_COLA": 2}
    # El borde agrega si el reenvio esta habilitado y el tope por solicitud:
    # con eso la pantalla decide si ofrece la accion y cuanto admite.
    assert body["habilitado"] is True
    assert body["max_batch"] == 10


def test_el_panel_pasa_el_filtro_y_el_limite(
    autenticado, habilitado, monkeypatch
) -> None:
    recibido: dict = {}

    def _listar(_queue, *, limit, estado):
        recibido.update(limit=limit, estado=estado)
        return {"activos": [], "historial": []}

    monkeypatch.setattr(wiring, "listar_reenvios", _listar)

    autenticado.get(
        "/api/intelisis/ufe/reenvios",
        params={"limit": 5, "estado": "NO_CONFIRMADO"},
    )

    assert recibido == {"limit": 5, "estado": "NO_CONFIRMADO"}


def test_un_filtro_de_cola_invalido_es_400(
    autenticado, habilitado, monkeypatch
) -> None:
    def _fallar(_queue, *, limit, estado):
        raise ValueError("Estado de reenvio invalido.")

    monkeypatch.setattr(wiring, "listar_reenvios", _fallar)

    assert (
        autenticado.get(
            "/api/intelisis/ufe/reenvios", params={"estado": "MAGIA"}
        ).status_code
        == 400
    )


def test_el_limite_del_panel_se_valida_en_el_borde(
    autenticado, habilitado
) -> None:
    assert (
        autenticado.get(
            "/api/intelisis/ufe/reenvios", params={"limit": 9999}
        ).status_code
        == 422
    )


def test_si_la_cola_no_responde_es_502(
    autenticado, habilitado, monkeypatch
) -> None:
    def _caido(_queue, *, limit, estado):
        raise UpstreamError("sin conexion")

    monkeypatch.setattr(wiring, "listar_reenvios", _caido)

    assert autenticado.get("/api/intelisis/ufe/reenvios").status_code == 502


# --- Resolución manual -----------------------------------------------------


def test_resolver_exitoso(autenticado, habilitado, monkeypatch) -> None:
    recibido: dict = {}

    def _resolver(_queue, *, queue_id, actor, nota, correlation_id=""):
        recibido.update(queue_id=queue_id, nota=nota)
        return {
            "queue_id": queue_id,
            "estado": "REVISADO_MANUAL",
            "mensaje": "Revision registrada.",
        }

    monkeypatch.setattr(wiring, "resolver_reenvio", _resolver)

    response = autenticado.post(
        "/api/intelisis/ufe/reenvios/5/resolver", json={"nota": "revisado"}
    )

    assert response.status_code == 200
    assert response.json()["estado"] == "REVISADO_MANUAL"
    assert recibido == {"queue_id": 5, "nota": "revisado"}


def test_resolver_sin_nota_es_400(
    autenticado, habilitado, monkeypatch
) -> None:
    def _fallar(_queue, *, queue_id, actor, nota, correlation_id=""):
        raise ValueError("La nota de revision es obligatoria.")

    monkeypatch.setattr(wiring, "resolver_reenvio", _fallar)

    assert (
        autenticado.post(
            "/api/intelisis/ufe/reenvios/5/resolver", json={"nota": ""}
        ).status_code
        == 400
    )


def test_resolver_un_reenvio_inexistente_es_404(
    autenticado, habilitado, monkeypatch
) -> None:
    def _fallar(_queue, *, queue_id, actor, nota, correlation_id=""):
        raise NotFoundError("no esta")

    monkeypatch.setattr(wiring, "resolver_reenvio", _fallar)

    assert (
        autenticado.post(
            "/api/intelisis/ufe/reenvios/5/resolver", json={"nota": "ok"}
        ).status_code
        == 404
    )


def test_resolver_con_el_worker_activo_es_409(
    autenticado, habilitado, monkeypatch
) -> None:
    def _fallar(_queue, *, queue_id, actor, nota, correlation_id=""):
        raise ReenvioNoPermitidoError(
            "El procesador sigue activo. No se puede cerrar la revision."
        )

    monkeypatch.setattr(wiring, "resolver_reenvio", _fallar)

    response = autenticado.post(
        "/api/intelisis/ufe/reenvios/5/resolver", json={"nota": "ok"}
    )

    assert response.status_code == 409
    assert "procesador" in response.json()["detail"]


def test_resolver_con_la_cola_caida_es_502(
    autenticado, habilitado, monkeypatch
) -> None:
    def _fallar(_queue, *, queue_id, actor, nota, correlation_id=""):
        raise UpstreamError("sin conexion")

    monkeypatch.setattr(wiring, "resolver_reenvio", _fallar)

    assert (
        autenticado.post(
            "/api/intelisis/ufe/reenvios/5/resolver", json={"nota": "ok"}
        ).status_code
        == 502
    )
