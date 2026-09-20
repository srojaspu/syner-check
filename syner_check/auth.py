"""Keycloak auto-token (password grant + refresh_token).

Mirrors the Node keycloak-admin behaviour with plain ``requests``:
password grant to obtain the first token, refresh_token grant to renew it.

Secrets are never printed or logged. Errors name the missing env var or
the HTTP status only.
"""

from __future__ import annotations

import json
import os
import threading
import time

import requests

TOKEN_TIMEOUT = 30
_SKEW_SECONDS = 30
_DEFAULT_EXPIRES_IN = 300

_cache: dict = {}
_token_lock = threading.Lock()


def _cache_file() -> str:
    """Disk cache path, or empty when file persistence is disabled.

    Opt-in via KC_CACHE_FILE (e.g. a path outside the repo). When unset,
    behavior is memory-only, exactly as before. The file holds bearer
    tokens: it is created with owner-only permissions and its content is
    never logged.
    """
    return (os.getenv("KC_CACHE_FILE", "") or "").strip()


def _load_file_cache() -> None:
    """Merge the disk cache into memory when memory is empty."""
    if _cache.get("access_token") or _cache.get("refresh_token"):
        return
    path = _cache_file()
    if not path:
        return
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return
    if not isinstance(data, dict):
        return
    if not data.get("access_token") and not data.get("refresh_token"):
        return
    _cache.clear()
    _cache.update(
        {
            "access_token": str(data.get("access_token", "")),
            "refresh_token": str(data.get("refresh_token", "")),
            "expires_at": float(data.get("expires_at", 0) or 0),
        }
    )


def _save_file_cache() -> None:
    """Persist the in-memory tokens with owner-only permissions."""
    path = _cache_file()
    if not path:
        return
    try:
        parent = os.path.dirname(os.path.abspath(path))
        if parent:
            os.makedirs(parent, exist_ok=True)
        tmp_path = f"{path}.tmp"
        fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(
                    {
                        "access_token": _cache.get("access_token", ""),
                        "refresh_token": _cache.get("refresh_token", ""),
                        "expires_at": _cache.get("expires_at", 0),
                    },
                    handle,
                )
        except BaseException:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
        try:
            os.chmod(tmp_path, 0o600)
        except OSError:
            pass
        os.replace(tmp_path, path)
    except OSError:
        pass


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
    _save_file_cache()
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


def _is_valid_cached() -> bool:
    return bool(_cache.get("access_token")) and _cache.get("expires_at", 0) > time.time()


def ensure_token() -> str:
    """Return a valid access_token (cached, refreshed, or newly obtained).

    Token acquisition is serialized behind a lock so concurrent callers do not
    trigger parallel Keycloak grants/refreshes (thundering herd). A double-check
    after acquiring the lock lets waiting threads reuse the token another thread
    just obtained.
    """
    _load_file_cache()
    if _is_valid_cached():
        return _cache["access_token"]
    with _token_lock:
        if _is_valid_cached():
            return _cache["access_token"]
        if _cache.get("refresh_token"):
            try:
                return refresh()["access_token"]
            except RuntimeError:
                pass
        return get_token()["access_token"]


def clear_cache() -> None:
    """Test helper: drop the in-memory token cache."""
    _cache.clear()
