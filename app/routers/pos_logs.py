"""Endpoints de la pantalla Terminales (logs POS de SynerCOM).

Router delgado: autentica, valida la forma de la query y delega en el wiring.
La lógica (snapshot, caché, agregados) vive en ``src/``.
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Request

from app.auth import current_user
from app.executor import run_blocking
from src.domain.pos_logs import LIMA_TZ
from src.interfaces.pos_logs_wiring import (
    analisis_pos,
    evento_pos,
    pedido_pos,
)

logger = logging.getLogger("syner_check")

router = APIRouter(prefix="/api/pos", tags=["pos-logs"])


def _protected(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(401, "Autenticación requerida")
    return user


@router.get("/analisis")
async def analisis(
    request: Request,
    desde: str = Query(..., min_length=10, max_length=40),
    hasta: str | None = Query(None, min_length=10, max_length=40),
    nivel: str | None = Query(None, max_length=40),
    clave: str | None = Query(None, max_length=80),
    instancia: str | None = Query(None, max_length=120),
    serial: str | None = Query(None, max_length=40),
    q: str | None = Query(None, max_length=64),
    orden: str = Query("reciente", max_length=10),
    page: int = Query(1, ge=1, le=10_000),
    limit: int = Query(50, ge=1, le=200),
):
    _protected(request)
    # Sin `hasta` explícito se usa "ahora", pero la UI envía un valor fijo para
    # que varias peticiones compartan la misma entrada de caché.
    end = hasta or datetime.now(LIMA_TZ).isoformat(timespec="seconds")
    logger.debug("pos_logs.analisis page=%s limit=%s", page, limit)
    return await run_blocking(
        analisis_pos,
        desde=desde,
        hasta=end,
        nivel=nivel,
        clave=clave,
        instancia=instancia,
        serial=serial,
        q=q,
        orden=orden,
        page=page,
        limit=limit,
    )


@router.get("/evento")
async def evento(
    request: Request,
    oid: str = Query(..., min_length=1, max_length=40),
    at: str = Query(..., min_length=10, max_length=40),
    desde: str = Query(..., min_length=10, max_length=40),
    hasta: str = Query(..., min_length=10, max_length=40),
):
    _protected(request)
    return await run_blocking(
        evento_pos,
        oid=oid,
        at=at,
        desde=desde,
        hasta=hasta,
    )


@router.get("/pedido/{numero}")
async def pedido(
    request: Request,
    numero: str,
    desde: str = Query(..., min_length=10, max_length=40),
    hasta: str = Query(..., min_length=10, max_length=40),
):
    _protected(request)
    return await run_blocking(
        pedido_pos,
        numero=numero,
        desde=desde,
        hasta=hasta,
    )
