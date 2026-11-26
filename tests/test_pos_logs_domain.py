"""Unit tests for src/domain/pos_logs.py (sin red, sin base de datos)."""

from __future__ import annotations

import json
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from src.domain.errors import InvalidPosLogError, InvalidRangeError
from src.domain.pos_logs import (
    LIMA_TZ,
    MAX_MESSAGE_CHARS,
    EventLevel,
    PosLogEvent,
    PosValue,
    TerminalHealth,
    TerminalRef,
    TimeWindow,
    bucket_floor,
    bucket_granularity,
    group_faults,
    parse_datetime,
    parse_event,
    parse_level,
    parse_value,
    safe_text,
    terminal_health,
)


def _event(
    *,
    oid: str,
    at: datetime,
    level: EventLevel,
    key: str = "SALE_EMISSION_SUCCEEDED",
    instance: str = "Tienda X",
    serial: str | None = None,
) -> PosLogEvent:
    value = PosValue(serial=serial) if serial else None
    return PosLogEvent(
        oid=oid,
        at=at,
        level=level,
        key=key,
        instance=instance,
        message="mensaje",
        value=value,
    )


class TestParseLevel(unittest.TestCase):
    def test_bracketed_levels(self) -> None:
        self.assertIs(parse_level("[INFO]"), EventLevel.INFO)
        self.assertIs(parse_level("[WARN]"), EventLevel.WARN)
        self.assertIs(parse_level("[ERROR]"), EventLevel.ERROR)

    def test_plain_and_case_insensitive(self) -> None:
        self.assertIs(parse_level("warn"), EventLevel.WARN)
        self.assertIs(parse_level("  Error "), EventLevel.ERROR)
        self.assertIs(parse_level("WARNING"), EventLevel.WARN)

    def test_unknown_values_do_not_raise(self) -> None:
        for raw in (None, "", "DEBUG", "[]", 42):
            self.assertIs(parse_level(raw), EventLevel.UNKNOWN)


class TestParseDatetime(unittest.TestCase):
    def test_offset_is_preserved_as_lima(self) -> None:
        parsed = parse_datetime("2026-11-24T14:01:36.112-05:00")
        assert parsed is not None
        self.assertEqual(parsed.utcoffset(), timedelta(hours=-5))

    def test_utc_is_converted_to_lima(self) -> None:
        parsed = parse_datetime("2026-11-24T19:30:00+00:00")
        assert parsed is not None
        self.assertEqual(parsed.hour, 14)
        self.assertEqual(parsed.utcoffset(), timedelta(hours=-5))

    def test_z_suffix_is_accepted(self) -> None:
        parsed = parse_datetime("2026-11-24T19:30:00Z")
        assert parsed is not None
        self.assertEqual(parsed.hour, 14)

    def test_naive_or_invalid_is_rejected(self) -> None:
        for raw in (None, "", "2026-11-24T14:00:00", "2026-11-24", "ayer", 123):
            self.assertIsNone(parse_datetime(raw))

    def test_aware_datetime_passes_through(self) -> None:
        moment = datetime(2026, 11, 24, 14, 0, tzinfo=timezone.utc)
        parsed = parse_datetime(moment)
        assert parsed is not None
        self.assertEqual(parsed.hour, 9)


