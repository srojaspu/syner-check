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


def _int_env(name: str, default: int, minimum: int, maximum: int | None = None) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        value = default
    value = max(minimum, value)
    return min(value, maximum) if maximum is not None else value


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


# --- SUNAT Validator (microservicio HTTP/JSON, ver docs/) ---
# Cosas separadas: (a) credenciales del microservicio, (b) RUC emisor,
# (c) conexión de ESCRITURA a Pu_synerpos para dbo.SunatValidacion.
# La conexión de escritura NO usa ApplicationIntent=ReadOnly y su cuenta
# solo tiene SELECT+INSERT+UPDATE sobre esa tabla (mínimo privilegio).

SUNAT_BATCH_MAX = 500
SUNAT_REQUEST_DOCS_MAX = 2000
SUNAT_BATCH_SIZE_DEFAULT = 50
SUNAT_WORKER_INTERVAL_DEFAULT = 10
SUNAT_STALE_SUBMIT_MINUTES_DEFAULT = 10


def get_sunat_validator_config() -> dict:
    """URL + API key + RUC emisor del microservicio SUNAT Validator."""
    import os

    url = os.getenv("SUNAT_VALIDATOR_URL", "").strip().rstrip("/")
    api_key = os.getenv("SUNAT_VALIDATOR_API_KEY", "")
    ruc = os.getenv("SUNAT_RUC_EMISOR", "").strip()
    if not url:
        raise RuntimeError("Missing required env var: SUNAT_VALIDATOR_URL.")
    if not api_key:
        raise RuntimeError("Missing required env var: SUNAT_VALIDATOR_API_KEY.")
    if not ruc or not (ruc.isdigit() and len(ruc) == 11):
        raise RuntimeError(
            "Missing or invalid env var: SUNAT_RUC_EMISOR (11 digits)."
        )
    try:
        revalidate_hours = int(os.getenv("SUNAT_REVALIDATE_HOURS", "24"))
    except ValueError:
        revalidate_hours = 24
    return {
        "url": url,
        "api_key": api_key,
        "ruc": ruc,
        "revalidate_hours": max(1, revalidate_hours),
        # Small chunks bound the damage of one lost HTTP response and let
        # the UI show progress every few documents instead of one 9-minute job.
        "batch_size": _int_env(
            "SUNAT_BATCH_SIZE", SUNAT_BATCH_SIZE_DEFAULT, 1, SUNAT_BATCH_MAX
        ),
        "worker_enabled": _is_truthy(
            os.getenv("SUNAT_WORKER_ENABLED", "true")
        ),
        "worker_interval_seconds": _int_env(
            "SUNAT_WORKER_INTERVAL_SECONDS", SUNAT_WORKER_INTERVAL_DEFAULT, 2, 300
        ),
        "stale_submit_minutes": _int_env(
            "SUNAT_STALE_SUBMIT_MINUTES", SUNAT_STALE_SUBMIT_MINUTES_DEFAULT, 1, 120
        ),
    }


def get_sunat_db_config() -> dict:
    """Conexión de escritura a Pu_synerpos (dbo.SunatValidacion).

    Sin ApplicationIntent=ReadOnly: con ese flag los writes fallan.
    """
    import os

    server = os.getenv("SUNAT_DB_HOST", "").strip()
    database = os.getenv("SUNAT_DB_NAME", "Pu_synerpos").strip() or "Pu_synerpos"
    uid = os.getenv("SUNAT_DB_USER", "").strip()
    pwd = os.getenv("SUNAT_DB_PASSWORD", "")
    if not server:
        raise RuntimeError("Missing required env var: SUNAT_DB_HOST.")
    if not uid:
        raise RuntimeError("Missing required env var: SUNAT_DB_USER.")
    if not pwd:
        raise RuntimeError("Missing required env var: SUNAT_DB_PASSWORD.")
    return {
        "driver": DB_DRIVER_DEFAULT,
        "server": server,
        "database": database,
        "table": "dbo.SunatValidacion",
        "uid": uid,
        "trusted": False,
        "port": "",
        "instance": "",
        "timeout": int(os.getenv("SUNAT_DB_TIMEOUT", str(DB_TIMEOUT_DEFAULT))),
        "encrypt": os.getenv("SUNAT_DB_ENCRYPT", "yes"),
        "trust_server_certificate": os.getenv(
            "SUNAT_DB_TRUST_SERVER_CERTIFICATE", "no"
        ),
        # Escritura: jamás ReadOnly.
        "application_intent_read_only": False,
    }


def get_sunat_db_password() -> str:
    """Return the SunatValidacion writer password (never log or print it)."""
    import os

    return os.getenv("SUNAT_DB_PASSWORD", "")


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
