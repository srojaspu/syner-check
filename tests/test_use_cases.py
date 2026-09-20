"""Use-case unit tests with fakes. Stdlib only."""

from __future__ import annotations

import unittest
from datetime import date

from src.application import get_detail, search_by_number, summarize
from src.domain.entities import TipoDocumento
from src.domain.errors import NotFoundError


class FakeReader:
    def __init__(self, rows):
        self.rows = rows

    def fetch_by_number(self, number, tipos, start_iso, end_iso):
        return self.rows

    def fetch_documents(self, start_iso, end_iso, tipos):
        raise AssertionError("not used here")


class FakeGateway:
    def __init__(self, docs_by_key):
        self.docs_by_key = docs_by_key
        self.calls: list[tuple[str, str, str]] = []

    def detail(self, tipo, start_iso, end_iso, number=None):
        self.calls.append((tipo, start_iso, end_iso))
        docs = self.docs_by_key.get((tipo, start_iso), [])
        if number:
            target = number.strip().upper()
            return [d for d in docs if str(d.get("number", "")).strip().upper() == target]
        return docs

    def summary(self, start_iso, end_iso, tipos):
        raise AssertionError("not used here")


class SearchTests(unittest.TestCase):
    def test_sql_index_caches_and_dedups(self):
        rows = [
            {"TipoDocumento": "FACTURA", "FechaDocumento": "2026-09-01", "SerieNumero": "F001"},
            {"TipoDocumento": "FACTURA", "FechaDocumento": "2026-09-01", "SerieNumero": "F001"},
        ]
        gw = FakeGateway({("FACTURA", "2026-09-01"): [{"oid": "A1", "number": "F001"}]})
        res = search_by_number(
            FakeReader(rows),
            gw,
            number="F001",
            tipos=[TipoDocumento.FACTURA, TipoDocumento.BOLETA],
            start_iso=None,
            end_iso=None,
            max_range_days=93,
            fallback_days=90,
            today=date(2026, 9, 20),
        )
        self.assertEqual(res["source"], "sql_index")
        self.assertEqual(len(res["results"]), 1)
        self.assertTrue(res["results"][0]["in_sql"])
        self.assertEqual(gw.calls.count(("FACTURA", "2026-09-01", "2026-09-01")), 1)

    def test_graphql_fallback(self):
        gw = FakeGateway({("BOLETA", "2026-09-02"): [{"oid": "B9", "number": "B009"}]})
        res = search_by_number(
            FakeReader([]),
            gw,
            number="B009",
            tipos=[TipoDocumento.BOLETA],
            start_iso=None,
            end_iso=None,
            max_range_days=93,
            fallback_days=90,
            today=date(2026, 9, 20),
        )
        self.assertEqual(res["source"], "graphql_fallback")


class SummarizeTests(unittest.TestCase):
    def test_marks_in_sql(self):
        class Reader(FakeReader):
            def fetch_documents(self, start_iso, end_iso, tipos):
                return [
                    {
                        "IDSynerPos": "A1",
                        "TipoDocumento": "FACTURA",
                        "FechaDocumento": "2026-09-01",
                    }
                ]

        class Gateway(FakeGateway):
            def summary(self, start_iso, end_iso, tipos):
                return {
                    "FACTURA": [{"oid": "A1", "number": "F001", "date": "2026-09-01T10:00:00"}],
                    "BOLETA": [{"oid": "B9", "number": "B009", "date": "2026-09-02T10:00:00"}],
                }

        res = summarize(
            Reader([]),
            Gateway({}),
            start_iso="2026-09-01",
            end_iso="2026-09-07",
            tipos=[TipoDocumento.FACTURA, TipoDocumento.BOLETA],
            max_range_days=93,
        )
        self.assertEqual(res["sql_count"], 1)
        self.assertEqual(res["graphql_count"], 2)
        self.assertTrue(res["documents"]["FACTURA"][0]["in_sql"])
        self.assertFalse(res["documents"]["BOLETA"][0]["in_sql"])


class DetailTests(unittest.TestCase):
    def test_found_and_not_found(self):
        gw = FakeGateway({("BOLETA", "2026-09-02"): [{"oid": "B9", "number": "B009"}]})
        doc = get_detail(gw, tipo=TipoDocumento.BOLETA, oid="B9", doc_date_iso="2026-09-02")
        self.assertEqual(doc["document"]["oid"], "B9")
        with self.assertRaises(NotFoundError):
            get_detail(gw, tipo=TipoDocumento.BOLETA, oid="ZZ", doc_date_iso="2026-09-02")


if __name__ == "__main__":
    unittest.main()
