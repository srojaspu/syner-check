"""Integration tests for the FastAPI wiring (middleware order, headers, cache)."""

from __future__ import annotations

import asyncio
import json
import logging
import unittest

from fastapi.testclient import TestClient

from app.config import BASE_DIR
from app.executor import run_blocking
from app.http_cache import cache_control_for
from app.logging_setup import (
    JsonFormatter,
    RequestIdFilter,
    es_desconexion_benigna,
    install_asyncio_exception_filter,
    request_id_var,
)
from app.main import app

# No context manager: the suite shares one app and the bounded executor.
client = TestClient(app)


@app.get("/api/_test_gzip")
async def _gzip_probe() -> dict[str, str]:
    """Test-only payload above the gzip minimum size."""
    return {"data": "x" * 4000}


class HttpSurfaceTest(unittest.TestCase):
    def test_health_sets_security_headers_and_request_id(self) -> None:
        response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(response.headers["x-frame-options"], "DENY")
        self.assertIn("content-security-policy", response.headers)
        self.assertTrue(response.headers["x-request-id"])

    def test_successful_health_probe_logs_at_debug_not_info(self) -> None:
        """Container probes must not flood INFO logs every 30 seconds."""
        with self.assertLogs("syner_check", level="DEBUG") as captured:
            client.get("/health")
        probes = [
            record
            for record in captured.records
            if record.getMessage().startswith("GET /health ")
        ]
        self.assertEqual(len(probes), 1)
        self.assertEqual(probes[0].levelno, logging.DEBUG)

    def test_chrome_devtools_probe_is_a_quiet_404(self) -> None:
        """Chrome pide su config de workspace al abrir DevTools: 404 normal."""
        with self.assertLogs("syner_check", level="DEBUG") as captured:
            response = client.get(
                "/.well-known/appspecific/com.chrome.devtools.json"
            )
        self.assertEqual(response.status_code, 404)
        probes = [
            record
            for record in captured.records
            if "com.chrome.devtools.json" in record.getMessage()
        ]
        self.assertEqual(len(probes), 1)
        self.assertEqual(probes[0].levelno, logging.DEBUG)

    def test_csp_allows_inline_style_attributes_but_not_style_elements(
        self,
    ) -> None:
        """Portalled Base UI popups set position through the style attribute.

        ``style-src-attr 'unsafe-inline'`` unblocks those dynamic attributes
        while ``style-src 'self'`` still rejects injected <style> elements.
        """
        csp = client.get("/health").headers["content-security-policy"]
        directives = {
            part.strip().split(" ", 1)[0]: part.strip()
            for part in csp.split(";")
            if part.strip()
        }
        self.assertEqual(directives["style-src"], "style-src 'self'")
        self.assertEqual(
            directives["style-src-attr"], "style-src-attr 'unsafe-inline'"
        )

    def test_api_me_reports_no_session(self) -> None:
        response = client.get("/api/me")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["user"])
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_protected_api_requires_session(self) -> None:
        response = client.get(
            "/api/summary",
            params={"start_date": "2024-01-01", "end_date": "2024-01-02"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_cross_origin_write_is_rejected(self) -> None:
        response = client.post(
            "/api/sunat/lotes",
            json={"documentos": []},
            headers={"origin": "https://evil.example"},
        )
        self.assertEqual(response.status_code, 403)

    def test_same_origin_write_reaches_auth(self) -> None:
        response = client.post(
            "/api/sunat/lotes",
            json={"documentos": []},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(response.status_code, 401)

    def test_reconcile_endpoint_requires_session(self) -> None:
        response = client.post(
            "/api/sunat/reconciliar",
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(response.status_code, 401)

    def test_oversized_body_is_rejected(self) -> None:
        response = client.post(
            "/api/sunat/lotes",
            content=b"x" * 1_000_001,
            headers={
                "content-type": "application/json",
                "origin": "http://testserver",
            },
        )
        self.assertEqual(response.status_code, 413)

    def test_large_responses_are_gzipped(self) -> None:
        response = client.get("/api/_test_gzip")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("content-encoding"), "gzip")
        self.assertEqual(response.json()["data"], "x" * 4000)

    @unittest.skipUnless(
        (BASE_DIR / "app" / "static" / "frontend" / "index.html").exists(),
        "frontend build not present",
    )
    def test_home_revalidates(self) -> None:
        response = client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-cache")


class AsyncioNoiseTest(unittest.TestCase):
    """Windows: un navegador que cierra la conexion no es un error de la app."""

    def test_clasifica_solo_los_cortes_de_conexion(self) -> None:
        self.assertTrue(es_desconexion_benigna(ConnectionResetError(10054, "x")))
        self.assertTrue(es_desconexion_benigna(ConnectionAbortedError(10053, "x")))
        self.assertFalse(es_desconexion_benigna(ValueError("boom")))
        self.assertFalse(es_desconexion_benigna(None))

    def test_un_corte_de_conexion_se_registra_en_debug(self) -> None:
        loop = asyncio.new_event_loop()
        self.addCleanup(loop.close)
        self.assertIsNone(install_asyncio_exception_filter(loop))

        with self.assertLogs("asyncio", level="DEBUG") as captured:
            loop.call_exception_handler(
                {
                    "message": "Exception in callback _call_connection_lost()",
                    "exception": ConnectionResetError(10054, "reset"),
                }
            )

        self.assertEqual(
            [record.levelno for record in captured.records], [logging.DEBUG]
        )

    def test_otros_errores_conservan_el_handler_por_defecto(self) -> None:
        loop = asyncio.new_event_loop()
        self.addCleanup(loop.close)
        install_asyncio_exception_filter(loop)

        with self.assertLogs("asyncio", level="ERROR") as captured:
            loop.call_exception_handler(
                {"message": "boom", "exception": ValueError("boom")}
            )

        self.assertEqual(captured.records[0].levelno, logging.ERROR)


class CachePolicyTest(unittest.TestCase):
    def test_hashed_assets_are_immutable(self) -> None:
        self.assertEqual(
            cache_control_for("/static/frontend/assets/index-abc123.js"),
            "public, max-age=31536000, immutable",
        )

    def test_other_static_files_revalidate_hourly(self) -> None:
        self.assertEqual(
            cache_control_for("/static/frontend/favicon.ico"),
            "public, max-age=3600",
        )

    def test_static_index_never_caches(self) -> None:
        self.assertEqual(
            cache_control_for("/static/frontend/index.html", "text/html"),
            "no-cache",
        )

    def test_api_is_never_stored(self) -> None:
        self.assertEqual(cache_control_for("/api/summary"), "no-store")

    def test_html_revalidates(self) -> None:
        self.assertEqual(
            cache_control_for("/", "text/html; charset=utf-8"), "no-cache"
        )

    def test_unknown_content_has_no_policy(self) -> None:
        self.assertIsNone(cache_control_for("/health", "application/json"))


class LoggingContextTest(unittest.TestCase):
    def test_json_formatter_includes_request_id(self) -> None:
        record = logging.LogRecord(
            "syner_check", logging.INFO, __file__, 1, "hola", None, None
        )
        record.request_id = "abc123"
        payload = json.loads(JsonFormatter().format(record))
        self.assertEqual(payload["request_id"], "abc123")
        self.assertEqual(payload["message"], "hola")
        self.assertEqual(payload["level"], "INFO")

    def test_filter_falls_back_to_contextvar(self) -> None:
        token = request_id_var.set("ctx-1")
        try:
            record = logging.LogRecord(
                "syner_check", logging.INFO, __file__, 1, "msg", None, None
            )
            RequestIdFilter().filter(record)
            self.assertEqual(record.request_id, "ctx-1")
        finally:
            request_id_var.reset(token)


class ExecutorContextTest(unittest.IsolatedAsyncioTestCase):
    async def test_worker_thread_keeps_request_id(self) -> None:
        request_id_var.set("worker-1")
        seen = await run_blocking(request_id_var.get)
        self.assertEqual(seen, "worker-1")