class TestParseValue(unittest.TestCase):
    def test_empty_values_return_none(self) -> None:
        for raw in (None, "", "   ", "{}", "[]", "null", "no-es-json", 3):
            self.assertIsNone(parse_value(raw))

    def test_full_payload(self) -> None:
        raw = json.dumps(
            {
                "version": "3.2.3",
                "serial": "12345678",
                "orderNumber": "03902",
                "amount": "53.47",
                "currency": "PEN",
                "elapsedMs": "15000",
                "docType": "RECEIPT",
                "gateway": "IZIPAY",
                "authorization": "A1B2C3",
                "maskedPan": "491257**6574",
                "merchantId": "778899",
                "gatewayTrace": '{"provider":"IZIPAY"}',
            }
        )
        value = parse_value(raw)
        assert value is not None
        self.assertEqual(value.version, "3.2.3")
        self.assertEqual(value.serial, "12345678")
        self.assertEqual(value.order_number, "03902")
        self.assertEqual(value.amount, Decimal("53.47"))
        self.assertEqual(value.currency, "PEN")
        self.assertEqual(value.elapsed_ms, 15000)
        self.assertEqual(value.doc_type, "RECEIPT")
        self.assertEqual(value.gateway, "IZIPAY")
        self.assertEqual(value.authorization, "A1B2C3")
        self.assertEqual(value.masked_pan, "491257**6574")
        self.assertEqual(value.merchant_id, "778899")
        # El JSON anidado se conserva como texto en raw, no se reinterpreta.
        self.assertIsInstance(value.raw["gatewayTrace"], str)

    def test_amount_uses_decimal_and_rejects_garbage(self) -> None:
        value = parse_value({"amount": "53.47"})
        assert value is not None
        self.assertEqual(value.amount, Decimal("53.47"))
        for raw in ("abc", "-1", "", "NaN", "Infinity"):
            parsed = parse_value({"amount": raw})
            assert parsed is not None
            self.assertIsNone(parsed.amount)

    def test_elapsed_ms_bounds(self) -> None:
        self.assertEqual(parse_value({"elapsedMs": "0"}).elapsed_ms, 0)
        self.assertEqual(parse_value({"elapsedMs": 15000}).elapsed_ms, 15000)
        self.assertIsNone(parse_value({"elapsedMs": "-1"}).elapsed_ms)
        self.assertIsNone(parse_value({"elapsedMs": "abc"}).elapsed_ms)

    def test_order_number_must_be_numeric(self) -> None:
        self.assertEqual(parse_value({"orderNumber": "03902"}).order_number, "03902")
        self.assertIsNone(parse_value({"orderNumber": "03A02"}).order_number)
        self.assertIsNone(parse_value({"orderNumber": "1" * 13}).order_number)

    def test_doc_type_is_derived_from_document_number(self) -> None:
        value = parse_value({"documentNumber": "BS02-00003270"})
        assert value is not None
        self.assertEqual(value.document_number, "BS02-00003270")
        self.assertEqual(value.doc_type, "RECEIPT")
        self.assertEqual(value.public_dict()["document_number"], "BS02-00003270")

        self.assertEqual(parse_value({"documentNumber": "FA01-1"}).doc_type, "INVOICE")
        self.assertIsNone(parse_value({"documentNumber": "XX01-1"}).doc_type)

    def test_oversized_value_is_discarded(self) -> None:
        raw = json.dumps({"x": "a" * (70 * 1024)})
        self.assertIsNone(parse_value(raw))

    def test_too_deep_value_is_discarded(self) -> None:
        self.assertIsNone(parse_value({"a": {"b": {"c": {"d": 1}}}}))
        # Profundidad 3 sí es válida.
        self.assertIsNotNone(parse_value({"a": {"b": {"c": 1}}}))

    def test_public_dict_excludes_technical_data(self) -> None:
        value = parse_value(
            {
                "version": "3.2.3",
                "authorization": "A1B2C3",
                "merchantId": "778899",
                "gatewayTrace": "{}",
                "amount": "10.00",
            }
        )
        assert value is not None
        public = value.public_dict()
        self.assertEqual(public["amount"], "10.00")
        self.assertNotIn("authorization", public)
        self.assertNotIn("merchant_id", public)
        self.assertNotIn("raw", public)
        self.assertNotIn("gatewayTrace", public)


