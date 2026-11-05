"""Unit tests for src/application/series_sucursales.py with an in-memory FakeRepo."""

import unittest
from src.domain.errors import (
    SerieSucursalDuplicateError,
    SerieSucursalNotFoundError,
    SerieSucursalValidationError,
)
from src.application.series_sucursales import (
    actualizar_serie_sucursal,
    crear_serie_sucursal,
    eliminar_serie_sucursal,
    listar_series_sucursales,
    obtener_serie_sucursal,
)


class FakeSerieSucursalRepo:
    def __init__(self, initial: list[dict] | None = None):
        self.rows: dict[int, dict] = {
            item["sucursal"]: dict(item) for item in (initial or [])
        }

    def list_all(self) -> list[dict]:
        return sorted(self.rows.values(), key=lambda r: r["sucursal"])

    def get_by_sucursal(self, sucursal: int) -> dict | None:
        row = self.rows.get(sucursal)
        return dict(row) if row else None

    def get_by_serie(self, serie: str) -> dict | None:
        target = serie.strip().upper()
        for r in self.rows.values():
            if (r.get("seriesynerpos") or "").strip().upper() == target:
                return dict(r)
        return None

    def create(self, item: dict) -> dict:
        self.rows[item["sucursal"]] = dict(item)
        return dict(item)

    def update(self, sucursal: int, item: dict) -> dict:
        self.rows[sucursal] = dict(item)
        return dict(item)

    def delete(self, sucursal: int) -> bool:
        if sucursal in self.rows:
            del self.rows[sucursal]
            return True
        return False


SAMPLE_ROWS = [
    {
        "sucursal": 102,
        "nombre": "Tienda Mall Caracol",
        "prefijo": "102- ",
        "seriesynerpos": "S02",
    },
    {
        "sucursal": 104,
        "nombre": "Tienda Jockey Plaza",
        "prefijo": "104- ",
        "seriesynerpos": "004",
    },
    {
        "sucursal": 108,
        "nombre": "Asia",
        "prefijo": "108- ",
        "seriesynerpos": None,
    },
]


class TestSerieSucursalUseCases(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = FakeSerieSucursalRepo(SAMPLE_ROWS)

    def test_list_all(self) -> None:
        items = listar_series_sucursales(self.repo)
        self.assertEqual(len(items), 3)
        self.assertEqual(items[0]["sucursal"], 102)

    def test_list_filter_by_text(self) -> None:
        items = listar_series_sucursales(self.repo, search="jockey")
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["sucursal"], 104)

        items_by_serie = listar_series_sucursales(self.repo, search="s02")
        self.assertEqual(len(items_by_serie), 1)
        self.assertEqual(items_by_serie[0]["sucursal"], 102)

        items_by_id = listar_series_sucursales(self.repo, search="108")
        self.assertEqual(len(items_by_id), 1)
        self.assertEqual(items_by_id[0]["nombre"], "Asia")

    def test_get_by_id(self) -> None:
        item = obtener_serie_sucursal(self.repo, 104)
        self.assertEqual(item["nombre"], "Tienda Jockey Plaza")

    def test_get_by_id_not_found(self) -> None:
        with self.assertRaises(SerieSucursalNotFoundError):
            obtener_serie_sucursal(self.repo, 999)

    def test_create_success(self) -> None:
        payload = {
            "sucursal": 120,
            "nombre": "Boutique Dior",
            "prefijo": "120-",
            "seriesynerpos": "S12",
        }
        res = crear_serie_sucursal(self.repo, payload, actor="admin@example.com")
        self.assertEqual(res["sucursal"], 120)
        self.assertEqual(res["seriesynerpos"], "S12")
        self.assertIsNotNone(self.repo.get_by_sucursal(120))

    def test_create_duplicate_sucursal(self) -> None:
        payload = {
            "sucursal": 104,
            "nombre": "Otro Jockey",
            "prefijo": "104-",
            "seriesynerpos": "S99",
        }
        with self.assertRaises(SerieSucursalDuplicateError):
            crear_serie_sucursal(self.repo, payload, actor="admin@example.com")

    def test_create_duplicate_serie(self) -> None:
        payload = {
            "sucursal": 199,
            "nombre": "Nueva Tienda",
            "prefijo": "199-",
            "seriesynerpos": "004",  # ya asignada a 104
        }
        with self.assertRaises(SerieSucursalDuplicateError):
            crear_serie_sucursal(self.repo, payload, actor="admin@example.com")

    def test_create_null_serie_allowed_multiple_times(self) -> None:
        payload1 = {
            "sucursal": 190,
            "nombre": "Tienda A",
            "prefijo": "190-",
            "seriesynerpos": None,
        }
        payload2 = {
            "sucursal": 191,
            "nombre": "Tienda B",
            "prefijo": "191-",
            "seriesynerpos": None,
        }
        crear_serie_sucursal(self.repo, payload1, actor="admin@example.com")
        crear_serie_sucursal(self.repo, payload2, actor="admin@example.com")
        self.assertIsNone(self.repo.get_by_sucursal(190)["seriesynerpos"])
        self.assertIsNone(self.repo.get_by_sucursal(191)["seriesynerpos"])

    def test_update_success(self) -> None:
        payload = {
            "nombre": "Asia Actualizada",
            "prefijo": "108- ",
            "seriesynerpos": "S08",
        }
        res = actualizar_serie_sucursal(
            self.repo, 108, payload, actor="admin@example.com"
        )
        self.assertEqual(res["nombre"], "Asia Actualizada")
        self.assertEqual(res["seriesynerpos"], "S08")

    def test_update_duplicate_serie(self) -> None:
        payload = {
            "nombre": "Asia",
            "prefijo": "108- ",
            "seriesynerpos": "004",  # ya asignada a 104
        }
        with self.assertRaises(SerieSucursalDuplicateError):
            actualizar_serie_sucursal(
                self.repo, 108, payload, actor="admin@example.com"
            )

    def test_update_not_found(self) -> None:
        with self.assertRaises(SerieSucursalNotFoundError):
            actualizar_serie_sucursal(
                self.repo, 999, {"nombre": "X"}, actor="admin@example.com"
            )

    def test_delete_success(self) -> None:
        res = eliminar_serie_sucursal(self.repo, 108, actor="admin@example.com")
        self.assertEqual(res["sucursal"], 108)
        self.assertIsNone(self.repo.get_by_sucursal(108))

    def test_delete_not_found(self) -> None:
        with self.assertRaises(SerieSucursalNotFoundError):
            eliminar_serie_sucursal(self.repo, 999, actor="admin@example.com")


if __name__ == "__main__":
    unittest.main()
