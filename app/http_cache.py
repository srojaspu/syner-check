"""Cache policy for HTTP responses.

Hashed Vite assets never change, so they get a one-year immutable cache.
Everything else under /static revalidates hourly. API responses are never
stored, and HTML revalidates so a new deploy is picked up immediately.
"""

from __future__ import annotations


def cache_control_for(path: str, content_type: str = "") -> str | None:
    if path.startswith("/api/"):
        return "no-store"
    if path.endswith("index.html"):
        return "no-cache"
    if path.startswith("/static/frontend/assets/"):
        return "public, max-age=31536000, immutable"
    if path.startswith("/static/"):
        return "public, max-age=3600"
    if content_type.lower().startswith("text/html"):
        return "no-cache"
    return None
