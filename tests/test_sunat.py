"""SUNAT flow unit tests with fakes. Stdlib only."""

from __future__ import annotations

import asyncio
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from src.application import (
    attach_sunat_status,
    reconcile_pending_sunat_jobs,
    submit_sunat_batch,
    sunat_job_status,
    sunat_revalidate,
)
from src.application.sunat_worker import run_sunat_reconcile_worker
from src.application.sunat_submission import (
    SunatSubmissionRegistry,
    submission_fingerprint,
)
from src.application.use_cases import _sunat_doc_payload, _sunat_key
from src.domain.errors import UpstreamError


class FakeValidator:
    def __init__(self):
        self.submits: list[list[dict]] = []
        self.job = {"trabajo": {"Estado": "COMPLETADO"}, "detalle": []}
        self.summary: dict | None = None
        self.status_error: Exception | None = None
        self.submit_error: Exception | None = None
        self.detail_calls = 0
        self.summary_calls = 0
        self.single_response: dict = {"ok": True, "resultado": {}}

    def submit_batch(self, documentos, usuario="", origen=""):
        if self.submit_error is not None:
            raise self.submit_error
        self.submits.append(documentos)
        return {"trabajo_id": 100 + len(self.submits), "cantidad": len(documentos)}

    def job_status(self, trabajo_id, detalle=False):
        if self.status_error is not None:
            raise self.status_error
        if detalle:
            self.detail_calls += 1
            return self.job
        self.summary_calls += 1
        return self.summary if self.summary is not None else self.job

    def validate_single(self, documento, usuario="", origen=""):
        self.single_doc = documento
        return self.single_response


class FakeStore:
    def __init__(self, rows=None):
        self.rows = dict(rows or {})
        self.fetch_calls = 0
        self.upsert_calls = 0
        self.upsert_many_calls = 0
        self.mark_missing_calls = 0
        self.mark_stale_calls = 0
        self.fetch_error: Exception | None = None

    def fetch_many(self, keys):
        self.fetch_calls += 1
        if self.fetch_error is not None:
            raise self.fetch_error
        return {k: dict(self.rows[k]) for k in keys if k in self.rows}

    def upsert(self, row):
        self.upsert_calls += 1
        key = (row["Ruc"], row["Tipo"], row["Serie"], row["Numero"])
        self.rows[key] = dict(row)

    def upsert_many(self, rows):
        self.upsert_many_calls += 1
        for row in rows:
            key = (row["Ruc"], row["Tipo"], row["Serie"], row["Numero"])
            self.rows[key] = dict(row)

    def _job_rows(self, trabajo_id):
        return [
            row
            for row in self.rows.values()
            if int(row.get("TrabajoID") or 0) == int(trabajo_id)
        ]

    def job_progress(self, trabajo_id):
        rows = self._job_rows(trabajo_id)
        estados = [str(row.get("Estado", "")).upper() for row in rows]
        return {
            "total": len(rows),
            "pendientes": sum(e in ("PENDIENTE", "PROCESANDO") for e in estados),
            "errores": sum(e == "ERROR" for e in estados),
            "exitosos": sum(
                e in ("ACEPTADO", "ANULADO", "NO_EXISTE", "AUTORIZADO",
                      "NO_AUTORIZADO")
                for e in estados
            ),
        }

    def pending_jobs(self, limit=50):
        by_job: dict[int, dict] = {}
        for row in self.rows.values():
            job_id = row.get("TrabajoID")
            if job_id is None:
                continue
            estado = str(row.get("Estado", "")).upper()
            item = by_job.setdefault(
                int(job_id), {"TrabajoID": int(job_id), "total": 0, "pendientes": 0}
            )
            item["total"] += 1
            if estado in ("PENDIENTE", "PROCESANDO"):
                item["pendientes"] += 1
        return [
            item
            for item in by_job.values()
            if item["pendientes"] > 0
        ][:limit]

    def mark_job_missing(self, trabajo_id, message):
        self.mark_missing_calls += 1
        affected = 0
        for row in self._job_rows(trabajo_id):
            if str(row.get("Estado", "")).upper() in ("PENDIENTE", "PROCESANDO"):
                row["Estado"] = "ERROR"
                row["UltimoError"] = message
                affected += 1
        return affected

    def mark_stale_unsubmitted(self, older_than_minutes, message):
        self.mark_stale_calls += 1
        return 0


