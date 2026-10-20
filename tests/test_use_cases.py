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
            {
                "IDSynerPos": "A1",
                "TipoDocumento": "FACTURA",
                "FechaDocumento": "2026-09-01",
                "SerieNumero": "F001",
            },
            {
                "IDSynerPos": "A1",
                "TipoDocumento": "FACTURA",
                "FechaDocumento": "2026-09-01",
                "SerieNumero": "F001",
            },
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


class NumberIntelisisTests(unittest.TestCase):
    def _intelisis(self, rows=None, fail=False):
        class Intelisis:
            def __init__(self):
                self.dates: list[tuple[str, str]] = []

            def fetch_headers(self, start_iso, end_iso):
                self.dates.append((start_iso, end_iso))
                if fail:
                    raise RuntimeError("boom")
                return [r for r in (rows or []) if start_iso <= r["FechaEmision"] <= end_iso]

        return Intelisis()

    def test_marks_in_intelisis(self):
        rows = [
            {
                "IDSynerPos": "A1",
                "TipoDocumento": "FACTURA",
                "FechaDocumento": "2026-09-01",
                "SerieNumero": "F001-1",
            },
        ]
        gw = FakeGateway({("FACTURA", "2026-09-01"): [
            {"oid": "A1", "number": "F001-1", "date": "2026-09-01T10:00:00"},
        ]})
        intel = self._intelisis([
            {"IntelisisID": "1", "Mov": "SE-Factura", "MovID": "X",
             "StoreName": "T", "TransactionType": "factura",
             "ReceiptNumber": "F001-00000001", "FechaEmision": "2026-09-01",
             "EstatusIntelisis": "CANCELADO", "SerieSUNAT": "", "TipoDocSUNAT": "01"},
        ])
        res = search_by_number(
            FakeReader(rows),
            gw,
            number="F001-1",
            fallback_days=90,
            today=date(2026, 9, 20),
            intelisis=intel,
        )
        self.assertTrue(res["intelisis_enabled"])
        self.assertEqual(intel.dates, [("2026-09-01", "2026-09-01")])
        hit = res["results"][0]
        self.assertTrue(hit["in_intelisis"])
        self.assertEqual(hit["intelisis"]["EstatusIntelisis"], "CANCELADO")

    def test_degraded(self):
        gw = FakeGateway({("BOLETA", "2026-09-02"): [
            {"oid": "B9", "number": "B009", "date": "2026-09-02T10:00:00"},
        ]})
        res = search_by_number(
            FakeReader([]),
            gw,
            number="B009",
            fallback_days=1,
            today=date(2026, 9, 20),
            intelisis=self._intelisis(fail=True),
        )
        self.assertFalse(res["intelisis_enabled"])
        self.assertEqual(res["intelisis_warning"], "intelisis_unavailable")
        self.assertFalse(res["results"][0]["in_intelisis"])

    def test_same_number_across_years_is_not_collapsed(self):
        """SerieNumero is reused yearly: both documents must be returned."""
        rows = [
            {
                "IDSynerPos": "A2024",
                "TipoDocumento": "FACTURA",
                "FechaDocumento": "2024-05-01",
                "SerieNumero": "F001-1",
            },
            {
                "IDSynerPos": "A2025",
                "TipoDocumento": "FACTURA",
                "FechaDocumento": "2025-05-01",
                "SerieNumero": "F001-1",
            },
        ]
        gw = FakeGateway(
            {
                ("FACTURA", "2024-05-01"): [
                    {"oid": "A2024", "number": "F001-1", "date": "2024-05-01T10:00:00"}
                ],
                ("FACTURA", "2025-05-01"): [
                    {"oid": "A2025", "number": "F001-1", "date": "2025-05-01T10:00:00"}
                ],
            }
        )
        res = search_by_number(
            FakeReader(rows),
            gw,
            number="F001-1",
            fallback_days=90,
            today=date(2026, 9, 20),
        )
        self.assertEqual({r["oid"] for r in res["results"]}, {"A2024", "A2025"})
        self.assertTrue(all(r["in_sql"] for r in res["results"]))
        self.assertEqual(
            {r["date"][:10] for r in res["results"]}, {"2024-05-01", "2025-05-01"}
        )


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
        # Backward compatible: triple flow defaults to degraded.
        self.assertFalse(res["intelisis_enabled"])
        self.assertEqual(res["intelisis_count"], 0)
        self.assertFalse(res["documents"]["FACTURA"][0]["in_intelisis"])