class TestParseEvent(unittest.TestCase):
    BASE = {
        "oid": "80957.52842",
        "logdatetime": "2026-11-24T14:01:36.112-05:00",
        "level": "[WARN]",
        "key": "SALE_GATEWAY_REGISTER_FAILED",
        "instance": "Modulo Semi - La Rambla",
        "message": "Register failed. Order 03902, PEN 53.47.",
        "value": json.dumps({"orderNumber": "03902", "amount": "53.47"}),
    }

    def test_valid_row(self) -> None:
        event = parse_event(self.BASE)
        self.assertEqual(event.oid, "80957.52842")
        self.assertIs(event.level, EventLevel.WARN)
        self.assertEqual(event.key, "SALE_GATEWAY_REGISTER_FAILED")
        self.assertEqual(event.at.utcoffset(), timedelta(hours=-5))
        assert event.value is not None
        self.assertEqual(event.value.order_number, "03902")
        self.assertTrue(event.is_failure)

    def test_unknown_level_and_missing_value_degrade(self) -> None:
        event = parse_event({**self.BASE, "level": "[DEBUG]", "value": None})
        self.assertIs(event.level, EventLevel.UNKNOWN)
        self.assertIsNone(event.value)
        self.assertFalse(event.is_failure)

    def test_bad_json_in_value_does_not_break_event(self) -> None:
        event = parse_event({**self.BASE, "value": "{no-json"})
        self.assertIsNone(event.value)
        self.assertEqual(event.oid, "80957.52842")

    def test_missing_identity_raises(self) -> None:
        for patch in ({"oid": ""}, {"oid": None}):
            with self.assertRaises(InvalidPosLogError):
                parse_event({**self.BASE, **patch})
        with self.assertRaises(InvalidPosLogError):
            parse_event({**self.BASE, "logdatetime": "2026-11-24"})
        with self.assertRaises(InvalidPosLogError):
            parse_event({**self.BASE, "logdatetime": "2026-11-24T14:00:00"})
        with self.assertRaises(InvalidPosLogError):
            parse_event(None)  # type: ignore[arg-type]

    def test_text_is_sanitized_and_bounded(self) -> None:
        event = parse_event(
            {
                **self.BASE,
                "message": "linea1\nlinea2\tcon\x00control " + "x" * 2000,
                "instance": "  Tienda   X  ",
            }
        )
        self.assertNotIn("\n", event.message)
        self.assertNotIn("\x00", event.message)
        self.assertEqual(len(event.message), MAX_MESSAGE_CHARS)
        self.assertEqual(event.instance, "Tienda X")

    def test_terminal_identity(self) -> None:
        with_serial = parse_event(
            {**self.BASE, "value": json.dumps({"serial": "12345678"})}
        )
        self.assertEqual(with_serial.terminal, TerminalRef("Modulo Semi - La Rambla", "12345678"))
        self.assertTrue(with_serial.terminal.has_serial)

        without_serial = parse_event({**self.BASE, "value": "{}"})
        self.assertEqual(without_serial.terminal, TerminalRef("Modulo Semi - La Rambla", None))
        self.assertFalse(without_serial.terminal.has_serial)

    def test_public_dict_shape(self) -> None:
        event = parse_event(self.BASE)
        public = event.public_dict()
        self.assertEqual(public["oid"], "80957.52842")
        self.assertEqual(public["level"], "WARN")
        self.assertEqual(public["terminal"]["serial"], None)
        self.assertEqual(public["value"]["order_number"], "03902")

    def test_sanitized_raw_json_keeps_operational_and_strips_secrets(self) -> None:
        raw_value = {
            "version": "3.2.3",
            "serial": "PN63225X40337",
            "orderNumber": "03902",
            "amount": "53.47",
            "chargedAmount": "33.47",
            "currency": "PEN",
            "elapsedMs": "15002",
            "gateway": "IZIPAY",
            "brand": "VISA",
            "maskedPan": "491257**6574",
            "balanceId": "bal-01",
            "balanceNumber": "00960",
            "previousState": "OPEN",
            "failedEndpoint": "/api/invoices",
            "exception": "java.net.SocketTimeoutException",
            "exceptionMessage": "timeout",
            "authorization": "SECRET-AUTH-999",
            "gatewayTrace": '{"provider":"IZIPAY","response":"secret"}',
            "stackTrace": "at com.synerpos...",
            "merchantId": "999999",
        }
        event = parse_event({**self.BASE, "value": json.dumps(raw_value)})
        assert event.value is not None
        sanitized_str = event.value.sanitized_raw_json()
        assert sanitized_str is not None
        parsed = json.loads(sanitized_str)
        self.assertEqual(parsed["orderNumber"], "03902")
        self.assertEqual(parsed["balanceNumber"], "00960")
        self.assertEqual(parsed["balanceId"], "bal-01")
        self.assertEqual(parsed["failedEndpoint"], "/api/invoices")
        self.assertEqual(parsed["exception"], "java.net.SocketTimeoutException")
        self.assertEqual(parsed["elapsedMs"], 15002)
        self.assertNotIn("authorization", parsed)
        self.assertNotIn("gatewayTrace", parsed)
        self.assertNotIn("stackTrace", parsed)
        self.assertNotIn("merchantId", parsed)


