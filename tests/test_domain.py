"""Domain unit tests. Stdlib only: python -m unittest discover tests."""

from __future__ import annotations

import unittest

from src.domain.entities import FechaRango, TipoDocumento
from src.domain.errors import InvalidDocumentTypeError, InvalidRangeError


class TipoDocumentoTests(unittest.TestCase):
    def test_parse_many_parity_with_legacy_contract(self):
        self.assertEqual(
            [t.value for t in TipoDocumento.parse_many("factura, boleta,NOTA DE CREDITO")],
            ["FACTURA", "BOLETA", "NOTA DE CREDITO"],
        )

    def test_parse_many_rejects_unknown(self):
        for bad in ("", "ticket", "factura,ticket"):
            with self.assertRaises(InvalidDocumentTypeError, msg=bad):
                TipoDocumento.parse_many(bad)


class FechaRangoTests(unittest.TestCase):
    def test_days(self):
        self.assertEqual(FechaRango.from_iso("2026-09-01", "2026-09-07", 93).days, 7)

    def test_rejects_inverted_overlong_and_malformed(self):
        for start, end in (
            ("2026-09-07", "2026-09-01"),
            ("2026-01-01", "2026-12-31"),
            ("xx", "2026-09-01"),
        ):
            with self.assertRaises(InvalidRangeError, msg=f"{start}..{end}"):
                FechaRango.from_iso(start, end, 93)


if __name__ == "__main__":
    unittest.main()