class TripleFlowTests(unittest.TestCase):
    def _reader(self, rows):
        class Reader(FakeReader):
            def fetch_documents(self, start_iso, end_iso, tipos):
                return rows

        return Reader([])

    def _gateway(self, docs):
        class Gateway(FakeGateway):
            def summary(self, start_iso, end_iso, tipos):
                return docs

        return Gateway({})

    def _intelisis(self, rows=None, fail=False):
        class Intelisis:
            def fetch_headers(self, start_iso, end_iso):
                if fail:
                    raise RuntimeError("boom")
                return rows or []

        return Intelisis()

    def test_full_and_missing(self):
        from src.application.use_cases import _norm_receipt

        self.assertEqual(_norm_receipt("F001-00000123"), "F1-123")
        self.assertEqual(_norm_receipt("f001-123 "), "F1-123")
        res = summarize(
            self._reader([
                {"IDSynerPos": "A1", "TipoDocumento": "FACTURA",
                 "FechaDocumento": "2026-09-01"},
            ]),
            self._gateway({
                "FACTURA": [
                    {"oid": "A1", "number": "F001-00000123",
                     "date": "2026-09-01T10:00:00"},
                    {"oid": "A2", "number": "F001-00000124",
                     "date": "2026-09-01T11:00:00"},
                ],
            }),
            start_iso="2026-09-01",
            end_iso="2026-09-01",
            tipos=[TipoDocumento.FACTURA],
            max_range_days=93,
            intelisis=self._intelisis([
                {"IntelisisID": "99", "Mov": "SE-Factura",
                 "MovID": "X-F001-00000123", "StoreName": "TIENDA",
                 "TransactionType": "factura",
                 "ReceiptNumber": "F001-123",
                 "FechaEmision": "2026-09-01",
                 "EstatusIntelisis": "CONCLUIDO",
                 "SerieSUNAT": "001", "TipoDocSUNAT": "01"},
            ]),
        )
        docs = res["documents"]["FACTURA"]
        self.assertTrue(res["intelisis_enabled"])
        self.assertEqual(res["intelisis_count"], 1)
        self.assertTrue(docs[0]["in_sql"])
        self.assertTrue(docs[0]["in_intelisis"])
        self.assertEqual(docs[0]["intelisis"]["MovID"], "X-F001-00000123")
        self.assertFalse(docs[1]["in_intelisis"])
        flow = res["flow"]["per_tipo"]["FACTURA"]
        self.assertEqual(flow["graphql"], 2)
        self.assertEqual(flow["in_mov"], 1)
        self.assertEqual(flow["in_intelisis"], 1)
        self.assertEqual(flow["full"], 1)
        self.assertEqual(flow["missing_in_intelisis"], 1)

    def test_nota_credito_maps(self):
        res = summarize(
            self._reader([]),
            self._gateway({
                "NOTA DE CREDITO": [
                    {"oid": "N1", "number": "N001-7",
                     "date": "2026-09-01T10:00:00"},
                ],
            }),
            start_iso="2026-09-01",
            end_iso="2026-09-01",
            tipos=[TipoDocumento.NOTA_DE_CREDITO],
            max_range_days=93,
            intelisis=self._intelisis([
                {"IntelisisID": "5", "Mov": "SE-Nota Credito",
                 "MovID": "Y-N001-00000007", "StoreName": "T",
                 "TransactionType": "nota_credito",
                 "ReceiptNumber": "N001-00000007",
                 "FechaEmision": "2026-09-01",
                 "EstatusIntelisis": "CONCLUIDO",
                 "SerieSUNAT": "", "TipoDocSUNAT": "07"},
            ]),
        )
        doc = res["documents"]["NOTA DE CREDITO"][0]
        self.assertTrue(doc["in_intelisis"])

    def test_nc_b_prefix_and_pendiente(self):
        # Caso real 2026-10-15: las NC de SynerPOS usan prefijo B
        # (MovID '<suc>-B<correlativo>') y Venta PENDIENTE debe contar
        # como pendiente, no como ausente ni como completo.
        res = summarize(
            self._reader([
                {"IDSynerPos": "N1", "TipoDocumento": "NOTA DE CREDITO",
                 "FechaDocumento": "2026-10-15"},
                {"IDSynerPos": "B1", "TipoDocumento": "BOLETA",
                 "FechaDocumento": "2026-10-15"},
            ]),
            self._gateway({
                "NOTA DE CREDITO": [
                    {"oid": "N1", "number": "BS05-00000105",
                     "date": "2026-10-15T10:00:00"},
                ],
                "BOLETA": [
                    {"oid": "B1", "number": "BS02-00003037",
                     "date": "2026-10-15T11:00:00"},
                ],
            }),
            start_iso="2026-10-15",
            end_iso="2026-10-15",
            tipos=[TipoDocumento.NOTA_DE_CREDITO, TipoDocumento.BOLETA],
            max_range_days=93,
            intelisis=self._intelisis([
                {"IntelisisID": "7", "Mov": "SE-Nota Credito",
                 "MovID": "105-B00000105", "StoreName": "T",
                 "TransactionType": "nota_credito",
                 "ReceiptNumber": "BS05-00000105",
                 "FechaEmision": "2026-10-15",
                 "EstatusIntelisis": "CONCLUIDO",
                 "SerieSUNAT": "", "TipoDocSUNAT": "07"},
                {"IntelisisID": "8", "Mov": "SE-Boleta",
                 "MovID": "102-00003037", "StoreName": "T",
                 "TransactionType": "boleta",
                 "ReceiptNumber": "BS02-00003037",
                 "FechaEmision": "2026-10-15",
                 "EstatusIntelisis": "PENDIENTE",
                 "SerieSUNAT": "", "TipoDocSUNAT": "03"},
            ]),
        )
        nc = res["documents"]["NOTA DE CREDITO"][0]
        bo = res["documents"]["BOLETA"][0]
        self.assertTrue(nc["in_intelisis"])
        self.assertEqual(nc["intelisis"]["EstatusIntelisis"], "CONCLUIDO")
        self.assertTrue(bo["in_intelisis"])
        flow_nc = res["flow"]["per_tipo"]["NOTA DE CREDITO"]
        flow_bo = res["flow"]["per_tipo"]["BOLETA"]
        self.assertEqual(flow_nc["full"], 1)
        self.assertEqual(flow_nc["pending_in_intelisis"], 0)
        self.assertEqual(flow_bo["full"], 0)
        self.assertEqual(flow_bo["pending_in_intelisis"], 1)
        self.assertEqual(flow_bo["missing_in_intelisis"], 0)
        self.assertEqual(res["flow"]["totals"]["pending_in_intelisis"], 1)

    def test_degraded_on_failure(self):
        res = summarize(
            self._reader([]),
            self._gateway({"FACTURA": [
                {"oid": "A1", "number": "F1-1",
                 "date": "2026-09-01T10:00:00"},
            ]}),
            start_iso="2026-09-01",
            end_iso="2026-09-01",
            tipos=[TipoDocumento.FACTURA],
            max_range_days=93,
            intelisis=self._intelisis(fail=True),
        )
        self.assertFalse(res["intelisis_enabled"])
        self.assertEqual(res["intelisis_warning"], "intelisis_unavailable")
        self.assertFalse(res["documents"]["FACTURA"][0]["in_intelisis"])

    def test_cancelado_state(self):
        res = summarize(
            self._reader([
                {"IDSynerPos": "C1", "TipoDocumento": "BOLETA",
                 "FechaDocumento": "2026-10-15"},
            ]),
            self._gateway({
                "BOLETA": [
                    {"oid": "C1", "number": "BS20-1",
                     "date": "2026-10-15T10:00:00"},
                ],
            }),
            start_iso="2026-10-15",
            end_iso="2026-10-15",
            tipos=[TipoDocumento.BOLETA],
            max_range_days=93,
            intelisis=self._intelisis([
                {"IntelisisID": "9", "Mov": "SE-Boleta",
                 "MovID": "144-1", "StoreName": "T",
                 "TransactionType": "boleta",
                 "ReceiptNumber": "BS20-1",
                 "FechaEmision": "2026-10-15",
                 "EstatusIntelisis": "CANCELADO",
                 "SerieSUNAT": "", "TipoDocSUNAT": "03"},
            ]),
        )
        doc = res["documents"]["BOLETA"][0]
        self.assertTrue(doc["in_intelisis"])
        flow = res["flow"]["per_tipo"]["BOLETA"]
        self.assertEqual(flow["full"], 0)
        self.assertEqual(flow["pending_in_intelisis"], 0)
        self.assertEqual(flow["cancelled_in_intelisis"], 1)
        self.assertEqual(flow["missing_in_intelisis"], 0)


