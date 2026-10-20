"""Integration tests for the FastAPI wiring (middleware order, headers, cache)."""

from __future__ import annotations

import json
import logging
import unittest

from fastapi.testclient import TestClient

from app.config import BASE_DIR
from app.executor import run_blocking
from app.http_cache import cache_control_for
from app.logging_setup import JsonFormatter, RequestIdFilter, request_id_var
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
