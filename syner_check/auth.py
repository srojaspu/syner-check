"""Keycloak auto-token (password grant + refresh_token).

Mirrors the Node keycloak-admin behaviour with plain ``requests``:
password grant to obtain the first token, refresh_token grant to renew it.

Secrets are never printed or logged. Errors name the missing env var or
the HTTP status only.
"""

from __future__ import annotations

import os
import time

import requests

TOKEN_TIMEOUT = 30
_SKEW_SECONDS = 30
_DEFAULT_EXPIRES_IN = 300

_cache: dict = {}


def _token_endpoint() -> str:
    base_url = os.getenv("KC_BASE_URL", "https://sso.synercom.pe/auth").rstrip("/")
    realm = os.getenv("KC_REALM", "SynerCOM")
    if not base_url:
        raise RuntimeError("Missing required Keycloak env var: KC_BASE_URL.")
    if not realm:
        raise RuntimeError("Missing required Keycloak env var: KC_REALM.")
    return f"{base_url}/realms/{realm}/protocol/openid-connect/token"


def _required(name: str, value: str) -> str:
    if not value:
        raise RuntimeError(f"Missing required Keycloak env var: {name}.")
    return value


def _post_token(data: dict) -> dict:
    try:
        response = requests.post(
            _token_endpoint(),
            data=data,
            timeout=TOKEN_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise RuntimeError(
            f"Keycloak token request failed: {type(exc).__name__}."
        ) from exc
    if response.status_code != 200:
        detail = ""
        try:
            body = response.json()
            if isinstance(body, dict):
                err = str(body.get("error", "")).strip()
                desc = str(body.get("error_description", "")).strip()
                detail = " ".join(p for p in (err, desc) if p)[:300]
        except ValueError:
            detail = (response.text or "").strip()[:300]
        suffix = f" {detail}" if detail else ""
        raise RuntimeError(
            f"Keycloak token request failed: HTTP {response.status_code}.{suffix}"
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise RuntimeError("Keycloak token response is not valid JSON.") from exc
    access_token = payload.get("access_token", "")
    if not access_token:
        raise RuntimeError("Keycloak token response lacks access_token.")
    try:
        expires_in = int(payload.get("expires_in", _DEFAULT_EXPIRES_IN))
    except (TypeError, ValueError):
        expires_in = _DEFAULT_EXPIRES_IN
    token = {
        "access_token": access_token,
        "refresh_token": payload.get("refresh_token", "") or "",
        "expires_at": time.time() + max(expires_in, 0) - _SKEW_SECONDS,
    }
    _cache.clear()
    _cache.update(token)
    return dict(_cache)


def get_token() -> dict:
    """Password grant using KC_* env vars. Updates the in-memory cache."""
    username = _required("KC_USERNAME", os.getenv("KC_USERNAME", ""))
    password = _required("KC_PASSWORD", os.getenv("KC_PASSWORD", ""))
    client_id = os.getenv("KC_CLIENT_ID", "pu") or "pu"
    client_secret = _required("KC_CLIENT_SECRET", os.getenv("KC_CLIENT_SECRET", ""))
    return _post_token(
        {
            "grant_type": "password",
            "username": username,
            "password": password,
            "client_id": client_id,
            "client_secret": client_secret,
        }
    )


def refresh(token: dict | None = None) -> dict:
    """Refresh_token grant. Falls back to the cached refresh_token."""
    source = token if isinstance(token, dict) else _cache
    refresh_token = (source or {}).get("refresh_token", "")
    if not refresh_token:
        raise RuntimeError("No refresh_token available for Keycloak refresh.")
    client_id = os.getenv("KC_CLIENT_ID", "pu") or "pu"
    client_secret = _required("KC_CLIENT_SECRET", os.getenv("KC_CLIENT_SECRET", ""))
    return _post_token(
        {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        }
    )


def ensure_token() -> str:
    """Return a valid access_token (cached, refreshed, or newly obtained)."""
    cached_access = _cache.get("access_token", "")
    if cached_access and _cache.get("expires_at", 0) > time.time():
        return cached_access
    if _cache.get("refresh_token"):
        try:
            return refresh()["access_token"]
        except RuntimeError:
            pass
    return get_token()["access_token"]


def clear_cache() -> None:
    """Test helper: drop the in-memory token cache."""
    _cache.clear()
