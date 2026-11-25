"""Unit tests for src/application/pos_logs_cache.py (sin I/O)."""

from __future__ import annotations

import threading
import time
import unittest

from src.application.pos_logs_cache import TTLCache


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class TestTTLCache(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = FakeClock()
        self.cache = TTLCache(max_entries=3, max_bytes=10_000, clock=self.clock)

    def test_get_returns_none_when_empty(self) -> None:
        self.assertIsNone(self.cache.get("k"))

    def test_put_and_get_until_ttl(self) -> None:
        self.cache.put("k", {"a": 1}, ttl=60, size=10)
        self.assertEqual(self.cache.get("k"), {"a": 1})
        self.clock.advance(59)
        self.assertEqual(self.cache.get("k"), {"a": 1})
        self.clock.advance(2)
        self.assertIsNone(self.cache.get("k"))

    def test_zero_ttl_and_none_are_not_cached(self) -> None:
        self.cache.put("a", 1, ttl=0)
        self.cache.put("b", None, ttl=60)
        self.assertIsNone(self.cache.get("a"))
        self.assertIsNone(self.cache.get("b"))

    def test_get_or_load_caches_and_calls_loader_once(self) -> None:
        calls: list[int] = []

        def loader() -> dict:
            calls.append(1)
            return {"v": 1}

        self.assertEqual(self.cache.get_or_load("k", loader, ttl=60), {"v": 1})
        self.assertEqual(self.cache.get_or_load("k", loader, ttl=60), {"v": 1})
        self.assertEqual(len(calls), 1)

    def test_none_loader_result_is_not_cached(self) -> None:
        calls: list[int] = []

        def loader() -> None:
            calls.append(1)
            return None

        self.assertIsNone(self.cache.get_or_load("k", loader, ttl=60))
        self.assertIsNone(self.cache.get_or_load("k", loader, ttl=60))
        self.assertEqual(len(calls), 2)

    def test_loader_exception_is_not_cached(self) -> None:
        calls: list[int] = []

        def failing() -> dict:
            calls.append(1)
            raise RuntimeError("boom")

        with self.assertRaises(RuntimeError):
            self.cache.get_or_load("k", failing, ttl=60)
        with self.assertRaises(RuntimeError):
            self.cache.get_or_load("k", failing, ttl=60)
        self.assertEqual(len(calls), 2)
        self.assertIsNone(self.cache.get("k"))

    def test_single_flight_calls_loader_once_for_concurrent_requests(self) -> None:
        cache = TTLCache(clock=self.clock)
        entered = threading.Event()
        release = threading.Event()
        calls: list[int] = []
        results: list[dict] = []

        def loader() -> dict:
            calls.append(1)
            entered.set()
            release.wait(2)
            return {"v": 1}

        def worker() -> None:
            results.append(cache.get_or_load("k", loader, ttl=60))

        first = threading.Thread(target=worker)
        first.start()
        self.assertTrue(entered.wait(2))
        second = threading.Thread(target=worker)
        second.start()
        # Deja que el segundo hilo llegue al lock de la clave.
        time.sleep(0.05)
        release.set()
        first.join(2)
        second.join(2)

        self.assertFalse(first.is_alive() or second.is_alive())
        self.assertEqual(len(calls), 1)
        self.assertEqual(results, [{"v": 1}, {"v": 1}])

    def test_lru_evicts_oldest_entry(self) -> None:
        self.cache.put("a", 1, ttl=60)
        self.cache.put("b", 2, ttl=60)
        self.cache.put("c", 3, ttl=60)
        self.cache.get("a")  # "a" pasa a ser la más reciente
        self.cache.put("d", 4, ttl=60)

        self.assertIsNone(self.cache.get("b"))
        self.assertEqual(self.cache.get("a"), 1)
        self.assertEqual(self.cache.get("d"), 4)

    def test_expired_entries_are_dropped_before_eviction(self) -> None:
        self.cache.put("old", 1, ttl=10)
        self.clock.advance(11)
        self.cache.put("new", 2, ttl=60)
        self.assertIsNone(self.cache.get("old"))
        self.assertEqual(self.cache.get("new"), 2)

    def test_byte_budget_evicts_oldest(self) -> None:
        cache = TTLCache(max_entries=10, max_bytes=100, clock=self.clock)
        cache.put("a", {"a": 1}, ttl=60, size=60)
        cache.put("b", {"b": 2}, ttl=60, size=60)

        self.assertIsNone(cache.get("a"))
        self.assertEqual(cache.get("b"), {"b": 2})

    def test_entry_larger_than_budget_is_not_stored_but_returned(self) -> None:
        cache = TTLCache(max_entries=10, max_bytes=100, clock=self.clock)
        result = cache.get_or_load("big", lambda: {"v": 1}, ttl=60, size=200)
        self.assertEqual(result, {"v": 1})
        self.assertIsNone(cache.get("big"))

    def test_invalidate_and_clear(self) -> None:
        self.cache.put("a", 1, ttl=60)
        self.cache.put("b", 2, ttl=60)
        self.cache.invalidate("a")
        self.assertIsNone(self.cache.get("a"))
        self.assertEqual(self.cache.get("b"), 2)
        self.cache.clear()
        self.assertIsNone(self.cache.get("b"))
        self.assertEqual(self.cache.stats().entries, 0)

    def test_stats(self) -> None:
        self.cache.put("a", 1, ttl=60, size=5)
        self.cache.get("a")  # hit
        self.cache.get_or_load("b", lambda: 2, ttl=60, size=5)  # miss + load
        stats = self.cache.stats()
        self.assertEqual(stats.hits, 1)
        self.assertEqual(stats.misses, 1)
        self.assertEqual(stats.loads, 1)
        self.assertEqual(stats.entries, 2)
        self.assertEqual(stats.bytes, 10)

    def test_max_entries_zero_disables_storage(self) -> None:
        cache = TTLCache(max_entries=0, clock=self.clock)
        cache.put("a", 1, ttl=60)
        self.assertIsNone(cache.get("a"))
        self.assertEqual(cache.get_or_load("k", lambda: 2, ttl=60), 2)
        self.assertIsNone(cache.get("k"))

    def test_invalid_limits(self) -> None:
        with self.assertRaises(ValueError):
            TTLCache(max_entries=-1)
        with self.assertRaises(ValueError):
            TTLCache(max_bytes=-1)


if __name__ == "__main__":
    unittest.main()
