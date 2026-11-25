"""Unit tests for src/infrastructure/pos_logs.py (cliente GraphQL falso)."""

from __future__ import annotations

import json
import threading
import unittest
from datetime import datetime, timedelta

from syner_check.graphql_client import GraphQLQueryError
from src.domain.errors import UpstreamError
from src.domain.pos_logs import LIMA_TZ, EventLevel, TimeWindow
from src.infrastructure.pos_logs import PosLogSourceAdapter

END = datetime(2026, 11, 24, 15, 0, tzinfo=LIMA_TZ)


def window(days: int = 0, hours: int = 1) -> TimeWindow:
    return TimeWindow(start=END - timedelta(days=days, hours=hours), end=END)


def row(
    oid: str,
    at: str = "2026-11-24T14:01:36.112-05:00",
    *,
    level: str = "[INFO]",
    key: str = "SALE_EMISSION_SUCCEEDED",
    instance: str = "Tienda X",
    value: str | None = None,
) -> dict:
    item = {
        "oid": oid,
        "logdatetime": at,
        "level": level,
        "key": key,
        "instance": instance,
        "message": "mensaje",
    }
    if value is not None:
        item["value"] = value
    return item


def ok(*rows: dict) -> dict:
    return {"data": {"logs": list(rows)}}


class FakeClient:
    def __init__(self, response=None, error: BaseException | None = None) -> None:
        self.response = response
        self.error = error
        self.queries: list[str] = []

    def execute(self, query: str) -> dict:
        self.queries.append(query)
        if self.error is not None:
            raise self.error
        return self.response  # type: ignore[return-value]


def adapter(client: FakeClient, **kwargs) -> PosLogSourceAdapter:
    return PosLogSourceAdapter(client_factory=lambda _timeout: client, **kwargs)


class TestQueryBuilder(unittest.TestCase):
    def test_short_window_includes_value_and_bounds(self) -> None:
        client = FakeClient(ok())
        adapter(client).fetch(window(hours=1))

        [query] = client.queries
        self.assertIn('startDate: "2026-11-24T14:00:00-05:00"', query)
        self.assertIn('endDate: "2026-11-24T15:00:00-05:00"', query)
        self.assertIn("oid logdatetime level key instance message", query)
        self.assertTrue(query.rstrip().endswith("value } }"))

    def test_long_window_omits_value(self) -> None:
        client = FakeClient(ok())
        adapter(client).fetch(window(days=30))

        [query] = client.queries
        self.assertNotIn(" value ", query)

    def test_key_and_message_are_quoted(self) -> None:
        client = FakeClient(ok())
        adapter(client).fetch(
            window(),
            key="SALE_GATEWAY_REGISTER_FAILED%",
            message="%Order 03902,%",
        )

        [query] = client.queries
        self.assertIn('key: "SALE_GATEWAY_REGISTER_FAILED%"', query)
        self.assertIn('message: "%Order 03902,%"', query)

    def test_quotes_are_escaped(self) -> None:
        client = FakeClient(ok())
        adapter(client).fetch(window(), key='A"B')

        [query] = client.queries
        self.assertIn('key: "A\\"B"', query)

    def test_empty_filters_are_omitted(self) -> None:
        client = FakeClient(ok())
        adapter(client).fetch(window(), key=None, message=None)

        [query] = client.queries
        self.assertNotIn("key:", query)
        self.assertNotIn("message:", query)

    def test_blank_or_long_filters_raise(self) -> None:
        client = FakeClient(ok())
        source = adapter(client)
        with self.assertRaises(ValueError):
            source.fetch(window(), key="   ")
        with self.assertRaises(ValueError):
            source.fetch(window(), key="A" * 81)
        with self.assertRaises(ValueError):
            source.fetch(window(), message="A" * 161)
        self.assertEqual(client.queries, [])


