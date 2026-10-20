"""Unit tests for HTTP hardening and the SQL connection pool (no DB/HTTP)."""

from __future__ import annotations

import asyncio
import unittest
from unittest import mock

from fastapi import HTTPException
from starlette.requests import Request

from app.security import (
    BodySizeLimitMiddleware,
    OriginCheckMiddleware,
    RateLimitMiddleware,
    SlidingWindowLimiter,
    read_json_limited,
)
from syner_check.db_pool import _Pool, close_all, pooled_connection


def _scope(
    *,
    path: str = "/api/x",
    method: str = "GET",
    headers: tuple[tuple[str, str], ...] = (),
    client: tuple[str, int] = ("1.2.3.4", 1234),
    session: dict | None = None,
) -> dict:
    return {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": [
            (name.lower().encode("latin-1"), value.encode("latin-1"))
            for name, value in headers
        ],
        "client": client,
        "server": ("testserver", 80),
        "session": session if session is not None else {},
    }


class _Recorder:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def send(self, message: dict) -> None:
        self.messages.append(message)

    async def receive(self) -> dict:
        return {"type": "http.request", "body": b"", "more_body": False}

    @property
    def status(self) -> int:
        return int(self.messages[0]["status"])

    @property
    def headers(self) -> dict[str, str]:
        raw = self.messages[0].get("headers") or []
        return {k.decode("latin-1"): v.decode("latin-1") for k, v in raw}


class _EchoApp:
    def __init__(self) -> None:
        self.calls = 0

    async def __call__(self, scope, receive, send) -> None:
        self.calls += 1
        await send(
            {"type": "http.response.start", "status": 200, "headers": []}
        )
        await send({"type": "http.response.body", "body": b"ok"})


def _call(middleware, scope) -> _Recorder:
    recorder = _Recorder()
    asyncio.run(middleware(scope, recorder.receive, recorder.send))
    return recorder


class LimiterTests(unittest.TestCase):
    def test_allows_up_to_limit_then_blocks_with_retry_after(self):
        limiter = SlidingWindowLimiter(limit=2, window=60)
        self.assertTrue(limiter.allow("k", now=100.0)[0])
        self.assertTrue(limiter.allow("k", now=101.0)[0])
        allowed, retry = limiter.allow("k", now=102.0)
        self.assertFalse(allowed)
        self.assertGreaterEqual(retry, 1)

    def test_window_slides(self):
        limiter = SlidingWindowLimiter(limit=1, window=10)
        self.assertTrue(limiter.allow("k", now=0.0)[0])
        self.assertFalse(limiter.allow("k", now=5.0)[0])
        self.assertTrue(limiter.allow("k", now=11.0)[0])


class RateLimitMiddlewareTests(unittest.TestCase):
    def test_general_bucket_blocks_extra_calls(self):
        app = _EchoApp()
        middleware = RateLimitMiddleware(
            app, limit=2, sunat_write_limit=1, window_seconds=60
        )
        self.assertEqual(_call(middleware, _scope()).status, 200)
        self.assertEqual(_call(middleware, _scope()).status, 200)
        blocked = _call(middleware, _scope())
        self.assertEqual(blocked.status, 429)
        self.assertIn("retry-after", blocked.headers)
        self.assertEqual(app.calls, 2)

    def test_sunat_post_has_tighter_bucket_but_get_does_not(self):
        app = _EchoApp()
        middleware = RateLimitMiddleware(
            app, limit=50, sunat_write_limit=1, window_seconds=60
        )
        post = {"path": "/api/sunat/lotes", "method": "POST"}
        self.assertEqual(_call(middleware, _scope(**post)).status, 200)
        self.assertEqual(_call(middleware, _scope(**post)).status, 429)
        # Polling the job status is a GET: it uses the general bucket.
        self.assertEqual(
            _call(
                middleware,
                _scope(path="/api/sunat/lotes/7", method="GET"),
            ).status,
            200,
        )

    def test_buckets_are_per_user(self):
        middleware = RateLimitMiddleware(
            _EchoApp(), limit=1, sunat_write_limit=1, window_seconds=60
        )
        alice = _scope(session={"user": {"email": "a@x.pe"}})
        bob = _scope(session={"user": {"email": "b@x.pe"}})
        self.assertEqual(_call(middleware, alice).status, 200)
        self.assertEqual(_call(middleware, alice).status, 429)
        self.assertEqual(_call(middleware, bob).status, 200)

    def test_non_api_paths_are_not_limited(self):
        middleware = RateLimitMiddleware(
            _EchoApp(), limit=1, sunat_write_limit=1, window_seconds=60
        )
        for _ in range(5):
            self.assertEqual(
                _call(middleware, _scope(path="/static/app.js")).status, 200
            )