class TestTimeWindow(unittest.TestCase):
    def test_valid_day(self) -> None:
        window = TimeWindow.parse(
            "2026-11-24T00:00:00-05:00", "2026-11-25T00:00:00-05:00"
        )
        self.assertEqual(window.days, 1.0)
        self.assertTrue(window.includes_value)
        self.assertTrue(window.contains(datetime(2026, 11, 24, 13, 0, tzinfo=LIMA_TZ)))

    def test_rejects_missing_timezone(self) -> None:
        with self.assertRaises(InvalidRangeError):
            TimeWindow.parse("2026-11-24T00:00:00", "2026-11-25T00:00:00-05:00")
        with self.assertRaises(InvalidRangeError):
            TimeWindow.parse("2026-11-24", "2026-11-25-05:00")

    def test_rejects_empty_and_inverted_range(self) -> None:
        same = "2026-11-24T00:00:00-05:00"
        with self.assertRaises(InvalidRangeError):
            TimeWindow.parse(same, same)
        with self.assertRaises(InvalidRangeError):
            TimeWindow.parse("2026-11-25T00:00:00-05:00", "2026-11-24T00:00:00-05:00")

    def test_max_31_days(self) -> None:
        start = datetime(2026, 11, 1, tzinfo=LIMA_TZ)
        TimeWindow(start=start, end=start + timedelta(days=31))
        with self.assertRaises(InvalidRangeError):
            TimeWindow(start=start, end=start + timedelta(days=31, seconds=1))

    def test_value_only_for_short_windows(self) -> None:
        start = datetime(2026, 11, 1, tzinfo=LIMA_TZ)
        self.assertTrue(TimeWindow(start=start, end=start + timedelta(days=7)).includes_value)
        self.assertFalse(
            TimeWindow(start=start, end=start + timedelta(days=7, seconds=1)).includes_value
        )

    def test_last_days(self) -> None:
        now = datetime(2026, 11, 24, 15, 30, tzinfo=LIMA_TZ)
        window = TimeWindow.last_days(1, now=now)
        self.assertEqual(window.end, now)
        self.assertEqual(window.start, now - timedelta(days=1))
        with self.assertRaises(InvalidRangeError):
            TimeWindow.last_days(0, now=now)

    def test_contains_is_end_exclusive(self) -> None:
        start = datetime(2026, 11, 24, 0, 0, tzinfo=LIMA_TZ)
        window = TimeWindow(start=start, end=start + timedelta(hours=1))
        self.assertTrue(window.contains(start))
        self.assertFalse(window.contains(start + timedelta(hours=1)))


class TestTerminalHealth(unittest.TestCase):
    NOW = datetime(2026, 11, 24, 14, 0, tzinfo=LIMA_TZ)

    def test_no_data(self) -> None:
        self.assertIs(terminal_health([]), TerminalHealth.NO_DATA)

    def test_only_info_is_ok(self) -> None:
        events = [_event(oid="1", at=self.NOW, level=EventLevel.INFO)]
        self.assertIs(terminal_health(events), TerminalHealth.OK)

    def test_warn_is_degraded(self) -> None:
        events = [
            _event(oid="1", at=self.NOW, level=EventLevel.INFO),
            _event(oid="2", at=self.NOW, level=EventLevel.WARN),
        ]
        self.assertIs(terminal_health(events), TerminalHealth.DEGRADED)

    def test_error_wins_over_warn(self) -> None:
        events = [
            _event(oid="1", at=self.NOW, level=EventLevel.WARN),
            _event(oid="2", at=self.NOW, level=EventLevel.ERROR),
        ]
        self.assertIs(terminal_health(events), TerminalHealth.CRITICAL)


