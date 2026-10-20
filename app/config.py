import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

APP_NAME = os.getenv("APP_NAME", "Syner Check")
APP_ENV = os.getenv("APP_ENV", "production").lower()
AUTH_MODE = os.getenv("AUTH_MODE", "google").lower()
DEV_USER_EMAIL = os.getenv("DEV_USER_EMAIL", "dev@perfumeriasunidas.com.pe").lower()
DEV_USER_NAME = os.getenv("DEV_USER_NAME", "Usuario de desarrollo")
SESSION_HTTPS_ONLY = os.getenv("SESSION_HTTPS_ONLY", "true").lower() in ("1", "true", "yes", "on")
SESSION_SECRET = os.getenv("SESSION_SECRET", "")
if not SESSION_SECRET:
    raise RuntimeError("SESSION_SECRET is required.")
# Defense in depth: AUTH_MODE=development bypasses Google OAuth entirely
# (GET /auth/login mints a session), so it must never be combinable with a
# production deployment. Fail at import instead of serving an open door.
if APP_ENV == "production" and AUTH_MODE == "development":
    raise RuntimeError(
        "AUTH_MODE=development is not allowed with APP_ENV=production. "
        "Use AUTH_MODE=google, or set APP_ENV=development for local work."
    )
if len(SESSION_SECRET) < 32:
    raise RuntimeError("SESSION_SECRET must be at least 32 characters.")

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/callback")
ALLOWED_EMAIL_DOMAIN = os.getenv("ALLOWED_EMAIL_DOMAIN", "perfumeriasunidas.com.pe").lower()
ALLOWED_HOSTED_DOMAIN = os.getenv("ALLOWED_HOSTED_DOMAIN", ALLOWED_EMAIL_DOMAIN).lower()


def _int_env(name: str, default: int) -> int:
    raw = (os.getenv(name, "") or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


# --- HTTP hardening (see app/security.py) -------------------------------
# Per-user (or per-IP) sliding window. SUNAT writes spend external quota, so
# they get a tighter bucket than the rest of the API.
RATE_LIMIT_PER_MINUTE = max(1, _int_env("RATE_LIMIT_PER_MINUTE", 120))
RATE_LIMIT_SUNAT_WRITE_PER_MINUTE = max(
    1, _int_env("RATE_LIMIT_SUNAT_WRITE_PER_MINUTE", 10)
)
MAX_REQUEST_BYTES = max(1024, _int_env("MAX_REQUEST_BYTES", 1_000_000))
# Empty = same-host Origin check (the safe default). Set an explicit
# comma-separated list only if a reverse proxy rewrites Host.
ALLOWED_ORIGINS = tuple(
    origin.strip().rstrip("/")
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
)

SEARCH_FALLBACK_DAYS = _int_env("SEARCH_FALLBACK_DAYS", 90)
MAX_RANGE_DAYS = max(1, _int_env("MAX_RANGE_DAYS", 93))

GRAPHQL_URL = os.getenv("GRAPHQL_URL", "")
