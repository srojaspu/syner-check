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


SEARCH_FALLBACK_DAYS = _int_env("SEARCH_FALLBACK_DAYS", 90)
MAX_RANGE_DAYS = max(1, _int_env("MAX_RANGE_DAYS", 93))

GRAPHQL_URL = os.getenv("GRAPHQL_URL", "")
