"""Config del login unico de Intelisis (lectura + cola del ERP).

Una sola instancia (PUSVRBD, sin AG) y un solo login: la conexion que encola
se deriva de la de lectura, igual que en MovSynerPos. Estos tests fijan esa
decision para que nadie reintroduzca un bloque ``INTELISIS_WRITER_*``.
"""

from __future__ import annotations

import pytest

from syner_check import config as cfg


def _lectura(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTELISIS_HOST", "172.0.1.156")
    monkeypatch.setenv("INTELISIS_DB", "Punidas")
    monkeypatch.setenv("INTELISIS_USER", "syner_fe")
    monkeypatch.setenv("INTELISIS_PASSWORD", "secreto")


def test_deriva_del_login_de_lectura(monkeypatch: pytest.MonkeyPatch) -> None:
    _lectura(monkeypatch)

    lectura = cfg.get_intelisis_config()
    escritura = cfg.get_intelisis_write_config()

    assert escritura["server"] == lectura["server"]
    assert escritura["database"] == lectura["database"]
    assert escritura["uid"] == lectura["uid"] == "syner_fe"
    assert escritura["port"] == lectura["port"]
    assert escritura["table"] == cfg.FE_REENVIO_TABLE


def test_sin_application_intent(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sin AG ni réplica no hay a qué enrutar: no se emite ApplicationIntent."""
    from syner_check.db_client import build_connection_string

    _lectura(monkeypatch)
    lectura = cfg.get_intelisis_config()
    escritura = cfg.get_intelisis_write_config()

    assert "application_intent_read_only" not in lectura
    assert "application_intent_read_only" not in escritura
    assert "ApplicationIntent" not in build_connection_string(escritura, "x")


def test_app_name_para_auditar_la_escritura(monkeypatch: pytest.MonkeyPatch) -> None:
    _lectura(monkeypatch)
    monkeypatch.delenv("INTELISIS_APP_NAME", raising=False)

    assert (
        cfg.get_intelisis_write_config()["app_name"]
        == cfg.INTELISIS_APP_NAME_DEFAULT
    )

    monkeypatch.setenv("INTELISIS_APP_NAME", "syner-ufe-qa")
    assert cfg.get_intelisis_write_config()["app_name"] == "syner-ufe-qa"


def test_ignora_variables_writer_heredadas(monkeypatch: pytest.MonkeyPatch) -> None:
    _lectura(monkeypatch)
    # Si alguien deja el bloque viejo en su .env, no debe tener efecto.
    monkeypatch.setenv("INTELISIS_WRITER_HOST", "otro-host")
    monkeypatch.setenv("INTELISIS_WRITER_USER", "otro-login")
    monkeypatch.setenv("INTELISIS_WRITER_PASSWORD", "otro-secreto")

    escritura = cfg.get_intelisis_write_config()

    assert escritura["server"] == "172.0.1.156"
    assert escritura["uid"] == "syner_fe"


def test_password_es_el_mismo_de_la_lectura(monkeypatch: pytest.MonkeyPatch) -> None:
    _lectura(monkeypatch)

    assert cfg.get_intelisis_write_password() == cfg.get_intelisis_password()


def test_writer_configurado_es_intelisis_configurado(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _lectura(monkeypatch)
    assert cfg.is_intelisis_write_configured() is True

    monkeypatch.delenv("INTELISIS_PASSWORD")
    assert cfg.is_intelisis_write_configured() is False


def test_sin_intelisis_el_error_nombra_la_variable_de_lectura(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for nombre in (
        "INTELISIS_HOST",
        "INTELISIS_DB",
        "INTELISIS_USER",
        "INTELISIS_PASSWORD",
    ):
        monkeypatch.delenv(nombre, raising=False)

    with pytest.raises(RuntimeError, match="INTELISIS_HOST"):
        cfg.get_intelisis_write_config()
