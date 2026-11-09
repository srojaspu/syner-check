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
    return {
        "url": url,
        "api_key": api_key,
        "ruc": ruc,
        # Batch registration returns 202 after queueing; upstream can take
        # ~100 s under load. A longer read timeout avoids losing the job id.
        "submit_timeout_seconds": _int_env(
            "SUNAT_SUBMIT_TIMEOUT_SECONDS", 180, 30, 600
        ),
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
    """Conexión de escritura a la misma base que ``DB_*`` (dbo.SunatValidacion).

    No hay credenciales propias: ``synercheck_writer`` es el único login de
    SynerPOS y tiene SELECT+INSERT+UPDATE sobre la tabla del cache SUNAT. Se
    fuerza escritura (sin ApplicationIntent=ReadOnly) y se fija la tabla, que
    no se configura por variable.
    """
    return {
        **get_db_config(),
        "table": "dbo.SunatValidacion",
        "application_intent_read_only": False,
    }


def get_sunat_db_password() -> str:
    """Password del writer SUNAT (la misma de ``DB_USER``; nunca se registra)."""
    return get_db_password()


# --- MovSynerPos (reenvío manual SynerCom -> SynerPOS) --------------------
# Un solo login para SynerPOS: el writer deriva host/base/login de DB_* y la
# tabla de TABLE_NAME, igual que las lecturas. En producción DB_USER debe ser
# synercheck_writer (tiene SELECT + INSERT + DELETE), así que no hace falta una
# cuenta read-only separada ni variables de conexión duplicadas. El writer solo
# fuerza application_intent_read_only=False en su propia conexión.


def movsynerpos_enabled() -> bool:
    """Kill switch de escritura: apagado por defecto."""
    import os

    return _is_truthy(os.getenv("MOVSYNERPOS_WRITE_ENABLED", "false"))


def movsynerpos_delete_enabled() -> bool:
    """Kill switch independiente del borrado: apagado por defecto.

    Es una capacidad destructiva, así que no comparte bandera con el reenvío:
    habilitar inserciones no habilita borrados.
    """
    import os

    return _is_truthy(os.getenv("MOVSYNERPOS_DELETE_ENABLED", "false"))


def get_movsynerpos_config() -> dict:
    """Config del writer derivada de ``get_db_config()``.

    Reutiliza host/base/login de ``DB_*`` y la tabla de ``TABLE_NAME`` (sin
    reescribirlas) y fuerza la conexión de escritura (sin
    ApplicationIntent=ReadOnly). El adaptador valida y entrecomilla el
    identificador antes de usarlo en SQL.
    """
    return {**get_db_config(), "application_intent_read_only": False}


def is_movsynerpos_configured() -> bool:
    """True cuando el writer tiene config, tabla válida y password.

    No valida nombres concretos: solo que ``TABLE_NAME`` sea un identificador
    seguro (misma guarda que usa el adaptador).
    """
    from syner_check.db_client import qualified_table_name

    try:
        config = get_movsynerpos_config()
        qualified_table_name(str(config.get("table", "")))
    except (RuntimeError, ValueError):
        return False
    return bool(get_db_password())


def get_movsynerpos_login() -> str | None:
    """Login efectivo del writer (``DB_USER``), para el log de arranque.

    Nunca devuelve ni registra la password.
    """
    try:
        return str(get_db_config().get("uid") or "") or None
    except (RuntimeError, ValueError):
        return None


def get_movsynerpos_target() -> str | None:
    """Tabla resuelta del writer (``TABLE_NAME``) o ``None`` si no es válida.

    Solo para logs de arranque: permite ver si el proceso va a escribir en
    producción o en una tabla de prueba antes de la primera escritura.
    """
    from syner_check.db_client import qualified_table_name

    try:
        config = get_movsynerpos_config()
        return qualified_table_name(str(config.get("table", "")))
    except (RuntimeError, ValueError):
        return None


# --- SerieSucursal (catálogo de series por sucursal en PU_SynerPOS) --------


def get_serie_sucursal_table() -> str:
    """Nombre de la tabla de series por sucursal en PU_SynerPOS.

    Configurable por SERIE_SUCURSAL_TABLE_NAME (default: 'SerieSucursal').
    En QA se puede configurar 'SerieSucursalQA' para aislar pruebas sin tocar
    producción.
    """
    import os

    return (
        os.getenv("SERIE_SUCURSAL_TABLE_NAME", "SerieSucursal") or ""
    ).strip() or "SerieSucursal"


def get_serie_sucursal_config() -> dict:
    """Configuración para SerieSucursal derivada de ``get_db_config()``.

    Reutiliza la conexión de PU_SynerPOS y sobreescribe la tabla con
    ``get_serie_sucursal_table()``, sin ApplicationIntent=ReadOnly para permitir
    escritura.
    """
    return {
        **get_db_config(),
        "table": get_serie_sucursal_table(),
        "application_intent_read_only": False,
    }


def is_serie_sucursal_configured() -> bool:
    """True cuando SerieSucursal tiene config, tabla válida y password."""
    from syner_check.db_client import qualified_table_name

    try:
        config = get_serie_sucursal_config()
        qualified_table_name(str(config.get("table", "")))
    except (RuntimeError, ValueError):
        return False
    return bool(get_db_password())


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


# --- Intelisis: reenvio manual (fase 2) ------------------------------------
# La cola es dbo.FE_Reenvio de PUnidas: la misma tabla y el mismo worker que
# usa el ERP (C:\Projects\PHP\rmand2, bin/fe_worker.php en su tarea
# programada). Esta aplicacion NO ejecuta el generador ni crea tablas: solo
# encola, lee la cola y cierra casos a mano.
#
# Un solo login para lectura y reenvio (``INTELISIS_*``): hay una sola
# instancia (sin AG) y dos credenciales vivirian en el mismo .env, asi que la
# conexion de escritura se deriva de la de lectura (mismo patron que
# MovSynerPos): misma config, sin ApplicationIntent=ReadOnly solo aqui. Ese
# login necesita SELECT sobre Venta/MovTipo/FE_Worker/FE_Reenvio,
# INSERT/UPDATE sobre FE_Reenvio y EXECUTE de sp_getapplock. NO necesita
# EXECUTE de los generadores ni permisos de instancia (xp_cmdshell): eso lo
# hace el worker del ERP con su propia cuenta.

INTELISIS_RESEND_MAX_BATCH_DEFAULT = 10
INTELISIS_RESEND_MAX_BATCH_LIMIT = 50
INTELISIS_APP_NAME_DEFAULT = "syner-check-web"

# Nombre fijo: la cola es del ERP y no se cambia por variable de entorno.
FE_REENVIO_TABLE = "dbo.FE_Reenvio"


def intelisis_resend_enabled() -> bool:
    """Kill switch del reenvio: apagado por defecto.

    Apagado, el POST /reenviar responde 503 y no se inserta nada en la cola
    del ERP. Es el unico interruptor necesario para detener la escritura.
    """
    return _is_truthy(os.getenv("INTELISIS_RESEND_ENABLED", "false"))


def intelisis_resend_max_batch() -> int:
    """Tope de documentos por solicitud de reenvio (1..50)."""
    return _int_env(
        "INTELISIS_RESEND_MAX_BATCH",
        INTELISIS_RESEND_MAX_BATCH_DEFAULT,
        1,
        INTELISIS_RESEND_MAX_BATCH_LIMIT,
    )


def get_intelisis_write_config() -> dict:
    """Conexion que escribe en la cola del ERP, derivada del login unico.

    Misma instancia, mismo login y mismo password que la lectura: solo cambia
    la tabla de referencia y que **no** lleva ``ApplicationIntent=ReadOnly``
    (aqui si se escribe). ``APP=`` permite atribuir en SQL Server las sesiones
    que encolaron cada fila.

    El login necesita SELECT sobre Venta/MovTipo/FE_Reenvio/FE_Worker,
    INSERT/UPDATE sobre FE_Reenvio y EXECUTE sobre
    ``sp_getapplock``/``sp_releaseapplock``. El generador y su
    ``xp_cmdshell`` son del worker del ERP, no nuestros.
    """
    return {
        **get_intelisis_config(),
        "table": FE_REENVIO_TABLE,
        # Escritura: jamas ReadOnly (es inerte en esta instancia, pero si
        # algun dia aparece un AG la conexion de escritura sigue siendo la
        # primaria).
        "application_intent_read_only": False,
        "app_name": (
            os.getenv("INTELISIS_APP_NAME", "").strip()
            or INTELISIS_APP_NAME_DEFAULT
        ),
    }


def get_intelisis_write_password() -> str:
    """Password del login unico (nunca se registra ni se imprime)."""
    return get_intelisis_password()


def is_intelisis_write_configured() -> bool:
    """True cuando el login de Intelisis esta configurado.

    Con un solo login, "writer configurado" es exactamente "Intelisis
    configurado"; se conserva el nombre porque describe la capacidad (poder
    encolar), no una credencial distinta.
    """
    return is_intelisis_configured()


def resolve_graphql_token() -> tuple[str, str]:
    """Return (token, source) where source is always 'auto'.

    Token is always auto-obtained via Keycloak (auth.ensure_token()).
    Only names of missing env vars ever appear in errors; values are
    never exposed.
    """
    from . import auth as _auth

    return _auth.ensure_token(), "auto"
