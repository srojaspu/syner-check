"""Test environment defaults.

``app.config`` loads ``.env`` at import time and validates that a secret is
present, so these values must be set before any application module is
imported. Explicit assignment (not ``setdefault``) keeps the suite
deterministic even on a workstation whose ``.env`` points at production.
"""

from __future__ import annotations

import os

os.environ["APP_ENV"] = "development"
os.environ["AUTH_MODE"] = "development"
os.environ["SESSION_SECRET"] = "test-secret-" + "x" * 32
os.environ["SESSION_HTTPS_ONLY"] = "false"
os.environ["LOG_FORMAT"] = "text"
# Keep the limiter out of the way; its behaviour is covered by unit tests.
os.environ["RATE_LIMIT_PER_MINUTE"] = "1000"
os.environ["RATE_LIMIT_SUNAT_WRITE_PER_MINUTE"] = "1000"
