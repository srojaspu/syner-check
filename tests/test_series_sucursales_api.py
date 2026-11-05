"""Unit tests for SerieSucursal API endpoints in app/main.py."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

USER = {"email": "tester@example.com", "name": "Tester"}

SAMPLE_ITEM = {
    "sucursal": 104,
    "nombre": "Tienda Jockey Plaza",
    "prefijo": "104- ",
    "seriesynerpos": "004",
}


class TestSerieSucursalApi(unittest.TestCase):
    def test_list_requires_session(self) -> None:
        response = client.get("/api/series-sucursales")
        self.assertEqual(response.status_code, 401)

    def test_list_success(self) -> None:
        with patch("app.main.current_user", return_value=USER), patch(
            "app.main.clean_serie_sucursal_list", return_value=[SAMPLE_ITEM]
        ) as mock_list:
            response = client.get("/api/series-sucursales?q=jockey")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), [SAMPLE_ITEM])
            mock_list.assert_called_once_with("jockey")

    def test_get_by_id_success(self) -> None:
        with patch("app.main.current_user", return_value=USER), patch(
            "app.main.clean_serie_sucursal_get", return_value=SAMPLE_ITEM
        ):
            response = client.get("/api/series-sucursales/104")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["sucursal"], 104)

    def test_get_by_id_not_found(self) -> None:
        with patch("app.main.current_user", return_value=USER), patch(
            "app.main.clean_serie_sucursal_get",
            side_effect=HTTPException(404, "Sucursal no encontrada"),
        ):
            response = client.get("/api/series-sucursales/999")
            self.assertEqual(response.status_code, 404)

    def test_create_requires_session(self) -> None:
        response = client.post("/api/series-sucursales", json=SAMPLE_ITEM)
        self.assertEqual(response.status_code, 401)

    def test_create_success(self) -> None:
        with patch("app.main.current_user", return_value=USER), patch(
            "app.main.clean_serie_sucursal_create", return_value=SAMPLE_ITEM
        ):
            response = client.post("/api/series-sucursales", json=SAMPLE_ITEM)
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.json()["sucursal"], 104)

    def test_create_validation_error(self) -> None:
        with patch("app.main.current_user", return_value=USER), patch(
            "app.main.clean_serie_sucursal_create",
            side_effect=HTTPException(400, "Nombre obligatorio"),
        ):
            response = client.post(
                "/api/series-sucursales", json={"sucursal": 104}
            )
            self.assertEqual(response.status_code, 400)

    def test_create_duplicate_conflict(self) -> None:
        with patch("app.main.current_user", return_value=USER), patch(
            "app.main.clean_serie_sucursal_create",
            side_effect=HTTPException(409, "Sucursal ya existe"),
        ):
            response = client.post("/api/series-sucursales", json=SAMPLE_ITEM)
            self.assertEqual(response.status_code, 409)

    def test_update_success(self) -> None:
        updated = {**SAMPLE_ITEM, "nombre": "Jockey Renovado"}
        with patch("app.main.current_user", return_value=USER), patch(
            "app.main.clean_serie_sucursal_update", return_value=updated
        ):
            response = client.put("/api/series-sucursales/104", json=updated)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["nombre"], "Jockey Renovado")

    def test_update_not_found(self) -> None:
        with patch("app.main.current_user", return_value=USER), patch(
            "app.main.clean_serie_sucursal_update",
            side_effect=HTTPException(404, "No existe"),
        ):
            response = client.put(
                "/api/series-sucursales/999", json=SAMPLE_ITEM
            )
            self.assertEqual(response.status_code, 404)

    def test_delete_success(self) -> None:
        with patch("app.main.current_user", return_value=USER), patch(
            "app.main.clean_serie_sucursal_delete",
            return_value={"mensaje": "Eliminada"},
        ):
            response = client.delete("/api/series-sucursales/104")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["mensaje"], "Eliminada")

    def test_delete_not_found(self) -> None:
        with patch("app.main.current_user", return_value=USER), patch(
            "app.main.clean_serie_sucursal_delete",
            side_effect=HTTPException(404, "No existe"),
        ):
            response = client.delete("/api/series-sucursales/999")
            self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
