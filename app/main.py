from __future__ import annotations

import asyncio
import logging
import secrets
import time
from contextlib import asynccontextmanager, suppress
from datetime import date

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.sessions import SessionMiddleware

from .auth import callback, current_user, login, logout
from .executor import run_blocking, shutdown_executor
from .http_cache import cache_control_for
from .logging_setup import configure_logging, request_id_var
from .security import (
    BodySizeLimitMiddleware,
    OriginCheckMiddleware,
    RateLimitMiddleware,
    read_json_limited,
)
from src.application import reconcile_pending_sunat_jobs
from src.application.sunat_worker import run_sunat_reconcile_worker
from src.interfaces.wiring import (
    document_detail as clean_document_detail,
    search as clean_search,
    summary as clean_summary,
    sunat_reconcile as clean_sunat_reconcile,
    sunat_single as clean_sunat_single,
    sunat_status as clean_sunat_status,
    sunat_submit as clean_sunat_submit,
    sunat_worker_pair,
)
from .config import (
    ALLOWED_ORIGINS,
    BASE_DIR,
    MAX_RANGE_DAYS,
    MAX_REQUEST_BYTES,
    RATE_LIMIT_PER_MINUTE,
    RATE_LIMIT_SUNAT_WRITE_PER_MINUTE,
    SEARCH_FALLBACK_DAYS,
    SESSION_SECRET,
    SESSION_HTTPS_ONLY,
    APP_ENV,
    AUTH_MODE,
)

configure_logging()
logger = logging.getLogger("syner_check")


def _sunat_worker_task(stop: asyncio.Event) -> asyncio.Task | None:
    """Start the reconciliation loop when SUNAT is fully configured."""
    pair = sunat_worker_pair()
    if pair is None:
        logger.info("SUNAT reconcile worker disabled: validator/db not configured")
        return None
    validator, store, settings = pair
    if not settings.get("worker_enabled", True):
        logger.info("SUNAT reconcile worker disabled by configuration")
        return None

    interval = int(settings.get("worker_interval_seconds", 10))
    stale_minutes = int(settings.get("stale_submit_minutes", 10))

    async def tick() -> dict:
        return await run_blocking(
            reconcile_pending_sunat_jobs,
            validator,
            store,
            usuario="sistema",
            max_jobs=10,
            stale_minutes=stale_minutes,
        )

    return asyncio.create_task(
        run_sunat_reconcile_worker(
            tick, interval_seconds=interval, stop=stop
        ),
        name="sunat-reconcile",
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    stop = asyncio.Event()
    task: asyncio.Task | None = None
    try:
        task = _sunat_worker_task(stop)
        yield
    finally:
        stop.set()
        if task is not None:
            try:
                await asyncio.wait_for(task, timeout=10)
            except asyncio.TimeoutError:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        shutdown_executor()


app = FastAPI(
    title="Syner Check",
    docs_url="/docs" if APP_ENV != "production" else None,
    redoc_url="/redoc" if APP_ENV != "production" else None,
    lifespan=lifespan,
)

# Middleware runs in reverse registration order (last added = outermost).
# Session must wrap the rate limiter so it can key buckets by user email.
# GZip is registered first, so it is the innermost: it compresses route
# responses (HTML/JS/CSS) while the security layer still sets the headers.
app.add_middleware(GZipMiddleware, minimum_size=600)
app.add_middleware(
    RateLimitMiddleware,
    limit=RATE_LIMIT_PER_MINUTE,
    sunat_write_limit=RATE_LIMIT_SUNAT_WRITE_PER_MINUTE,
    window_seconds=60,
)
app.add_middleware(OriginCheckMiddleware, allowed_origins=ALLOWED_ORIGINS)
app.add_middleware(BodySizeLimitMiddleware, max_bytes=MAX_REQUEST_BYTES)
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    same_site="lax",
    https_only=SESSION_HTTPS_ONLY,
    max_age=8 * 3600,
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "app" / "static"), name="static")


