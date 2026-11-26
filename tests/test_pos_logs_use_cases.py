"""Unit tests for src/application/pos_logs.py (fuente y caché inyectadas)."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta
from decimal import Decimal

from src.application.pos_logs import (
    MAX_PAGE_SIZE,
    analizar,
    build_snapshot,
    filter_events,
    obtener_evento,
    parse_niveles,
    validate_clave,
    validate_limit,
    validate_orden,
    validate_page,
    validate_q,
)
from src.application.pos_logs_cache import TTLCache
from src.domain.errors import InvalidPosFilterError, NotFoundError
from src.domain.pos_logs import (
    LIMA_TZ,
    EventLevel,
    PosLogEvent,
    PosValue,
    TimeWindow,
)

T = datetime(2026, 11, 24, 14, 0, tzinfo=LIMA_TZ)


def window(hours: int = 24) -> TimeWindow:
    return TimeWindow(start=T - timedelta(hours=hours // 2), end=T + timedelta(hours=hours // 2))


def ev(
    oid: str,
    *,
    at: datetime = T,
    level: EventLevel = EventLevel.INFO,
    key: str = "SALE_EMISSION_SUCCEEDED",
    instance: str = "Tienda X",
    serial: str | None = None,
    version: str | None = None,
    amount: str | None = None,
    message: str = "mensaje",
) -> PosLogEvent:
    value = PosValue(
        serial=serial,
        version=version,
        amount=Decimal(amount) if amount is not None else None,
    )
    return PosLogEvent(
        oid=oid,
        at=at,
        level=level,
        key=key,
        instance=instance,
        message=message,
        value=value,
    )


class FakeSource:
    def __init__(self, events: list[PosLogEvent]) -> None:
        self.events = events
        self.calls: list[dict] = []

    def fetch(self, window: TimeWindow, *, key=None, message=None):
        self.calls.append({"window": window, "key": key, "message": message})
        return list(self.events)


def snapshot_data() -> list[PosLogEvent]:
    return [
        ev(
            "1",
            at=T - timedelta(hours=3),
            key="SALE_GATEWAY_CHARGE_APPROVED",
            serial="S1",
            version="3.2.3",
        ),
        ev(
            "2",
            at=T - timedelta(hours=2),
            key="SALE_EMISSION_SUCCEEDED",
            serial="S1",
            version="3.2.3",
        ),
        ev(
            "3",
            at=T - timedelta(hours=1),
            level=EventLevel.WARN,
            key="SALE_GATEWAY_REGISTER_FAILED",
            instance="La Rambla",
            serial="S2",
            version="3.2.2",
        ),
        ev(
            "4",
            at=T - timedelta(minutes=50),
            level=EventLevel.ERROR,
            key="BALANCE_OPEN_FAILED",
            instance="La Rambla",
            serial="S2",
            version="3.2.2",
        ),
        ev(
            "5",
            at=T - timedelta(minutes=40),
            level=EventLevel.ERROR,
            key="BALANCE_OPEN_FAILED",
            instance="Salaverry",
            serial=None,
        ),
        ev(
            "6",
            at=T - timedelta(minutes=30),
            level=EventLevel.ERROR,
            key="SALE_EMISSION_INCONCLUSIVE",
            instance="Caminos",
            serial="S4",
            amount="53.47",
            message="Sale emission inconclusive. Order 03902, PEN 53.47.",
        ),
    ]


class TestSnapshot(unittest.TestCase):
    def setUp(self) -> None:
        self.source = FakeSource(snapshot_data())
        self.cache = TTLCache(max_entries=4, max_bytes=1_000_000)

    def test_aggregates(self) -> None:
        snapshot, hit = build_snapshot(self.source, self.cache, window())

        self.assertFalse(hit)
        self.assertEqual(snapshot.kpis.ultimo_evento, T - timedelta(minutes=30))

        self.assertEqual(snapshot.versiones[0], ("3.2.3", 2))
        self.assertEqual(snapshot.claves[0].clave, "BALANCE_OPEN_FAILED")
        self.assertEqual(snapshot.claves[0].conteo, 2)
        self.assertIs(snapshot.claves[0].nivel, EventLevel.ERROR)

    def test_series_hourly_and_zero_filled(self) -> None:
        snapshot, _ = build_snapshot(self.source, self.cache, window(hours=24))
        self.assertEqual(len(snapshot.series), 24)
        totals = sum(bucket.error for bucket in snapshot.series)
        self.assertEqual(totals, 3)

    def test_series_daily_for_long_window(self) -> None:
        start = T - timedelta(days=30)
        long_window = TimeWindow(start=start, end=T)
        snapshot, _ = build_snapshot(
            FakeSource([ev("1", at=T - timedelta(days=1))]),
            self.cache,
            long_window,
        )
        self.assertEqual(len(snapshot.series), 31)
        self.assertTrue(snapshot.window.includes_value is False)

    def test_second_call_hits_cache(self) -> None:
        first, hit1 = build_snapshot(self.source, self.cache, window())
        second, hit2 = build_snapshot(self.source, self.cache, window())
        self.assertFalse(hit1)
        self.assertTrue(hit2)
        self.assertIs(first, second)
        self.assertEqual(len(self.source.calls), 1)

    def test_empty_window_is_valid(self) -> None:
        snapshot, _ = build_snapshot(FakeSource([]), self.cache, window())
        self.assertIsNone(snapshot.kpis.ultimo_evento)


class TestFilters(unittest.TestCase):
    def setUp(self) -> None:
        self.source = FakeSource(snapshot_data())
        self.cache = TTLCache(max_entries=4, max_bytes=1_000_000)
        self.analysis = analizar(self.source, self.cache, window(), limit=50)

    def test_filters_and_pagination_do_not_call_upstream(self) -> None:
        filtrado = filter_events(
            self.analysis.snapshot,
            niveles=frozenset({EventLevel.ERROR}),
            page=1,
            limit=2,
        )
        self.assertEqual(filtrado.total, 3)
        self.assertEqual(len(filtrado.items), 2)
        self.assertTrue(filtrado.hay_mas)

        second = filter_events(
            self.analysis.snapshot,
            niveles=frozenset({EventLevel.ERROR}),
            page=2,
            limit=2,
        )
        self.assertEqual(len(second.items), 1)
        self.assertFalse(second.hay_mas)

        by_key = filter_events(self.analysis.snapshot, clave="BALANCE_OPEN_FAILED")
        self.assertEqual(by_key.total, 2)

        by_instance = filter_events(self.analysis.snapshot, instancia="La Rambla")
        self.assertEqual(by_instance.total, 2)

        by_serial = filter_events(self.analysis.snapshot, serial="S1")
        self.assertEqual(by_serial.total, 2)

        self.assertEqual(len(self.source.calls), 1)

    def test_order(self) -> None:
        recientes = filter_events(self.analysis.snapshot, orden="reciente", limit=2)
        antiguos = filter_events(self.analysis.snapshot, orden="antiguo", limit=2)
        self.assertEqual([item.oid for item in recientes.items], ["6", "5"])
        self.assertEqual([item.oid for item in antiguos.items], ["1", "2"])

    def test_text_filter_is_case_insensitive(self) -> None:
        by_message = filter_events(self.analysis.snapshot, q="ORDER 03902")
        self.assertEqual([item.oid for item in by_message.items], ["6"])

        by_key = filter_events(self.analysis.snapshot, q="balance_open")
        self.assertEqual(by_key.total, 2)

    def test_page_beyond_total_is_empty(self) -> None:
        page = filter_events(self.analysis.snapshot, page=10, limit=50)
        self.assertEqual(page.items, ())
        self.assertEqual(page.total, 6)

    def test_invalid_filters(self) -> None:
        with self.assertRaises(InvalidPosFilterError):
            filter_events(self.analysis.snapshot, orden="arbitrario")
        with self.assertRaises(InvalidPosFilterError):
            filter_events(self.analysis.snapshot, page=0)
        with self.assertRaises(InvalidPosFilterError):
            filter_events(self.analysis.snapshot, limit=MAX_PAGE_SIZE + 1)


class TestValidators(unittest.TestCase):
    def test_niveles(self) -> None:
        self.assertIsNone(parse_niveles(None))
        self.assertEqual(
            parse_niveles("ERROR, warn"),
            frozenset({EventLevel.ERROR, EventLevel.WARN}),
        )
        with self.assertRaises(InvalidPosFilterError):
            parse_niveles("ERROR,DEBUG")

    def test_text_and_paging(self) -> None:
        self.assertEqual(validate_clave("  K  "), "K")
        self.assertIsNone(validate_clave(""))
        with self.assertRaises(InvalidPosFilterError):
            validate_clave("A" * 81)
        with self.assertRaises(InvalidPosFilterError):
            validate_q("A" * 65)
        self.assertEqual(validate_orden(None), "reciente")
        self.assertEqual(validate_orden("Antiguo"), "antiguo")
        with self.assertRaises(InvalidPosFilterError):
            validate_orden("x")
        self.assertEqual(validate_page("2"), 2)
        with self.assertRaises(InvalidPosFilterError):
            validate_page("x")
        self.assertEqual(validate_limit(200), 200)
        with self.assertRaises(InvalidPosFilterError):
            validate_limit(0)


class TestEventDetail(unittest.TestCase):
    def test_uses_cached_snapshot_without_extra_fetch(self) -> None:
        source = FakeSource(snapshot_data())
        cache = TTLCache(max_entries=4, max_bytes=1_000_000)
        build_snapshot(source, cache, window())

        event, _ = obtener_evento(
            source, cache, window(), "6", T - timedelta(minutes=30)
        )
        self.assertEqual(event.oid, "6")
        self.assertEqual(len(source.calls), 1)

    def test_fetches_narrow_window_when_not_cached(self) -> None:
        source = FakeSource(snapshot_data())
        cache = TTLCache(max_entries=4, max_bytes=1_000_000)

        event, hit = obtener_evento(
            source, cache, window(), "6", T - timedelta(minutes=30)
        )
        self.assertEqual(event.oid, "6")
        self.assertFalse(hit)
        self.assertEqual(len(source.calls), 1)
        self.assertEqual(source.calls[0]["window"].duration, timedelta(hours=4))

    def test_not_found(self) -> None:
        source = FakeSource(snapshot_data())
        cache = TTLCache(max_entries=4, max_bytes=1_000_000)
        with self.assertRaises(NotFoundError):
            obtener_evento(source, cache, window(), "999", T)

    def test_invalid_identity(self) -> None:
        source = FakeSource([])
        cache = TTLCache(max_entries=4, max_bytes=1_000_000)
        with self.assertRaises(InvalidPosFilterError):
            obtener_evento(source, cache, window(), "", T)
        with self.assertRaises(InvalidPosFilterError):
            obtener_evento(source, cache, window(), "1", datetime(2026, 11, 24))


if __name__ == "__main__":
    unittest.main()
