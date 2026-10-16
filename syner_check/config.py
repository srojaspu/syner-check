import os
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()


GRAPHQL_URL = os.getenv("GRAPHQL_URL", "")

# Company context for GraphQL (integration manual §1, critical header
# X-CONTEXT-COMPANY). Set GRAPHQL_COMPANY_ID in .env (see .env.example).
GRAPHQL_COMPANY_ID = os.getenv("GRAPHQL_COMPANY_ID", "")

KC_BASE_URL = os.getenv("KC_BASE_URL", "https://sso.synercom.pe/auth")
KC_REALM = os.getenv("KC_REALM", "SynerCOM")
KC_CLIENT_ID = os.getenv("KC_CLIENT_ID", "pu")
KC_CLIENT_SECRET = os.getenv("KC_CLIENT_SECRET", "")
KC_USERNAME = os.getenv("KC_USERNAME", "")
KC_PASSWORD = os.getenv("KC_PASSWORD", "")


def get_graphql_url() -> str:
    """Fresh read of GRAPHQL_URL (import-time globals go stale)."""
    return os.getenv("GRAPHQL_URL", "")


def get_graphql_company_id() -> str:
    """Fresh read of GRAPHQL_COMPANY_ID (company context header)."""
    return (os.getenv("GRAPHQL_COMPANY_ID", "") or "").strip()


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


def get_intelisis_password() -> str:
    """Return the Intelisis DB password from env (never log or print it)."""
    import os

    return os.getenv("INTELISIS_PASSWORD", "")


def is_intelisis_configured() -> bool:
    """True when the Punidas/Intelisis connection is fully configured.

    Intelisis lives on a different server/DB than MovSynerPos
    (Punidas 172.0.1.156 vs Pu_synerpos 172.0.2.162), so it gets its own
    INTELISIS_* variables. Missing config means "degraded mode":
    callers return intelisis_enabled=False instead of failing.
    """
    import os

    return bool(
        os.getenv("INTELISIS_HOST", "").strip()
        and os.getenv("INTELISIS_DB", "").strip()
        and os.getenv("INTELISIS_USER", "").strip()
        and os.getenv("INTELISIS_PASSWORD", "")
    )


def get_intelisis_config() -> dict:
    """Build the Intelisis (Punidas) DB config from INTELISIS_* env vars.

    Raises RuntimeError naming the missing variable (never its value).
    Reuses driver/timeout/encrypt semantics from get_db_config().
    """
    import os

    server = os.getenv("INTELISIS_HOST", "").strip()
    database = os.getenv("INTELISIS_DB", "").strip()
    uid = os.getenv("INTELISIS_USER", "").strip()
    pwd = os.getenv("INTELISIS_PASSWORD", "")
    if not server:
        raise RuntimeError("Missing required DB env var: INTELISIS_HOST.")
    if not database:
        raise RuntimeError("Missing required DB env var: INTELISIS_DB.")
    if not uid:
        raise RuntimeError("Missing required DB env var: INTELISIS_USER.")
    if not pwd:
        raise RuntimeError("Missing required DB env var: INTELISIS_PASSWORD.")
    try:
        timeout = int(os.getenv("INTELISIS_TIMEOUT", str(DB_TIMEOUT_DEFAULT)))
    except ValueError:
        timeout = DB_TIMEOUT_DEFAULT
    return {
        "driver": DB_DRIVER_DEFAULT,
        "server": server,
        "database": database,
        "table": "dbo.Venta",
        "uid": uid,
        "trusted": False,
        "port": os.getenv("INTELISIS_PORT", "").strip(),
        "instance": os.getenv("INTELISIS_INSTANCE", "").strip(),
        "timeout": timeout,
        "encrypt": os.getenv("INTELISIS_ENCRYPT", "yes"),
        "trust_server_certificate": os.getenv(
            "INTELISIS_TRUST_SERVER_CERTIFICATE", "no"
        ),
        "application_intent_read_only": _is_truthy(
            os.getenv("INTELISIS_READ_ONLY", "true")
        ),
    }


def resolve_graphql_token() -> tuple[str, str]:
    """Return (token, source) where source is always 'auto'.

    Token is always auto-obtained via Keycloak (auth.ensure_token()).
    Only names of missing env vars ever appear in errors; values are
    never exposed.
    """
    from . import auth as _auth

    return _auth.ensure_token(), "auto"