class OriginCheckTests(unittest.TestCase):
    def test_cross_site_post_is_rejected(self):
        app = _EchoApp()
        middleware = OriginCheckMiddleware(app)
        recorder = _call(
            middleware,
            _scope(
                method="POST",
                path="/api/sunat/revalidar",
                headers=(
                    ("origin", "https://evil.example"),
                    ("host", "app.example"),
                ),
            ),
        )
        self.assertEqual(recorder.status, 403)
        self.assertEqual(app.calls, 0)

    def test_same_origin_post_passes(self):
        app = _EchoApp()
        middleware = OriginCheckMiddleware(app)
        recorder = _call(
            middleware,
            _scope(
                method="POST",
                headers=(
                    ("origin", "https://app.example"),
                    ("host", "app.example"),
                ),
            ),
        )
        self.assertEqual(recorder.status, 200)
        self.assertEqual(app.calls, 1)

    def test_get_and_non_browser_posts_are_allowed(self):
        app = _EchoApp()
        middleware = OriginCheckMiddleware(app)
        evil_get = _scope(
            method="GET", headers=(("origin", "https://evil.example"),)
        )
        self.assertEqual(_call(middleware, evil_get).status, 200)
        no_origin = _scope(method="POST", headers=(("host", "app.example"),))
        self.assertEqual(_call(middleware, no_origin).status, 200)

    def test_default_port_is_ignored(self):
        middleware = OriginCheckMiddleware(_EchoApp())
        recorder = _call(
            middleware,
            _scope(
                method="POST",
                headers=(
                    ("origin", "https://app.example"),
                    ("host", "app.example:443"),
                ),
            ),
        )
        self.assertEqual(recorder.status, 200)

    def test_explicit_allowlist(self):
        app = _EchoApp()
        middleware = OriginCheckMiddleware(
            app, allowed_origins=("https://app.example",)
        )
        ok = _scope(
            method="POST",
            headers=(
                ("origin", "https://app.example"),
                ("host", "internal:8000"),
            ),
        )
        self.assertEqual(_call(middleware, ok).status, 200)
        wrong = _scope(
            method="POST",
            headers=(
                ("origin", "https://other.example"),
                ("host", "internal:8000"),
            ),
        )
        self.assertEqual(_call(middleware, wrong).status, 403)


class BodyLimitTests(unittest.TestCase):
    def test_content_length_over_cap_is_rejected(self):
        app = _EchoApp()
        middleware = BodySizeLimitMiddleware(app, max_bytes=10)
        recorder = _call(
            middleware,
            _scope(method="POST", headers=(("content-length", "11"),)),
        )
        self.assertEqual(recorder.status, 413)
        self.assertEqual(app.calls, 0)

    def test_content_length_under_cap_passes(self):
        app = _EchoApp()
        middleware = BodySizeLimitMiddleware(app, max_bytes=10)
        recorder = _call(
            middleware,
            _scope(method="POST", headers=(("content-length", "2"),)),
        )
        self.assertEqual(recorder.status, 200)

    def _request(self, body: bytes) -> Request:
        delivered = False

        async def receive() -> dict:
            nonlocal delivered
            if delivered:
                return {"type": "http.disconnect"}
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}

        return Request(_scope(method="POST"), receive)

    def test_read_json_limited_parses_and_caps(self):
        self.assertEqual(
            asyncio.run(read_json_limited(self._request(b'{"a": 1}'), 100)),
            {"a": 1},
        )
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(read_json_limited(self._request(b'{"a": "long"}'), 5))
        self.assertEqual(caught.exception.status_code, 413)

    def test_read_json_limited_rejects_garbage(self):
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(read_json_limited(self._request(b"not-json"), 100))
        self.assertEqual(caught.exception.status_code, 400)
        with self.assertRaises(HTTPException) as empty:
            asyncio.run(read_json_limited(self._request(b""), 100))
        self.assertEqual(empty.exception.status_code, 400)


class _FakeConnection:
    def __init__(self) -> None:
        self.closed = False
        self.closes = 0
        self.rollbacks = 0

    def rollback(self) -> None:
        self.rollbacks += 1

    def close(self) -> None:
        self.closed = True
        self.closes += 1


class PoolTests(unittest.TestCase):
    def tearDown(self) -> None:
        close_all()

    def _factory(self):
        created: list[_FakeConnection] = []

        def make() -> _FakeConnection:
            connection = _FakeConnection()
            created.append(connection)
            return connection

        return make, created

    def test_reuses_released_connection(self):
        make, created = self._factory()
        pool = _Pool(make, max_idle=2, idle_seconds=60)
        first = pool.checkout()
        pool.checkin(first)
        self.assertIs(pool.checkout(), first)
        self.assertEqual(len(created), 1)

    def test_expired_connection_is_replaced(self):
        make, created = self._factory()
        pool = _Pool(make, max_idle=2, idle_seconds=0)
        first = pool.checkout()
        pool.checkin(first)
        self.assertIsNot(pool.checkout(), first)
        self.assertTrue(first.closed)
        self.assertEqual(len(created), 2)

    def test_pooled_connection_rolls_back_and_reuses(self):
        make, created = self._factory()
        config = {"server": "pool-test", "database": "db", "uid": "u"}
        with mock.patch(
            "syner_check.db_pool.connect", side_effect=lambda *a, **k: make()
        ):
            with pooled_connection(config, "secret") as first:
                pass
            with pooled_connection(config, "secret") as second:
                pass
        self.assertIs(first, second)
        self.assertEqual(len(created), 1)
        self.assertEqual(first.rollbacks, 2)

    def test_pooled_connection_discards_on_error(self):
        make, created = self._factory()
        config = {"server": "pool-error", "database": "db", "uid": "u"}
        with mock.patch(
            "syner_check.db_pool.connect", side_effect=lambda *a, **k: make()
        ):
            with self.assertRaises(RuntimeError):
                with pooled_connection(config, "secret") as broken:
                    raise RuntimeError("boom")
            with pooled_connection(config, "secret") as healthy:
                pass
        self.assertTrue(broken.closed)
        self.assertFalse(healthy.closed)
        self.assertEqual(len(created), 2)


if __name__ == "__main__":
    unittest.main()
