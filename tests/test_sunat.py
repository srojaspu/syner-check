"""SUNAT flow unit tests with fakes. Stdlib only."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta

from src.application import (
    attach_sunat_status,
    submit_sunat_batch,
    sunat_job_status,
    sunat_revalidate,
)
from src.application.use_cases import _sunat_doc_payload, _sunat_key


class FakeValidator:
    def __init__(self):
        self.submits: list[list[dict]] = []
        self.job = {"trabajo": {"Estado": "COMPLETADO"}, "detalle": []}
        self.single_response: dict = {"ok": True, "resultado": {}}

    def submit_batch(self, documentos, usuario="", origen=""):
        self.submits.append(documentos)
        return {"trabajo_id": 100 + len(self.submits), "cantidad": len(documentos)}

    def job_status(self, trabajo_id, detalle=False):
        return self.job

    def validate_single(self, documento, usuario="", origen=""):
        self.single_doc = documento
        return self.single_response


class FakeStore:
    def __init__(self, rows=None):
        self.rows = dict(rows or {})

    def fetch_many(self, keys):
        return {k: dict(self.rows[k]) for k in keys if k in self.rows}

    def upsert(self, row):
        key = (row["Ruc"], row["Tipo"], row["Serie"], row["Numero"])
        self.rows[key] = dict(row)


def _row(estado="ACEPTADO", seen=None):
    return {
        "Estado": estado,
        "FechaConsulta": seen or "2026-10-17T10:00:00",
        "Intentos": "1",
    }


class KeyTests(unittest.TestCase):
    def test_split_and_codes(self):
        self.assertEqual(
            _sunat_key("12345678901", "BOLETA", "bs05-00000105"),
            ("12345678901", "03", "BS05", "105"),
        )
        self.assertEqual(
            _sunat_key("12345678901", "NOTA DE CREDITO", "BS05-105"),
            ("12345678901", "07", "BS05", "105"),
        )
        self.assertIsNone(_sunat_key("12345678901", "BOLETA", "SIN-GUION-NO"))
        self.assertIsNone(_sunat_key("12345678901", "LETRAS", "B01-1"))

    def test_payload_validates(self):
        payload = _sunat_doc_payload(
            "12345678901", "FACTURA", "F001-123", "2026-10-15", 284.38
        )
        self.assertEqual(payload["tipo"], "01")
        self.assertEqual(payload["importe"], 284.38)
        with self.assertRaises(ValueError):
            _sunat_doc_payload("123", "FACTURA", "F001-1", "2026-10-15", 10)
        with self.assertRaises(ValueError):
            _sunat_doc_payload(
                "12345678901", "FACTURA", "F001-1", "2026-10-15", "NaN-x"
            )


class SubmitTests(unittest.TestCase):
    NOW = datetime(2026, 10, 17, 12, 0, 0)

    def _doc(self, number="BS05-00000105", tipo="BOLETA"):
        return {
            "tipo": tipo,
            "number": number,
            "date": "2026-10-15T10:00:00",
            "crossTotal": 100.0,
        }

    def test_skips_terminal_cached(self):
        store = FakeStore({
            ("20101031773", "03", "BS05", "105"): _row("ACEPTADO")
        })
        validator = FakeValidator()
        res = submit_sunat_batch(
            validator,
            store,
            documentos=[self._doc()],
            usuario="u@x.pe",
            ruc="20101031773",
            now=self.NOW,
        )
        self.assertEqual(res["enviados"], 0)
        self.assertEqual(validator.submits, [])
        self.assertEqual(res["omitidos"]["cache_terminal"], 1)

    def test_submits_missing_and_records_pending(self):
        validator = FakeValidator()
        store = FakeStore()
        res = submit_sunat_batch(
            validator,
            store,
            documentos=[self._doc(), {**self._doc(), "number": "BS05-00000106"}],
            usuario="u@x.pe",
            ruc="20101031773",
            now=self.NOW,
        )
        self.assertEqual(res["enviados"], 2)
        self.assertEqual(len(validator.submits), 1)
        self.assertEqual(validator.submits[0][0]["forzar_consulta"], False)
        key = ("20101031773", "03", "BS05", "105")
        self.assertEqual(store.rows[key]["Estado"], "PENDIENTE")
        self.assertEqual(store.rows[key]["TrabajoID"], 101)

    def test_revalidates_stale_but_not_fresh(self):
        old = (self.NOW - timedelta(hours=30)).isoformat(timespec="seconds")
        fresh = (self.NOW - timedelta(hours=1)).isoformat(timespec="seconds")
        store = FakeStore({
            ("20101031773", "03", "BS05", "105"): _row("NO_EXISTE", old),
            ("20101031773", "03", "BS05", "106"): _row("NO_EXISTE", fresh),
        })
        docs = [self._doc(), {**self._doc(), "number": "BS05-00000106"}]
        res = submit_sunat_batch(
            FakeValidator(), store, documentos=docs,
            usuario="u", ruc="20101031773", now=self.NOW,
        )
        self.assertEqual(res["enviados"], 1)

    def test_chunks_and_limit(self):
        docs = [
            {**self._doc(), "number": f"BS05-{i:08d}"} for i in range(501)
        ]
        validator = FakeValidator()
        res = submit_sunat_batch(
            validator, FakeStore(), documentos=docs,
            usuario="u", ruc="20101031773", now=self.NOW,
        )
        self.assertEqual(len(validator.submits), 2)
        self.assertEqual(res["enviados"], 501)
        with self.assertRaises(ValueError):
            submit_sunat_batch(
                FakeValidator(), FakeStore(),
                documentos=[self._doc()] * 2001,
                usuario="u", ruc="20101031773", now=self.NOW,
            )

    def test_invalid_docs_reported(self):
        res = submit_sunat_batch(
            FakeValidator(), FakeStore(),
            documentos=[{"tipo": "BOLETA", "number": "???", "date": "x"}],
            usuario="u", ruc="20101031773", now=self.NOW,
        )
        self.assertEqual(res["enviados"], 0)
        self.assertEqual(len(res["omitidos"]["invalidos"]), 1)


class JobStatusTests(unittest.TestCase):
    def test_persists_ok_and_error(self):
        validator = FakeValidator()
        validator.job = {
            "trabajo": {"Estado": "COMPLETADO_ERROR", "Total": 2, "Procesados": 2},
            "detalle": [
                {"Estado": "OK", "RUCEmisor": "R", "TipoComprobante": "03",
                 "Serie": "BS05",
                 "Numero": "00000105", "ResultadoEstado": "ACEPTADO",
                 "ConsultaID": 7, "CodigoSunat": "1"},
                {"Estado": "OK", "Ruc": "R", "Tipo": "03", "Serie": "BS05",
                 "Numero": "00000106", "ResultadoEstado": "WEIRD",
                 "ConsultaID": 8},
                {"Estado": "ERROR", "RUCEmisor": "R", "TipoComprobante": "03",
                 "Serie": "BS05",
                 "Numero": "00000107", "Mensaje": "timeout"},
                {"Estado": "PENDIENTE", "RUCEmisor": "R", "TipoComprobante": "03",
                 "Serie": "BS05", "Numero": "1"},
            ],
        }
        store = FakeStore()
        res = sunat_job_status(validator, store, trabajo_id=5, usuario="u")
        self.assertEqual(res["estado"], "COMPLETADO_ERROR")
        self.assertEqual(store.rows[("R", "03", "BS05", "105")]["Estado"], "ACEPTADO")
        self.assertEqual(store.rows[("R", "03", "BS05", "106")]["Estado"], "DESCONOCIDO")
        self.assertEqual(store.rows[("R", "03", "BS05", "107")]["Estado"], "ERROR")
        self.assertNotIn(("R", "03", "BS05", "1"), store.rows)
        self.assertEqual(len(res["resultados"]), 3)

    def test_stripped_echo_matches(self):
        # El worker puede devolver el numero sin ceros ("152");
        # la llave normalizada debe coincidir igual.
        validator = FakeValidator()
        validator.job = {
            "trabajo": {"Estado": "COMPLETADO", "Total": 1, "Procesados": 1},
            "detalle": [
                {"Estado": "OK", "Ruc": "R", "Tipo": "03", "Serie": "bs32",
                 "Numero": "152", "ResultadoEstado": "ACEPTADO",
                 "ConsultaID": 9},
            ],
        }
        store = FakeStore()
        res = sunat_job_status(validator, store, trabajo_id=6, usuario="u")
        self.assertEqual(
            store.rows[("R", "03", "BS32", "152")]["Estado"], "ACEPTADO"
        )
        self.assertEqual(res["resultados"][0]["estado"], "ACEPTADO")


class AttachTests(unittest.TestCase):
    def test_attach_and_missing(self):
        store = FakeStore({("R", "03", "BS05", "105"): _row("ANULADO")})
        entries = [
            {"tipo": "BOLETA", "number": "BS05-00000105", "date": "2026-10-15"},
            {"tipo": "BOLETA", "number": "BS05-9", "date": "2026-10-15"},
        ]
        attach_sunat_status(entries, store, "R")
        self.assertEqual(entries[0]["sunat"]["estado"], "ANULADO")
        self.assertIsNone(entries[1]["sunat"])

    def test_store_failure_degrades(self):
        class Broken:
            def fetch_many(self, keys):
                raise RuntimeError("down")

        entries = [{"tipo": "BOLETA", "number": "BS05-1", "date": "2026-10-15"}]
        attach_sunat_status(entries, Broken(), "R")
        self.assertIsNone(entries[0]["sunat"])


class RevalidateTests(unittest.TestCase):
    def test_forces_and_persists(self):
        validator = FakeValidator()
        validator.single_response = {
            "ok": True,
            "consulta_id": 42,
            "correlation_id": "c1",
            "resultado": {
                "estado": "ACEPTADO",
                "codigo_sunat": "1",
                "ruc_estado": "ACTIVO",
                "ruc_condicion": "HABIDO",
                "observaciones": [],
            },
        }
        store = FakeStore()
        res = sunat_revalidate(
            validator, store, tipo="BOLETA", number="BS05-1",
            date_iso="2026-10-15", importe=50, usuario="u",
            ruc="20101031773",
        )
        self.assertEqual(res["estado"], "ACEPTADO")
        self.assertTrue(validator.single_doc["forzar_consulta"])
        key = ("20101031773", "03", "BS05", "1")
        self.assertEqual(store.rows[key]["Estado"], "ACEPTADO")
        self.assertEqual(store.rows[key]["ConsultaID"], 42)


if __name__ == "__main__":
    unittest.main()