class RacingStore(FakeStore):
    """Force two submit calls to read an empty cache before either claims."""

    def __init__(self):
        super().__init__()
        self.first_fetch = threading.Barrier(2)
        self._seen: set[int] = set()
        self._seen_lock = threading.Lock()

    def fetch_many(self, keys):
        ident = threading.get_ident()
        with self._seen_lock:
            first = ident not in self._seen
            self._seen.add(ident)
        if first:
            self.first_fetch.wait(timeout=5)
        return super().fetch_many(keys)


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
        self.assertEqual(payload["numero"], "123")
        self.assertEqual(payload["importe"], 284.38)
        with_zeros = _sunat_doc_payload(
            "12345678901", "BOLETA", "BS05-00000105", "2026-10-15", 10
        )
        self.assertEqual(with_zeros["numero"], "00000105")
        self.assertEqual(
            _sunat_key("12345678901", "BOLETA", "BS05-00000105"),
            ("12345678901", "03", "BS05", "105"),
        )
        with self.assertRaises(ValueError):
            _sunat_doc_payload("123", "FACTURA", "F001-1", "2026-10-15", 10)
        with self.assertRaises(ValueError):
            _sunat_doc_payload(
                "12345678901", "FACTURA", "F001-1", "2026-10-15", "NaN-x"
            )
        for bad in ("NaN", "inf", "-inf"):
            with self.assertRaises(ValueError):
                _sunat_doc_payload(
                    "12345678901", "FACTURA", "F001-1", "2026-10-15", bad
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
        self.assertEqual(res["omitidos"]["aceptados"], 1)

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
        # Claim before submit + stamp the job id: two batched writes, never one
        # connection per document (claims and ids are written transactionally).
        self.assertEqual(store.upsert_many_calls, 2)
        self.assertEqual(store.upsert_calls, 0)
        key = ("20101031773", "03", "BS05", "105")
        self.assertEqual(store.rows[key]["Estado"], "PENDIENTE")
        self.assertEqual(store.rows[key]["TrabajoID"], 101)

    def test_concurrent_clients_submit_each_document_once(self):
        store = RacingStore()
        validator = FakeValidator()
        validator.job = {
            "trabajo": {"Estado": "COMPLETADO", "Total": 1, "Procesados": 1},
            "detalle": [{
                "Estado": "OK",
                "Ruc": "20101031773",
                "Tipo": "03",
                "Serie": "BS05",
                "Numero": "105",
                "ResultadoEstado": "ACEPTADO",
            }],
        }

        def run():
            return submit_sunat_batch(
                validator,
                store,
                documentos=[self._doc()],
                usuario="u",
                ruc="20101031773",
                now=self.NOW,
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [future.result() for future in (
                pool.submit(run),
                pool.submit(run),
            )]

        self.assertEqual(len(validator.submits), 1)
        self.assertEqual(sum(result["enviados"] for result in results), 1)
        self.assertEqual(
            sorted(result["enviados"] for result in results),
            [0, 1],
        )

    def test_default_rechecks_non_accepted_even_if_recent(self):
        fresh = (self.NOW - timedelta(hours=1)).isoformat(timespec="seconds")
        store = FakeStore({
            ("20101031773", "03", "BS05", "105"): _row("NO_EXISTE", fresh),
        })
        validator = FakeValidator()
        res = submit_sunat_batch(
            validator, store, documentos=[self._doc()],
            usuario="u", ruc="20101031773", now=self.NOW,
        )
        self.assertEqual(res["enviados"], 1)
        self.assertEqual(validator.submits[0][0]["forzar_consulta"], False)

    def test_all_forces_accepted_and_cache(self):
        key = ("20101031773", "03", "BS05", "105")
        store = FakeStore({key: _row("ACEPTADO")})
        validator = FakeValidator()
        res = submit_sunat_batch(
            validator,
            store,
            documentos=[self._doc()],
            usuario="u",
            ruc="20101031773",
            now=self.NOW,
            alcance="todos",
        )
        self.assertEqual(res["enviados"], 1)
        self.assertEqual(res["omitidos"]["aceptados"], 0)
        self.assertEqual(validator.submits[0][0]["forzar_consulta"], True)

    def test_invalid_scope_is_rejected(self):
        with self.assertRaises(ValueError):
            submit_sunat_batch(
                FakeValidator(),
                FakeStore(),
                documentos=[self._doc()],
                usuario="u",
                ruc="20101031773",
                now=self.NOW,
                alcance="solo_algunos",
            )

    def test_unconfirmed_submit_is_not_retried(self):
        store = FakeStore()
        validator = FakeValidator()
        validator.submit_error = UpstreamError(
            "read timeout", code="NETWORK_ERROR", http_status=None
        )
        first = submit_sunat_batch(
            validator, store, documentos=[self._doc()],
            usuario="u", ruc="20101031773", now=self.NOW,
        )
        self.assertEqual(first["enviados"], 0)
        key = ("20101031773", "03", "BS05", "105")
        self.assertEqual(store.rows[key]["Estado"], "SIN_CONFIRMAR")
        self.assertTrue(first["errores"][0]["sin_confirmar"])

        second = submit_sunat_batch(
            FakeValidator(), store, documentos=[self._doc()],
            usuario="u", ruc="20101031773", now=self.NOW,
        )
        self.assertEqual(second["enviados"], 0)
        self.assertEqual(second["omitidos"]["sin_confirmar"], 1)

    def test_does_not_resubmit_a_job_still_running(self):
        seen = (self.NOW - timedelta(hours=1)).isoformat(timespec="seconds")
        key = ("20101031773", "03", "BS05", "105")
        store = FakeStore({
            key: {
                "Estado": "PENDIENTE",
                "FechaConsulta": seen,
                "TrabajoID": "77",
                "Intentos": "1",
            }
        })
        validator = FakeValidator()
        validator.summary = {
            "trabajo": {"Estado": "EN_PROCESO", "Total": 1, "Procesados": 0},
            "detalle": [],
        }
        res = submit_sunat_batch(
            validator, store, documentos=[self._doc()],
            usuario="u", ruc="20101031773", now=self.NOW,
        )
        self.assertEqual(res["enviados"], 0)
        self.assertEqual(res["omitidos"]["en_proceso"], 1)
        self.assertEqual(validator.submits, [])
        self.assertEqual(store.rows[key]["Estado"], "PENDIENTE")

    def test_completed_job_is_refreshed_and_not_resubmitted(self):
        seen = (self.NOW - timedelta(hours=1)).isoformat(timespec="seconds")
        key = ("20101031773", "03", "BS05", "105")
        store = FakeStore({
            key: {
                "Estado": "PENDIENTE",
                "FechaConsulta": seen,
                "TrabajoID": "77",
                "Intentos": "1",
            }
        })
        validator = FakeValidator()
        validator.job = {
            "trabajo": {"Estado": "COMPLETADO", "Total": 1, "Procesados": 1},
            "detalle": [{
                "Estado": "OK", "Ruc": "20101031773", "Tipo": "03",
                "Serie": "BS05", "Numero": "105",
                "ResultadoEstado": "ACEPTADO",
            }],
        }
        res = submit_sunat_batch(
            validator, store, documentos=[self._doc()],
            usuario="u", ruc="20101031773", now=self.NOW,
        )
        self.assertEqual(res["enviados"], 0)
        self.assertEqual(res["omitidos"]["aceptados"], 1)
        self.assertEqual(validator.submits, [])
        self.assertEqual(store.rows[key]["Estado"], "ACEPTADO")

    def test_chunks_and_limit(self):
        docs = [
            {**self._doc(), "number": f"BS05-{i:08d}"} for i in range(501)
        ]
        validator = FakeValidator()
        store = FakeStore()
        res = submit_sunat_batch(
            validator, store, documentos=docs,
            usuario="u", ruc="20101031773", now=self.NOW,
        )
        # Default chunk size is 50: 11 submits for 501 documents.
        self.assertEqual(len(validator.submits), 11)
        self.assertEqual(res["enviados"], 501)
        # Two batched cache writes per chunk (claim + job id), not 501.
        self.assertEqual(store.upsert_many_calls, 22)
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

    def test_reports_chunk_progress(self):
        docs = [
            {**self._doc(), "number": f"BS05-{i:08d}"}
            for i in range(2)
        ]
        events: list[dict] = []
        res = submit_sunat_batch(
            FakeValidator(),
            FakeStore(),
            documentos=docs,
            usuario="u",
            ruc="20101031773",
            now=self.NOW,
            batch_max=1,
            on_progress=events.append,
        )
        self.assertEqual(res["enviados"], 2)
        self.assertEqual(events[-1]["fase"], "finalizando")
        self.assertEqual(events[-1]["por_enviar"], 2)
        self.assertEqual(events[-1]["chunks_total"], 2)
        self.assertEqual(events[-1]["chunks_done"], 2)
        self.assertEqual(events[-1]["enviados"], 2)
        self.assertEqual(res["por_enviar"], 2)

    def test_progress_callback_failure_does_not_abort(self):
        def fail(_payload: dict) -> None:
            raise RuntimeError("ui disconnected")

        res = submit_sunat_batch(
            FakeValidator(),
            FakeStore(),
            documentos=[self._doc()],
            usuario="u",
            ruc="20101031773",
            now=self.NOW,
            on_progress=fail,
        )
        self.assertEqual(res["enviados"], 1)


class SubmissionRegistryTests(unittest.TestCase):
    def test_reuses_an_active_same_batch_and_user(self):
        registry = SunatSubmissionRegistry()
        docs = [{"tipo": "BOLETA", "number": "BS05-1", "date": "2026-10-18"}]
        fingerprint = submission_fingerprint(docs)

        first, reused = registry.create(
            usuario="u@x.pe", total=1, fingerprint=fingerprint
        )
        second, reused_again = registry.create(
            usuario="u@x.pe", total=1, fingerprint=fingerprint
        )
        other, _ = registry.create(
            usuario="v@x.pe", total=1, fingerprint=fingerprint
        )

        self.assertFalse(reused)
        self.assertTrue(reused_again)
        self.assertEqual(first.id, second.id)
        self.assertNotEqual(first.id, other.id)

    def test_fingerprint_ignores_order_and_case(self):
        first = submission_fingerprint([
            {"tipo": "boleta", "number": "bs05-1", "date": "2026-10-18T10:00:00"},
            {"tipo": "FACTURA", "number": "F001-2", "date": "2026-10-18"},
        ])
        second = submission_fingerprint([
            {"tipo": "FACTURA", "number": "F001-2", "date": "2026-10-18"},
            {"tipo": "BOLETA", "number": "BS05-1", "date": "2026-10-18T10:00:00"},
        ])
        self.assertEqual(first, second)

    def test_fingerprint_includes_scope(self):
        docs = [{"tipo": "BOLETA", "number": "BS05-1", "date": "2026-10-18"}]
        self.assertNotEqual(
            submission_fingerprint(docs, "no_aceptados"),
            submission_fingerprint(docs, "todos"),
        )

    def test_progress_then_complete_is_visible_to_the_polling_endpoint(self):
        registry = SunatSubmissionRegistry()
        item, _ = registry.create(
            usuario="u@x.pe", total=363, fingerprint="fp"
        )
        registry.start(item.id)
        registry.progress(item.id, {
            "fase": "enviando",
            "mensaje": "Enviando lote 2 de 4…",
            "total": 363,
            "por_enviar": 200,
            "chunks_total": 4,
            "chunks_done": 2,
            "enviados": 100,
        })
        live = registry.snapshot(item.id, usuario="u@x.pe")
        self.assertIsNotNone(live)
        assert live is not None
        self.assertEqual(live["estado"], "EN_PROCESO")
        self.assertEqual(live["chunks_done"], 2)
        self.assertEqual(live["porcentaje"], 50.0)

        registry.complete(item.id, {
            "total": 363,
            "por_enviar": 200,
            "enviados": 200,
            "trabajos": [{"trabajo_id": 9, "cantidad": 100}],
            "errores": [],
            "omitidos": {
                "aceptados": 163,
                "en_proceso": 0,
                "sin_confirmar": 0,
                "invalidos": [],
            },
        })
        done = registry.snapshot(item.id, usuario="u@x.pe")
        self.assertIsNotNone(done)
        assert done is not None
        self.assertEqual(done["estado"], "COMPLETADO")
        self.assertEqual(done["enviados"], 200)
        self.assertEqual(done["porcentaje"], 100.0)
        self.assertIsNone(registry.snapshot(item.id, usuario="otro@x.pe"))

    def test_failed_submission_exposes_the_real_error(self):
        registry = SunatSubmissionRegistry()
        item, _ = registry.create(
            usuario="u@x.pe", total=50, fingerprint="fp-error"
        )
        registry.complete(item.id, {
            "total": 50,
            "enviados": 0,
            "trabajos": [],
            "errores": [{"cantidad": 50, "mensaje": "SUNAT no disponible"}],
            "omitidos": {
                "aceptados": 0,
                "en_proceso": 0,
                "sin_confirmar": 0,
                "invalidos": [],
            },
        })
        state = registry.snapshot(item.id, usuario="u@x.pe")
        self.assertIsNotNone(state)
        assert state is not None
        self.assertEqual(state["estado"], "ERROR")
        self.assertEqual(state["mensaje"], "SUNAT no disponible")


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

    def test_batches_reads_and_writes_per_job(self):
        # N+1 regression: 3 results must cost ONE cache read + ONE batched
        # write, not 3 reads and 3 upserts.
        validator = FakeValidator()
        validator.job = {
            "trabajo": {"Estado": "COMPLETADO", "Total": 3, "Procesados": 3},
            "detalle": [
                {"Estado": "OK", "Ruc": "R", "Tipo": "03", "Serie": "BS05",
                 "Numero": f"0000010{i}", "ResultadoEstado": "ACEPTADO"}
                for i in (5, 6, 7)
            ],
        }
        store = FakeStore()
        res = sunat_job_status(validator, store, trabajo_id=9, usuario="u")
        self.assertEqual(len(res["resultados"]), 3)
        self.assertEqual(store.fetch_calls, 1)
        self.assertEqual(store.upsert_many_calls, 1)
        self.assertEqual(store.upsert_calls, 0)

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


class StoreNormalizationTests(unittest.TestCase):
    def test_prepare_tolerates_empty_optional_values(self):
        from syner_check.sunat_store import _prepare

        key, data = _prepare({
            "Ruc": "R",
            "Tipo": "03",
            "Serie": "bs05",
            "Numero": "105",
            "Importe": None,
            "FechaEmision": None,
            "ConsultaID": "",
            "TrabajoID": "5",
            "Intentos": "3",
        })
        self.assertEqual(key, ("R", "03", "BS05", "105"))
        self.assertIsNone(data["Importe"])
        self.assertIsNone(data["FechaEmision"])
        self.assertIsNone(data["ConsultaID"])
        self.assertEqual(data["TrabajoID"], 5)
        self.assertEqual(data["Intentos"], 3)


class JobPollingTests(unittest.TestCase):
    def _pending_store(self, estado="PENDIENTE", job_id="5"):
        key = ("R", "03", "BS05", "105")
        return key, FakeStore({
            key: {
                "Estado": estado,
                "TrabajoID": job_id,
                "Intentos": "3",
                "Importe": "12.50",
                "FechaEmision": "2026-10-15",
                "UsuarioOrigen": "u@x.pe",
            }
        })

    def test_running_job_uses_summary_without_detail(self):
        key, store = self._pending_store()
        validator = FakeValidator()
        validator.summary = {
            "trabajo": {"Estado": "EN_PROCESO", "Total": 1, "Procesados": 0},
            "detalle": [{"Estado": "OK"}],
        }
        res = sunat_job_status(validator, store, trabajo_id=5, usuario="u")
        self.assertEqual(validator.summary_calls, 1)
        self.assertEqual(validator.detail_calls, 0)
        self.assertEqual(res["estado"], "EN_PROCESO")
        self.assertEqual(res["pendientes"], 1)
        self.assertEqual(res["porcentaje"], 0.0)

    def test_terminal_job_fetches_detail_once_and_preserves_data(self):
        key, store = self._pending_store(estado="PROCESANDO")
        validator = FakeValidator()
        validator.job = {
            "trabajo": {"Estado": "COMPLETADO", "Total": 1, "Procesados": 1},
            "detalle": [{
                "Estado": "OK", "Ruc": "R", "Tipo": "03", "Serie": "BS05",
                "Numero": "105", "ResultadoEstado": "ACEPTADO",
            }],
        }
        res = sunat_job_status(validator, store, trabajo_id=5, usuario="sistema")
        self.assertEqual(validator.summary_calls, 1)
        self.assertEqual(validator.detail_calls, 1)
        self.assertEqual(res["porcentaje"], 100.0)
        self.assertEqual(store.rows[key]["Estado"], "ACEPTADO")
        self.assertEqual(store.rows[key]["Importe"], "12.50")
        self.assertEqual(store.rows[key]["FechaEmision"], "2026-10-15")
        # Polling is not another attempt, and the worker is not the origin.
        self.assertEqual(store.rows[key]["Intentos"], 3)
        self.assertEqual(store.rows[key]["UltimoError"], "")
        self.assertEqual(store.rows[key]["UsuarioOrigen"], "u@x.pe")

    def test_previous_read_failure_never_writes_partial_rows(self):
        _key, store = self._pending_store()
        store.fetch_error = RuntimeError("db down")
        validator = FakeValidator()
        validator.job = {
            "trabajo": {"Estado": "COMPLETADO", "Total": 1, "Procesados": 1},
            "detalle": [{
                "Estado": "OK", "Ruc": "R", "Tipo": "03", "Serie": "BS05",
                "Numero": "105", "ResultadoEstado": "ACEPTADO",
            }],
        }
        with self.assertRaises(RuntimeError):
            sunat_job_status(validator, store, trabajo_id=5, usuario="u")
        self.assertEqual(store.upsert_many_calls, 0)

    def test_404_marks_pending_rows_retryable(self):
        key, store = self._pending_store()
        validator = FakeValidator()
        validator.status_error = UpstreamError("missing", http_status=404)
        res = sunat_job_status(validator, store, trabajo_id=5, usuario="u")
        self.assertEqual(store.rows[key]["Estado"], "ERROR")
        self.assertEqual(store.mark_missing_calls, 1)
        self.assertEqual(res["pendientes"], 0)
        self.assertEqual(res["errores"], 1)

    def test_terminal_state_is_not_downgraded(self):
        key, store = self._pending_store(estado="ACEPTADO")
        store.rows[key]["ConsultaID"] = "9"
        validator = FakeValidator()
        validator.job = {
            "trabajo": {"Estado": "COMPLETADO", "Total": 1, "Procesados": 1},
            "detalle": [{
                "Estado": "OK", "Ruc": "R", "Tipo": "03", "Serie": "BS05",
                "Numero": "105", "ResultadoEstado": "ERROR",
            }],
        }
        sunat_job_status(validator, store, trabajo_id=5, usuario="u")
        self.assertEqual(store.rows[key]["Estado"], "ACEPTADO")
        self.assertEqual(store.rows[key]["ConsultaID"], "9")


class ReconcileTests(unittest.TestCase):
    def test_reconciles_every_pending_job(self):
        key = ("R", "03", "BS05", "105")
        store = FakeStore({
            key: {
                "Estado": "PENDIENTE",
                "TrabajoID": "88",
                "Intentos": "1",
            }
        })
        validator = FakeValidator()
        validator.job = {
            "trabajo": {"Estado": "COMPLETADO", "Total": 1, "Procesados": 1},
            "detalle": [{
                "Estado": "OK", "Ruc": "R", "Tipo": "03", "Serie": "BS05",
                "Numero": "105", "ResultadoEstado": "ACEPTADO",
            }],
        }
        res = reconcile_pending_sunat_jobs(validator, store, usuario="u")
        self.assertEqual(res["jobs"], 1)
        self.assertEqual(res["reconciliados"], 1)
        self.assertEqual(res["pendientes"], 0)
        self.assertEqual(store.rows[key]["Estado"], "ACEPTADO")
        self.assertEqual(store.mark_stale_calls, 1)


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_tick_runs_and_worker_stops(self):
        stop = asyncio.Event()
        calls: list[int] = []

        async def tick():
            calls.append(1)
            stop.set()
            return {"reconciliados": 1}

        await asyncio.wait_for(
            run_sunat_reconcile_worker(tick, interval_seconds=2, stop=stop),
            timeout=1,
        )
        self.assertEqual(calls, [1])


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
