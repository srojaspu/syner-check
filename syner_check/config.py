import os
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()


GRAPHQL_URL = os.getenv("GRAPHQL_URL", "")

KC_BASE_URL = os.getenv("KC_BASE_URL", "https://sso.synercom.pe/auth")
KC_REALM = os.getenv("KC_REALM", "SynerCOM")
KC_CLIENT_ID = os.getenv("KC_CLIENT_ID", "pu")
KC_CLIENT_SECRET = os.getenv("KC_CLIENT_SECRET", "")
KC_USERNAME = os.getenv("KC_USERNAME", "")
KC_PASSWORD = os.getenv("KC_PASSWORD", "")


def get_graphql_url() -> str:
    """Fresh read of GRAPHQL_URL (import-time globals go stale)."""
    return os.getenv("GRAPHQL_URL", "")


OUTPUT_DIR = Path("output")

# --- SQL Server (DB) settings, read lazily from env by get_db_config() ---
# Only variable NAMES are ever used in error messages; values are never
# printed, logged or returned.
DB_DRIVER_DEFAULT = "ODBC Driver 18 for SQL Server"
DB_TIMEOUT_DEFAULT = 30


def _is_truthy(value: str) -> bool:
    return value.strip().lower() in ("1", "true", "yes", "y", "on")


def get_db_config() -> dict:
    """
    Build the DB configuration from environment variables.

    Strict: only DB_HOST, DB_NAME, TABLE_NAME, DB_USER, DB_USER_PASSWORD.
    Raises RuntimeError naming the missing variable (never its value).
    Call this only on the --compare path so the normal extraction flow
    keeps working when no DB env vars are set.
    """
    import os

    driver = DB_DRIVER_DEFAULT
    server = os.getenv("DB_HOST", "")
    database = os.getenv("DB_NAME", "")
    table = os.getenv("TABLE_NAME", "")
    uid = os.getenv("DB_USER", "")
    pwd = os.getenv("DB_USER_PASSWORD", "")
    port = ""
    instance = ""
    trusted = False
    timeout = int(os.getenv("DB_TIMEOUT", str(DB_TIMEOUT_DEFAULT)))
    encrypt = os.getenv("DB_ENCRYPT", "yes")
    trust_server_certificate = os.getenv("DB_TRUST_SERVER_CERTIFICATE", "no")
    application_intent_read_only = _is_truthy(os.getenv("DB_APPLICATION_INTENT_READ_ONLY", "true"))

    if not server:
        raise RuntimeError("Missing required DB env var: DB_HOST.")
    if not database:
        raise RuntimeError("Missing required DB env var: DB_NAME.")
    if not table:
        raise RuntimeError("Missing required DB env var: TABLE_NAME.")
    if not uid:
        raise RuntimeError("Missing required DB env var: DB_USER.")
    if not pwd:
        raise RuntimeError("Missing required DB env var: DB_USER_PASSWORD.")

    return {
        "driver": driver,
        "server": server,
        "database": database,
        "table": table,
        "uid": uid,
        "trusted": trusted,
        "port": port,
        "instance": instance,
        "timeout": timeout,
        "encrypt": encrypt,
        "trust_server_certificate": trust_server_certificate,
        "application_intent_read_only": application_intent_read_only,
    }


def get_db_password() -> str:
    """Return the DB password from env (never log or print it)."""
    import os

    return os.getenv("DB_USER_PASSWORD", "")


def resolve_graphql_token() -> tuple[str, str]:
    """Return (token, source) where source is always 'auto'.

    Token is always auto-obtained via Keycloak (auth.ensure_token()).
    Only names of missing env vars ever appear in errors; values are
    never exposed.
    """
    from . import auth as _auth

    return _auth.ensure_token(), "auto"
