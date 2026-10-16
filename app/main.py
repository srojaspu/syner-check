from __future__ import annotations

import asyncio
import logging
import os
import secrets
import time
from datetime import date

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from .auth import callback, current_user, login, logout
from src.interfaces.wiring import (
    document_detail as clean_document_detail,
    search as clean_search,
    summary as clean_summary,
    sunat_single as clean_sunat_single,
    sunat_status as clean_sunat_status,
    sunat_submit as clean_sunat_submit,
)
from .config import (
    BASE_DIR,
    MAX_RANGE_DAYS,
    SEARCH_FALLBACK_DAYS,
    SESSION_SECRET,
    SESSION_HTTPS_ONLY,
    APP_ENV,
    AUTH_MODE,
)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())
logger = logging.getLogger("syner_check")

app = FastAPI(
    title="Syner Check",
    docs_url="/docs" if APP_ENV != "production" else None,
    redoc_url="/redoc" if APP_ENV != "production" else None,
)

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
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "Unhandled error request_id=%s path=%s",
            request_id,
            request.url.path,
        )
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
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    logger.info(
        "%s %s status=%s %.0fms request_id=%s",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
        request_id,
    )
    return response


@app.get("/", response_class=HTMLResponse)
async def home():
    html = (BASE_DIR / "app" / "static" / "frontend" / "index.html").read_text(
        encoding="utf-8"
    )
    return HTMLResponse(html)


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
            "OAuth callback failed request_id=%s",
            getattr(request.state, "request_id", "-"),
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
        return await asyncio.to_thread(
            clean_summary, start_date, end_date, tipos, MAX_RANGE_DAYS
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Summary failed request_id=%s", request.state.request_id)
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
        return await asyncio.to_thread(
            clean_search,
            number,
            SEARCH_FALLBACK_DAYS,
            date.today(),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Number search failed request_id=%s", request.state.request_id)
        raise HTTPException(502, "No fue posible completar la búsqueda.") from exc


@app.get("/api/document/{tipo}/{oid}")
async def api_document(
    request: Request, tipo: str, oid: str, doc_date: str, number: str | None = None
):
    protected(request)
    try:
        return await asyncio.to_thread(
            clean_document_detail, tipo, oid, doc_date, number
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Document detail failed request_id=%s", request.state.request_id)
        raise HTTPException(502, "No fue posible cargar el detalle.") from exc


def _actor_email(request: Request) -> str:
    user = current_user(request) or {}
    if isinstance(user, dict):
        return str(user.get("email", ""))
    return ""


@app.post("/api/sunat/lotes")
async def api_sunat_submit(request: Request):
    protected(request)
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, "Cuerpo JSON inválido.") from exc
    documentos = body.get("documentos", []) if isinstance(body, dict) else []
    try:
        return await asyncio.to_thread(
            clean_sunat_submit, documentos, _actor_email(request)
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Sunat submit failed request_id=%s", request.state.request_id)
        raise HTTPException(502, "No fue posible registrar el lote SUNAT.") from exc


@app.get("/api/sunat/lotes/{trabajo_id}")
async def api_sunat_status(request: Request, trabajo_id: int):
    protected(request)
    try:
        return await asyncio.to_thread(
            clean_sunat_status, trabajo_id, _actor_email(request)
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Sunat status failed request_id=%s", request.state.request_id)
        raise HTTPException(502, "No fue posible consultar el trabajo SUNAT.") from exc


@app.post("/api/sunat/revalidar")
async def api_sunat_revalidate(request: Request):
    protected(request)
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, "Cuerpo JSON inválido.") from exc
    data = body if isinstance(body, dict) else {}
    try:
        return await asyncio.to_thread(
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
        logger.exception("Sunat revalidate failed request_id=%s", request.state.request_id)
        raise HTTPException(502, "No fue posible validar en SUNAT.") from exc
