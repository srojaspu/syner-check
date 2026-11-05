"""Unit tests for src/domain/series_sucursales.py."""

import unittest
from src.domain.errors import SerieSucursalValidationError
from src.domain.series_sucursales import (
    SerieSucursal,
    validate_nombre,
    validate_prefijo,
    validate_serie_sucursal_payload,
    validate_seriesynerpos,
    validate_sucursal,
)


class TestSerieSucursalDomain(unittest.TestCase):
    def test_valid_serie_sucursal_dataclass(self) -> None:
        item = SerieSucursal(
            sucursal=104,
            nombre="Tienda Jockey Plaza",
            prefijo="104- ",
            seriesynerpos="004",
        )
        self.assertEqual(item.sucursal, 104)
        self.assertEqual(item.nombre, "Tienda Jockey Plaza")
        self.assertEqual(item.prefijo, "104- ")
        self.assertEqual(item.seriesynerpos, "004")
        self.assertEqual(
            item.to_dict(),
            {
                "sucursal": 104,
                "nombre": "Tienda Jockey Plaza",
                "prefijo": "104- ",
                "seriesynerpos": "004",
            },
        )

    def test_validate_sucursal_success(self) -> None:
        self.assertEqual(validate_sucursal(102), 102)
        self.assertEqual(validate_sucursal("105"), 105)

    def test_validate_sucursal_invalid(self) -> None:
        for invalid in (None, "", "abc", 0, -5, 1_000_000):
            with self.assertRaises(SerieSucursalValidationError):
                validate_sucursal(invalid)

    def test_validate_nombre_success(self) -> None:
        self.assertEqual(
            validate_nombre("  Tienda Mall Caracol  "), "Tienda Mall Caracol"
        )

    def test_validate_nombre_invalid(self) -> None:
        with self.assertRaises(SerieSucursalValidationError):
            validate_nombre("")
        with self.assertRaises(SerieSucursalValidationError):
            validate_nombre("   ")
        with self.assertRaises(SerieSucursalValidationError):
            validate_nombre("A" * 101)

    def test_validate_prefijo_default(self) -> None:
        self.assertEqual(validate_prefijo("", 104), "104- ")
        self.assertEqual(validate_prefijo(None, 104), "104- ")

    def test_validate_prefijo_custom(self) -> None:
        self.assertEqual(validate_prefijo("104-", 104), "104- ")
        self.assertEqual(validate_prefijo("ABC- ", 104), "ABC- ")

    def test_validate_prefijo_too_long(self) -> None:
        with self.assertRaises(SerieSucursalValidationError):
            validate_prefijo("12345678901", 104)

    def test_validate_seriesynerpos_nullable(self) -> None:
        self.assertIsNone(validate_seriesynerpos(None))
        self.assertIsNone(validate_seriesynerpos(""))
        self.assertIsNone(validate_seriesynerpos("   "))
        self.assertIsNone(validate_seriesynerpos("-"))
        self.assertIsNone(validate_seriesynerpos("NULL"))

    def test_validate_seriesynerpos_valid(self) -> None:
        self.assertEqual(validate_seriesynerpos("s02"), "S02")
        self.assertEqual(validate_seriesynerpos("004"), "004")
        self.assertEqual(validate_seriesynerpos("S-20"), "S-20")

    def test_validate_seriesynerpos_invalid(self) -> None:
        with self.assertRaises(SerieSucursalValidationError):
            validate_seriesynerpos("S02@")
        with self.assertRaises(SerieSucursalValidationError):
            validate_seriesynerpos("A" * 11)

    def test_validate_payload_complete(self) -> None:
        payload = {
            "sucursal": "120",
            "nombre": "Boutique Dior",
            "prefijo": "120-",
            "seriesynerpos": "s12",
        }
        res = validate_serie_sucursal_payload(payload)
        self.assertEqual(
            res,
            {
                "sucursal": 120,
                "nombre": "Boutique Dior",
                "prefijo": "120- ",
                "seriesynerpos": "S12",
            },
        )


if __name__ == "__main__":
    unittest.main()
