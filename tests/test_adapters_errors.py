"""Error translation must keep a diagnosable, secret-free cause."""

from __future__ import annotations

import unittest

from src.infrastructure.adapters import _reason


class ReasonTests(unittest.TestCase):
    def test_keeps_the_driver_message(self):
        self.assertEqual(
            _reason(RuntimeError("Login timeout expired")),
            "RuntimeError: Login timeout expired",
        )

    def test_redacts_credential_values(self):
        detail = _reason(
            RuntimeError("connect failed PWD=Sup3rS3cret;UID=sa; password=hunter2")
        )
        self.assertNotIn("Sup3rS3cret", detail)
        self.assertNotIn("hunter2", detail)
        self.assertIn("PWD=***", detail)

    def test_collapses_newlines_and_bounds_the_payload(self):
        detail = _reason(RuntimeError("line1\nline2\n" + "x" * 900))
        self.assertNotIn("\n", detail)
        self.assertLessEqual(len(detail), 320)
        self.assertTrue(detail.endswith("…"))

    def test_empty_message_falls_back_to_the_class_name(self):
        self.assertEqual(_reason(RuntimeError("")), "RuntimeError")

    def test_trailing_period_is_not_duplicated(self):
        self.assertEqual(_reason(RuntimeError("boom.")), "RuntimeError: boom")
