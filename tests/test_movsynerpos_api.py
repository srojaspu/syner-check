"""F4: endpoint /api/movsynerpos/enviar (auth, límites y contrato HTTP)."""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from src.domain.errors import (
    MovSynerPosDeleteBlockedError,
    MovSynerPosPermissionError,
    NotFoundError,
    UpstreamError,
)
from syner_check import config as cfg

client = TestClient(app)

PAYLOAD = {
    "documentos": [
        {
            "tipo": "BOLETA",
            "oid": "boleta-sintetica-001",
            "number": "B004-00001234",
            "date": "2026-10-20",
        }
    ]
}

FAKE_RESULT = {
    "solicitud_id": "corr-test",
    "total": 1,
    "insertados": 1,
    "reparados": 0,
    "sin_cambios": 0,
    "conflictos": 0,
    "errores": 0,
    "detalle": [
        {
            "tipo": "BOLETA",
            "oid": "boleta-sintetica-001",
            "number": "B004-00001234",
            "estado": "insertado",
            "lineas_insertadas": 2,
            "lineas_existentes": 0,
            "lineas_faltantes": 2,
            "error": None,
        }
    ],
}

USER = {"email": "tester@example.test", "name": "Tester"}


class MovSynerPosApiTest(unittest.TestCase):
    def test_requires_session(self) -> None:
        response = client.post("/api/movsynerpos/enviar", json=PAYLOAD)
        self.assertEqual(response.status_code, 401)

    def test_disabled_by_default_returns_503(self) -> None:
        with patch("app.main.current_user", return_value=USER), patch.object(
            cfg, "movsynerpos_enabled", return_value=False
        ):
            response = client.post("/api/movsynerpos/enviar", json=PAYLOAD)
        self.assertEqual(response.status_code, 503)
        self.assertIn("deshabilitado", response.json()["detail"])

    def test_unconfigured_writer_returns_503(self) -> None:
        with patch("app.main.current_user", return_value=USER), patch.object(
            cfg, "movsynerpos_enabled", return_value=True
        ), patch.object(cfg, "is_movsynerpos_configured", return_value=False):
            response = client.post("/api/movsynerpos/enviar", json=PAYLOAD)
        self.assertEqual(response.status_code, 503)
        self.assertIn("no configurado", response.json()["detail"])

    def test_success_passes_actor_and_reparar(self) -> None:
        with patch("app.main.current_user", return_value=USER), patch(
            "app.main.clean_movsynerpos_send", return_value=FAKE_RESULT
        ) as clean:
            response = client.post(
                "/api/movsynerpos/enviar", json={**PAYLOAD, "reparar": True}
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["insertados"], 1)
        args = clean.call_args.args
        self.assertEqual(args[0], PAYLOAD["documentos"])
        self.assertTrue(args[1])
        self.assertEqual(args[2], "tester@example.test")
        self.assertTrue(isinstance(args[3], str))

    def test_invalid_type_returns_400_before_any_write(self) -> None:
        body = {
            "documentos": [
                {"tipo": "GUIA", "oid": "x", "date": "2026-10-20"}
            ]
        }
        with patch("app.main.current_user", return_value=USER), patch.object(
            cfg, "movsynerpos_enabled", return_value=True
        ), patch.object(cfg, "is_movsynerpos_configured", return_value=True):
            response = client.post("/api/movsynerpos/enviar", json=body)
        self.assertEqual(response.status_code, 400)

    def test_empty_list_returns_400(self) -> None:
        with patch("app.main.current_user", return_value=USER):
            response = client.post(
                "/api/movsynerpos/enviar", json={"documentos": []}
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Sin documentos", response.json()["detail"])

    def test_non_list_returns_400(self) -> None:
        with patch("app.main.current_user", return_value=USER):
            response = client.post(
                "/api/movsynerpos/enviar", json={"documentos": "x"}
            )
        self.assertEqual(response.status_code, 400)

    def test_more_than_25_documents_returns_400(self) -> None:
        body = {
            "documentos": [
                {"tipo": "BOLETA", "oid": f"o-{i}", "date": "2026-10-20"}
                for i in range(26)
            ]
        }
        with patch("app.main.current_user", return_value=USER):
            response = client.post("/api/movsynerpos/enviar", json=body)
        self.assertEqual(response.status_code, 400)
        self.assertIn("25", response.json()["detail"])

    def test_body_over_64kb_returns_413(self) -> None:
        body = {**PAYLOAD, "padding": "x" * (70 * 1024)}
        with patch("app.main.current_user", return_value=USER):
            response = client.post(
                "/api/movsynerpos/enviar",
                content=json.dumps(body),
                headers={"Content-Type": "application/json"},
            )
        self.assertEqual(response.status_code, 413)


DELETE_PAYLOAD = {
    "oid": "14257.639095",
    "tipo": "BOLETA",
    "number": "BS05-00011252",
    "motivo": "SynerCom duplico el comprobante con detalle erroneo",
    "forzar": False,
}

FAKE_DELETE_RESULT = {
    "solicitud_id": "corr-test",
    "oid": DELETE_PAYLOAD["oid"],
    "tipo": DELETE_PAYLOAD["tipo"],
    "number": DELETE_PAYLOAD["number"],
    "estado": "eliminado",
    "lineas_eliminadas": 2,
    "mensaje": "Comprobante eliminado exitosamente de MovSynerPos.",
    "intelisis_estatus": "SINAFECTAR",
}

ENABLED = (
    patch.object(cfg, "movsynerpos_delete_enabled", return_value=True),
    patch.object(cfg, "is_movsynerpos_configured", return_value=True),
    patch.object(cfg, "is_intelisis_configured", return_value=False),
)


class MovSynerPosDeleteApiTest(unittest.TestCase):
    def test_requires_session(self) -> None:
        response = client.post("/api/movsynerpos/borrar", json=DELETE_PAYLOAD)
        self.assertEqual(response.status_code, 401)

    def test_disabled_by_default_returns_503(self) -> None:
        with patch("app.main.current_user", return_value=USER), patch.object(
            cfg, "movsynerpos_delete_enabled", return_value=False
        ):
            response = client.post(
                "/api/movsynerpos/borrar", json=DELETE_PAYLOAD
            )
        self.assertEqual(response.status_code, 503)
        self.assertIn("deshabilitada", response.json()["detail"])

    def test_unconfigured_writer_returns_503(self) -> None:
        with patch("app.main.current_user", return_value=USER), patch.object(
            cfg, "movsynerpos_delete_enabled", return_value=True
        ), patch.object(cfg, "is_movsynerpos_configured", return_value=False):
            response = client.post(
                "/api/movsynerpos/borrar", json=DELETE_PAYLOAD
            )
        self.assertEqual(response.status_code, 503)
        self.assertIn("no configurada", response.json()["detail"])

    def test_success_passes_identity_motivo_and_actor(self) -> None:
        with patch("app.main.current_user", return_value=USER), patch(
            "app.main.clean_movsynerpos_delete", return_value=FAKE_DELETE_RESULT
        ) as clean:
            response = client.post(
                "/api/movsynerpos/borrar",
                json={**DELETE_PAYLOAD, "forzar": True},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["lineas_eliminadas"], 2)
        args = clean.call_args.args
        self.assertEqual(args[0], DELETE_PAYLOAD["oid"])
        self.assertEqual(args[1], DELETE_PAYLOAD["tipo"])
        self.assertEqual(args[2], DELETE_PAYLOAD["number"])
        self.assertEqual(args[3], DELETE_PAYLOAD["motivo"])
        self.assertTrue(args[4])
        self.assertEqual(args[5], "tester@example.test")
        self.assertIsInstance(args[6], str)

    def test_missing_motivo_returns_400_before_any_write(self) -> None:
        with patch("app.main.current_user", return_value=USER), ENABLED[0], (
            ENABLED[1]
        ), ENABLED[2]:
            response = client.post(
                "/api/movsynerpos/borrar",
                json={**DELETE_PAYLOAD, "motivo": "  "},
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn("motivo", response.json()["detail"])

    def test_not_found_returns_404(self) -> None:
        with patch("app.main.current_user", return_value=USER), ENABLED[0], (
            ENABLED[1]
        ), ENABLED[2], patch(
            "src.interfaces.wiring.delete_movsynerpos",
            side_effect=NotFoundError("sin lineas"),
        ):
            response = client.post(
                "/api/movsynerpos/borrar", json=DELETE_PAYLOAD
            )
        self.assertEqual(response.status_code, 404)

    def test_intelisis_block_returns_409(self) -> None:
        with patch("app.main.current_user", return_value=USER), ENABLED[0], (
            ENABLED[1]
        ), ENABLED[2], patch(
            "src.interfaces.wiring.delete_movsynerpos",
            side_effect=MovSynerPosDeleteBlockedError("concluido"),
        ):
            response = client.post(
                "/api/movsynerpos/borrar", json=DELETE_PAYLOAD
            )
        self.assertEqual(response.status_code, 409)
        self.assertIn("concluido", response.json()["detail"])

    def test_missing_delete_grant_returns_503(self) -> None:
        with patch("app.main.current_user", return_value=USER), ENABLED[0], (
            ENABLED[1]
        ), ENABLED[2], patch(
            "src.interfaces.wiring.delete_movsynerpos",
            side_effect=MovSynerPosPermissionError("denied"),
        ):
            response = client.post(
                "/api/movsynerpos/borrar", json=DELETE_PAYLOAD
            )
        self.assertEqual(response.status_code, 503)
        self.assertIn("DBA", response.json()["detail"])

    def test_upstream_failure_returns_502(self) -> None:
        with patch("app.main.current_user", return_value=USER), ENABLED[0], (
            ENABLED[1]
        ), ENABLED[2], patch(
            "src.interfaces.wiring.delete_movsynerpos",
            side_effect=UpstreamError("boom"),
        ):
            response = client.post(
                "/api/movsynerpos/borrar", json=DELETE_PAYLOAD
            )
        self.assertEqual(response.status_code, 502)

    def test_body_over_16kb_returns_413(self) -> None:
        body = {**DELETE_PAYLOAD, "padding": "x" * (20 * 1024)}
        with patch("app.main.current_user", return_value=USER):
            response = client.post(
                "/api/movsynerpos/borrar",
                content=json.dumps(body),
                headers={"Content-Type": "application/json"},
            )
        self.assertEqual(response.status_code, 413)