class TestGroupFaults(unittest.TestCase):
    NOW = datetime(2026, 11, 24, 14, 0, tzinfo=LIMA_TZ)

    def test_groups_by_key_and_instance_and_ignores_info(self) -> None:
        events = [
            _event(oid="info", at=self.NOW, level=EventLevel.INFO),
            _event(oid="w1", at=self.NOW - timedelta(minutes=5), level=EventLevel.WARN),
            _event(oid="w2", at=self.NOW - timedelta(minutes=1), level=EventLevel.WARN),
            _event(oid="e1", at=self.NOW, level=EventLevel.ERROR, key="BALANCE_OPEN_FAILED"),
        ]
        groups = group_faults(events)
        self.assertEqual(len(groups), 2)
        repeated = groups[0]
        self.assertEqual(repeated.key, "SALE_EMISSION_SUCCEEDED")
        self.assertEqual(repeated.count, 2)
        self.assertIs(repeated.level, EventLevel.WARN)
        self.assertEqual(repeated.sample_oid, "w2")
        self.assertEqual(repeated.first_at, self.NOW - timedelta(minutes=5))
        self.assertEqual(repeated.last_at, self.NOW - timedelta(minutes=1))

        balance = groups[1]
        self.assertEqual(balance.key, "BALANCE_OPEN_FAILED")
        self.assertEqual(balance.count, 1)
        self.assertIs(balance.level, EventLevel.ERROR)
        self.assertEqual(balance.sample_oid, "e1")

    def test_mixed_levels_report_error(self) -> None:
        events = [
            _event(oid="w", at=self.NOW, level=EventLevel.WARN, key="K"),
            _event(oid="e", at=self.NOW, level=EventLevel.ERROR, key="K"),
        ]
        [group] = group_faults(events)
        self.assertIs(group.level, EventLevel.ERROR)

    def test_sorted_by_count_desc(self) -> None:
        events = [
            _event(oid="a1", at=self.NOW, level=EventLevel.ERROR, key="A"),
            _event(oid="b1", at=self.NOW, level=EventLevel.ERROR, key="B"),
            _event(oid="b2", at=self.NOW, level=EventLevel.ERROR, key="B"),
            _event(oid="b3", at=self.NOW, level=EventLevel.ERROR, key="B"),
        ]
        groups = group_faults(events)
        self.assertEqual([group.key for group in groups], ["B", "A"])


class TestBuckets(unittest.TestCase):
    def test_hour_floor(self) -> None:
        moment = datetime(2026, 11, 24, 14, 37, 12, 500, tzinfo=LIMA_TZ)
        self.assertEqual(
            bucket_floor(moment, "hour"),
            datetime(2026, 11, 24, 14, 0, tzinfo=LIMA_TZ),
        )

    def test_day_floor(self) -> None:
        moment = datetime(2026, 11, 24, 14, 37, tzinfo=LIMA_TZ)
        self.assertEqual(
            bucket_floor(moment, "day"),
            datetime(2026, 11, 24, 0, 0, tzinfo=LIMA_TZ),
        )

    def test_utc_input_is_converted_before_flooring(self) -> None:
        moment = datetime(2026, 11, 24, 20, 30, tzinfo=timezone.utc)  # 15:30 Lima
        self.assertEqual(
            bucket_floor(moment, "hour"),
            datetime(2026, 11, 24, 15, 0, tzinfo=LIMA_TZ),
        )

    def test_invalid_granularity(self) -> None:
        with self.assertRaises(ValueError):
            bucket_floor(datetime.now(LIMA_TZ), "week")

    def test_granularity_switches_at_72_hours(self) -> None:
        start = datetime(2026, 11, 1, tzinfo=LIMA_TZ)
        self.assertEqual(
            bucket_granularity(TimeWindow(start=start, end=start + timedelta(hours=72))),
            "hour",
        )
        self.assertEqual(
            bucket_granularity(
                TimeWindow(start=start, end=start + timedelta(hours=73))
            ),
            "day",
        )


class TestSafeText(unittest.TestCase):
    def test_none_and_empty(self) -> None:
        self.assertEqual(safe_text(None, 10), "")
        self.assertEqual(safe_text("   ", 10), "")

    def test_removes_controls_and_collapses_whitespace(self) -> None:
        self.assertEqual(safe_text(" a\n b\tc\x00d ", 50), "a b c d")

    def test_truncates(self) -> None:
        self.assertEqual(safe_text("abcdef", 4), "abcd")


if __name__ == "__main__":
    unittest.main()