class FlowStageBreakdownTests(unittest.TestCase):
    RUC = "20123456789"

    def _reader(self):
        class Reader(FakeReader):
            def fetch_documents(self, start_iso, end_iso, tipos):
                return []

        return Reader([])

    def _gateway(self, docs):
        class Gateway(FakeGateway):
            def summary(self, start_iso, end_iso, tipos):
                return docs

        return Gateway({})

    def _intelisis(self, rows):
        class Intelisis:
            def fetch_headers(self, start_iso, end_iso):
                return rows

        return Intelisis()

    def _sunat_store(self, rows):
        class Store:
            def fetch_many(self, keys):
                return {key: rows[key] for key in keys if key in rows}

        return Store()

    def _summary(self):
        from src.application.use_cases import _sunat_key

        docs = {
            "FACTURA": [
                {"oid": "A1", "number": "F001-00000001",
                 "date": "2026-10-15T10:00:00", "contactName": "Uno",
                 "crossTotal": 10},
                {"oid": "A2", "number": "F001-00000002",
                 "date": "2026-10-15T11:00:00", "contactName": "Dos",
                 "crossTotal": 20},
                {"oid": "A3", "number": "F001-00000003",
                 "date": "2026-10-15T12:00:00", "contactName": "Tres",
                 "crossTotal": 30},
                {"oid": "A4", "number": "F001-00000004",
                 "date": "2026-10-15T13:00:00", "contactName": "Cuatro",
                 "crossTotal": 40},
            ]
        }
        intelisis = [
            {"IntelisisID": "1", "Mov": "SE-Factura",
             "MovID": "X-1", "StoreName": "T",
             "TransactionType": "factura",
             "ReceiptNumber": "F001-00000001",
             "FechaEmision": "2026-10-15",
             "EstatusIntelisis": "CONCLUIDO"},
            {"IntelisisID": "2", "Mov": "SE-Factura",
             "MovID": "X-2", "StoreName": "T",
             "TransactionType": "factura",
             "ReceiptNumber": "F001-00000002",
             "FechaEmision": "2026-10-15",
             "EstatusIntelisis": "PENDIENTE"},
            {"IntelisisID": "3", "Mov": "SE-Factura",
             "MovID": "X-3", "StoreName": "T",
             "TransactionType": "factura",
             "ReceiptNumber": "F001-00000003",
             "FechaEmision": "2026-10-15",
             "EstatusIntelisis": "CANCELADO"},
        ]
        keys = {
            "F001-00000001": "ACEPTADO",
            "F001-00000002": "NO_EXISTE",
            "F001-00000003": "PENDIENTE",
        }
        sunat_rows = {
            _sunat_key(self.RUC, "FACTURA", number): {
                "Estado": estado,
                "FechaConsulta": "2026-10-15 14:00:00",
            }
            for number, estado in keys.items()
        }
        args = dict(
            start_iso="2026-10-15",
            end_iso="2026-10-15",
            tipos=[TipoDocumento.FACTURA],
            max_range_days=93,
            intelisis=self._intelisis(intelisis),
            sunat_store=self._sunat_store(sunat_rows),
            sunat_ruc=self.RUC,
        )
        return args, docs

    def test_stage_counts_match_requested_states(self):
        args, docs = self._summary()
        res = summarize(self._reader(), self._gateway(docs), **args)

        intelisis = res["flow"]["stages"]["intelisis"]
        self.assertEqual(
            {state["key"]: state["count"] for state in intelisis["states"]},
            {"completo": 1, "pendiente": 1, "cancelado": 1, "ausente": 1},
        )

        sunat = res["flow"]["stages"]["sunat"]
        self.assertTrue(res["sunat_enabled"])
        self.assertEqual(sunat["total"], 4)
        self.assertEqual(sunat["consulted"], 3)
        self.assertEqual(
            {state["key"]: state["count"] for state in sunat["states"]},
            {
                "aceptado": 1,
                "no_existe": 1,
                "anulado": 0,
                "autorizado": 0,
                "no_autorizado": 0,
                "error": 0,
                "en_proceso": 1,
                "sin_consultar": 1,
                "desconocido": 0,
            },
        )

    def test_each_document_is_tagged_with_its_flow_states(self):
        args, docs = self._summary()
        res = summarize(self._reader(), self._gateway(docs), **args)
        rows = [
            entry
            for documents in res["documents"].values()
            for entry in documents
        ]

        self.assertEqual(len(rows), 4)
        self.assertEqual(
            {row["number"]: row["flow_states"] for row in rows},
            {
                "F001-00000001": {
                    "intelisis": "completo",
                    "sunat": "aceptado",
                },
                "F001-00000002": {
                    "intelisis": "pendiente",
                    "sunat": "no_existe",
                },
                "F001-00000003": {
                    "intelisis": "cancelado",
                    "sunat": "en_proceso",
                },
                "F001-00000004": {
                    "intelisis": "ausente",
                    "sunat": "sin_consultar",
                },
            },
        )


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