class TestParsing(unittest.TestCase):
    def test_parses_dedupes_and_sorts(self) -> None:
        client = FakeClient(
            ok(
                row("b", "2026-11-24T14:05:00-05:00"),
                row("a", "2026-11-24T14:01:00-05:00", level="[WARN]"),
                row("b", "2026-11-24T14:06:00-05:00"),  # duplicado: gana el último
                {"logdatetime": "2026-11-24T14:00:00-05:00"},  # sin oid: se omite
                {
                    **row("c"),
                    "logdatetime": "2026-11-24",  # fecha inválida: se omite
                },
            )
        )
        events = adapter(client).fetch(window())

        self.assertEqual([event.oid for event in events], ["a", "b"])
        self.assertIs(events[0].level, EventLevel.WARN)
        self.assertEqual(events[1].at.minute, 6)

    def test_value_is_parsed_for_short_windows(self) -> None:
        client = FakeClient(ok(row("a", value=json.dumps({"serial": "123"}))))
        [event] = adapter(client).fetch(window())
        assert event.value is not None
        self.assertEqual(event.value.serial, "123")

    def test_empty_result(self) -> None:
        client = FakeClient(ok())
        self.assertEqual(adapter(client).fetch(window()), [])


class TestErrors(unittest.TestCase):
    def test_missing_logs_raises_graphql_error(self) -> None:
        client = FakeClient({"data": {"logs": None}, "errors": [{"message": "x"}]})
        with self.assertRaises(UpstreamError) as ctx:
            adapter(client).fetch(window())
        self.assertEqual(ctx.exception.code, "graphql")

    def test_malformed_response(self) -> None:
        cases = [
            (None, "malformed"),
            ({}, "graphql"),
            ({"data": {"logs": "no-es-lista"}}, "malformed"),
        ]
        for response, expected in cases:
            with self.assertRaises(UpstreamError) as ctx:
                adapter(FakeClient(response)).fetch(window())
            self.assertEqual(ctx.exception.code, expected)

    def test_graphql_exception_is_translated(self) -> None:
        client = FakeClient(error=GraphQLQueryError("boom", [{"message": "x"}]))
        with self.assertRaises(UpstreamError) as ctx:
            adapter(client).fetch(window())
        self.assertEqual(ctx.exception.code, "graphql")
        self.assertTrue(ctx.exception.public_message)

    def test_runtime_exception_is_translated(self) -> None:
        client = FakeClient(error=RuntimeError("sin red"))
        with self.assertRaises(UpstreamError) as ctx:
            adapter(client).fetch(window())
        self.assertEqual(ctx.exception.code, "upstream")

    def test_semaphore_busy_raises_busy(self) -> None:
        semaphore = threading.BoundedSemaphore(1)
        semaphore.acquire()
        try:
            source = adapter(
                FakeClient(ok()),
                semaphore=semaphore,
                acquire_timeout=0.01,
            )
            with self.assertRaises(UpstreamError) as ctx:
                source.fetch(window())
            self.assertEqual(ctx.exception.code, "busy")
        finally:
            semaphore.release()

    def test_too_many_rows(self) -> None:
        client = FakeClient(ok(row("a"), row("b"), row("c")))
        with self.assertRaises(UpstreamError) as ctx:
            adapter(client, max_rows=2).fetch(window())
        self.assertEqual(ctx.exception.code, "too_many")


class TestClientLifecycle(unittest.TestCase):
    def test_client_is_built_once(self) -> None:
        calls: list[float] = []
        client = FakeClient(ok())

        def factory(timeout: float) -> FakeClient:
            calls.append(timeout)
            return client

        source = PosLogSourceAdapter(client_factory=factory, timeout=12)
        source.fetch(window())
        source.fetch(window())

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0], 12.0)

    def test_warm_up_sends_trivial_query(self) -> None:
        client = FakeClient({"data": {"__typename": "query"}})
        adapter(client).warm_up()
        self.assertEqual(client.queries, ["query { __typename }"])

    def test_warm_up_never_raises(self) -> None:
        adapter(FakeClient(error=RuntimeError("sin red"))).warm_up()


if __name__ == "__main__":
    unittest.main()
