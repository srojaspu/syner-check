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
        self.summary_calls: list[tuple[str, str, tuple]] = []
        self.serie_calls: list[tuple[str, str]] = []
        self.detail_serie_calls: list[tuple[str, str]] = []

    def detail(self, tipo, start_iso, end_iso, number=None):
        self.calls.append((tipo, start_iso, end_iso))
        docs = self.docs_by_key.get((tipo, start_iso), [])
        if number:
            target = number.strip().upper()
            return [d for d in docs if str(d.get("number", "")).strip().upper() == target]
        return docs

    def summary(self, start_iso, end_iso, tipos):
        self.summary_calls.append((start_iso, end_iso, tuple(tipos)))
        out: dict[str, list[dict]] = {t: [] for t in tipos}
        for (tipo, doc_date), docs in self.docs_by_key.items():
            if tipo in out and start_iso <= doc_date <= end_iso:
                out[tipo].extend(docs)
        return out

    def search_by_serie(self, tipo, number):
        self.serie_calls.append((tipo, number))
        prefix = (number or "").strip().upper()
        out = []
        for (t, _date), docs in self.docs_by_key.items():
            if t == tipo:
                for d in docs:
                    if str(d.get("number", "")).strip().upper().startswith(prefix):
                        out.append(d)
        return out

    def detail_by_serie(self, tipo, number):
        self.detail_serie_calls.append((tipo, number))
        prefix = (number or "").strip().upper()
        out = []
        for (t, _date), docs in self.docs_by_key.items():
            if t == tipo:
                for d in docs:
                    if str(d.get("number", "")).strip().upper().startswith(prefix):
                        out.append(d)
        return out


class SearchTests(unittest.TestCase):
    def test_sql_index_caches_and_dedups(self):
        rows = [
            {"IDSynerPos": "A1", "TipoDocumento": "FACTURA", "FechaDocumento": "2026-09-01", "SerieNumero": "F001"},
            {"IDSynerPos": "A1", "TipoDocumento": "FACTURA", "FechaDocumento": "2026-09-01", "SerieNumero": "F001"},
        ]
        gw = FakeGateway({("FACTURA", "2026-09-01"): [
            {"oid": "A1", "number": "F001"},
            {"oid": "A2", "number": "F001"},
        ]})
        res = search_by_number(
            FakeReader(rows),
            gw,
            number="F001",
            fallback_days=90,
            today=date(2026, 9, 20),
        )
        self.assertEqual(res["source"], "sql_index")
        self.assertEqual(len(res["results"]), 2)
        by_oid = {r["oid"]: r for r in res["results"]}
        self.assertTrue(by_oid["A1"]["in_sql"])
        self.assertFalse(by_oid["A2"]["in_sql"])
        # serie is used for FACTURA/BOLETA (once per tipo, not per SQL row)
        self.assertIn(("FACTURA", "F001"), gw.serie_calls)
        self.assertIn(("BOLETA", "F001"), gw.serie_calls)

    def test_graphql_fallback(self):
        gw = FakeGateway({("BOLETA", "2026-09-02"): [{"oid": "B9", "number": "B009"}]})
        res = search_by_number(
            FakeReader([]),
            gw,
            number="B009",
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
        doc = get_detail(
            gw,
            tipo=TipoDocumento.BOLETA,
            oid="B9",
            doc_date_iso="2026-09-02",
            number="B009",
        )
        self.assertEqual(doc["document"]["oid"], "B9")
        self.assertIn(("BOLETA", "B009"), gw.detail_serie_calls)
        with self.assertRaises(NotFoundError):
            get_detail(
                gw,
                tipo=TipoDocumento.BOLETA,
                oid="ZZ",
                doc_date_iso="2026-09-02",
                number="B009",
            )


if __name__ == "__main__":
    unittest.main()