@app.middleware("http")
async def security_and_request_middleware(request: Request, call_next):
    request_id = secrets.token_hex(8)
    request.state.request_id = request_id
    token = request_id_var.set(request_id)
    started = time.perf_counter()
    try:
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("Unhandled error path=%s", request.url.path)
            raise
        elapsed_ms = (time.perf_counter() - started) * 1000
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=()"
        )
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self' data: https://*.googleusercontent.com; "
            "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; "
            "form-action 'self'"
        )
        cache_control = cache_control_for(
            request.url.path, response.headers.get("content-type", "")
        )
        if cache_control:
            response.headers["Cache-Control"] = cache_control
        logger.info(
            "%s %s status=%s %.0fms",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        return response
    finally:
        request_id_var.reset(token)


_INDEX_HTML: tuple[float, str] | None = None


def _index_html() -> str | None:
    """Read index.html, caching it until the file changes on disk."""
    global _INDEX_HTML
    path = BASE_DIR / "app" / "static" / "frontend" / "index.html"
    try:
        mtime = path.stat().st_mtime
    except FileNotFoundError:
        return None
    cached = _INDEX_HTML
    if cached is not None and cached[0] == mtime:
        return cached[1]
    html = path.read_text(encoding="utf-8")
    _INDEX_HTML = (mtime, html)
    return html


@app.get("/", response_class=HTMLResponse)
async def home():
    html = _index_html()
    if html is None:
        return HTMLResponse(
            "<h1>Frontend no compilado</h1>"
            "<p>Ejecuta <code>npm run build</code> en <code>frontend/</code>.</p>",
            status_code=503,
            headers={"Cache-Control": "no-cache"},
        )
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


@app.get("/health")
async def health():
    return {"status": "ok", "service": "syner-check"}


@app.get("/auth/login")
async def auth_login(request: Request):
    return await login(request)


@app.get("/auth/callback")
async def auth_callback(request: Request):
    if AUTH_MODE == "development":
        return RedirectResponse("/", status_code=303)
    try:
        await callback(request)
    except PermissionError:
        return HTMLResponse(
            "<h2>Acceso denegado</h2>"
            "<p>Tu cuenta no está autorizada para esta aplicación.</p>"
            "<p><a href='/'>Volver</a></p>",
            status_code=403,
        )
    except Exception:
        logger.exception(
            "OAuth callback failed"
        )
        return HTMLResponse(
            "<h2>Error de autenticación</h2>"
            "<p>No fue posible completar el inicio de sesión.</p>"
            "<p><a href='/'>Volver</a></p>",
            status_code=500,
        )
    return RedirectResponse("/", status_code=303)


@app.post("/auth/logout")
async def auth_logout(request: Request):
    logout(request)
    return RedirectResponse("/", status_code=303)


def protected(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(401, "Autenticación requerida")
    return user


def parse_types(types: str) -> list[str]:
    allowed = {"FACTURA", "BOLETA", "NOTA DE CREDITO"}
    wanted = [x.strip().upper() for x in types.split(",") if x.strip()]
    # Reject unknown types instead of silently broadening the query.
    invalid = [x for x in wanted if x not in allowed]
    if invalid:
        raise HTTPException(400, "Tipo de documento inválido.")
    if not wanted:
        raise HTTPException(400, "Selecciona al menos un tipo de documento.")
    return list(dict.fromkeys(wanted))


def validate_range(start_date: str, end_date: str):
    try:
        a = date.fromisoformat(start_date)
        b = date.fromisoformat(end_date)
    except ValueError as exc:
        raise HTTPException(400, "Fechas inválidas.") from exc
    if b < a:
        raise HTTPException(400, "La fecha final debe ser mayor o igual a la inicial.")
    if (b - a).days + 1 > MAX_RANGE_DAYS:
        raise HTTPException(400, f"El rango máximo es de {MAX_RANGE_DAYS} días.")
    return a, b


@app.get("/api/me")
async def me(request: Request):
    return {"user": current_user(request)}


@app.get("/api/summary")
async def api_summary(
    request: Request,
    start_date: str,
    end_date: str,
    types: str = "FACTURA,BOLETA,NOTA DE CREDITO",
):
    protected(request)
    validate_range(start_date, end_date)
    tipos = parse_types(types)
    try:
        return await run_blocking(
            clean_summary, start_date, end_date, tipos, MAX_RANGE_DAYS
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Summary failed")
        raise HTTPException(502, "No fue posible consultar los comprobantes.") from exc


@app.get("/api/search")
async def api_search(
    request: Request,
    number: str = Query(..., min_length=1, max_length=80),
):
    protected(request)
    number = number.strip()
    if not number:
        raise HTTPException(400, "Ingresa un número de comprobante.")
    try:
        return await run_blocking(
            clean_search,
            number,
            SEARCH_FALLBACK_DAYS,
            date.today(),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Number search failed")
        raise HTTPException(502, "No fue posible completar la búsqueda.") from exc


@app.get("/api/document/{tipo}/{oid}")
async def api_document(
    request: Request,
    tipo: str,
    oid: str,
    doc_date: str = Query(..., min_length=10, max_length=40),
    number: str | None = Query(None, max_length=80),
):
    protected(request)
    try:
        return await run_blocking(
            clean_document_detail, tipo, oid, doc_date, number
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Document detail failed")
        raise HTTPException(502, "No fue posible cargar el detalle.") from exc


def _actor_email(request: Request) -> str:
    user = current_user(request) or {}
    if isinstance(user, dict):
        return str(user.get("email", ""))
    return ""


@app.post("/api/sunat/lotes")
async def api_sunat_submit(request: Request):
    protected(request)
    body = await read_json_limited(request, MAX_REQUEST_BYTES)
    documentos = body.get("documentos", []) if isinstance(body, dict) else []
    if not isinstance(documentos, list):
        raise HTTPException(400, "El campo 'documentos' debe ser una lista.")
    try:
        return await run_blocking(
            clean_sunat_submit, documentos, _actor_email(request)
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Sunat submit failed")
        raise HTTPException(502, "No fue posible registrar el lote SUNAT.") from exc


@app.get("/api/sunat/lotes/{trabajo_id}")
async def api_sunat_status(request: Request, trabajo_id: int):
    protected(request)
    try:
        return await run_blocking(
            clean_sunat_status, trabajo_id, _actor_email(request)
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Sunat status failed")
        raise HTTPException(502, "No fue posible consultar el trabajo SUNAT.") from exc


@app.post("/api/sunat/reconciliar")
async def api_sunat_reconcile(request: Request):
    """Manually reconcile pending jobs; the background worker also does this."""
    protected(request)
    try:
        return await run_blocking(clean_sunat_reconcile, _actor_email(request))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Sunat reconcile failed")
        raise HTTPException(
            502, "No fue posible reconciliar los lotes SUNAT."
        ) from exc


@app.post("/api/sunat/revalidar")
async def api_sunat_revalidate(request: Request):
    protected(request)
    body = await read_json_limited(request, MAX_REQUEST_BYTES)
    data = body if isinstance(body, dict) else {}
    try:
        return await run_blocking(
            clean_sunat_single,
            str(data.get("tipo", "")),
            str(data.get("number", "")),
            str(data.get("date", "")),
            data.get("importe", ""),
            _actor_email(request),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Sunat revalidate failed")
        raise HTTPException(502, "No fue posible validar en SUNAT.") from exc
