"""Endpoints de la pantalla Intelisis UFE.

Viven en un router propio para que ``app.main`` siga siendo el punto de
composicion de la aplicacion y no se llene de handlers de una sola
pantalla.

Solo lectura, salvo la validacion individual en SUNAT (que consulta SUNAT y
guarda el estado en la base de syner-check; no escribe en Intelisis).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query, Request

from app.auth import current_user
from app.executor import run_blocking
from app.logging_setup import request_id_var
from app.security import read_json_limited
from app.config import MAX_REQUEST_BYTES
from src.interfaces.wiring import (
    intelisis_ufe_buscar as clean_intelisis_ufe_buscar,
    intelisis_ufe_detail as clean_intelisis_ufe_detail,
    intelisis_ufe_list as clean_intelisis_ufe_list,
    intelisis_ufe_validate as clean_intelisis_ufe_validate,
)

logger = logging.getLogger("syner_check")

router = APIRouter(prefix="/api/intelisis/ufe", tags=["intelisis-ufe"])

UFE_ESTADOS = {
    "generado",
    "error_validacion",
    "omitido_validacion",
    "sin_bloque",
    "en_proceso",
    "sin_registro",
    "fuera_de_bitacora",
}
UFE_TIPOS = {"BO", "FA", "NC", "ND"}
UFE_GENERADORES = {"OK REGISTRADO", "SIN OK", "SIN TRAZA", "NO APLICA"}
UFE_SUNAT = {
    "ACEPTADO",
    "SUNAT NO ENCONTRADO",
    "SUNAT NO ACEPTADO",
    "SUNAT SIN CONSULTA",
}


def _protected(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(401, "Autenticación requerida")
    return user


def _actor_email(request: Request) -> str:
    user = current_user(request) or {}
    if isinstance(user, dict):
        return str(user.get("email", ""))
    return ""


@router.get("")
async def listar_ufe(
    request: Request,
    desde: str = Query(..., min_length=10, max_length=10),
    hasta: str = Query(..., min_length=10, max_length=10),
    resultado: str = Query("", max_length=20),
    estado: str = Query("", max_length=200),
    incidencia: str = Query("", max_length=60),
    tipo: str = Query("", max_length=4),
    generador: str = Query("", max_length=20),
    sunat: str = Query("", max_length=30),
    sucursal: int | None = Query(None),
    q: str = Query("", max_length=80),
):
    """Comprobantes de origen Intelisis y su estado de generacion (UFE).

    Solo lectura: la consulta porta el universo de ``dbo.PUSP_ControlFac`` y
    no ejecuta ningun procedimiento almacenado. Los filtros se aplican en el
    servidor: con 31 dias el universo llega a ~18.000 documentos.
    """
    _protected(request)
    estados = [item.strip() for item in estado.split(",") if item.strip()]
    unknown = [item for item in estados if item not in UFE_ESTADOS]
    if unknown:
        raise HTTPException(400, "Estado de generacion invalido.")
    if resultado and resultado.upper() not in {"CONFORME", "REVISAR"}:
        raise HTTPException(400, "Resultado invalido.")
    if tipo and tipo.upper() not in UFE_TIPOS:
        raise HTTPException(400, "Tipo de documento invalido.")
    tipos = [item.strip().upper() for item in tipo.split(",") if item.strip()]
    invalid_tipos = [item for item in tipos if item not in UFE_TIPOS]
    if invalid_tipos:
        raise HTTPException(400, "Tipo de documento invalido.")
    if generador and generador.upper() not in UFE_GENERADORES:
        raise HTTPException(400, "Generador invalido.")
    if sunat and sunat.upper() not in UFE_SUNAT:
        raise HTTPException(400, "Estado SUNAT invalido.")
    try:
        return await run_blocking(
            clean_intelisis_ufe_list,
            desde,
            hasta,
            resultado=resultado.upper(),
            estados=estados,
            incidencia=incidencia,
            tipo="",
            tipos=tipos,
            generador=generador.upper(),
            sunat=sunat.upper(),
            sucursal=sucursal,
            q=q,
            correlation_id=request_id_var.get(),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Intelisis UFE list failed")
        raise HTTPException(
            502, "No fue posible consultar los comprobantes de Intelisis."
        ) from exc


@router.get("/buscar")
async def buscar_ufe(
    request: Request,
    documento: str = Query(..., min_length=3, max_length=40),
):
    """Busca un comprobante UFE por su numero oficial (sin periodo)."""
    _protected(request)
    try:
        return await run_blocking(
            clean_intelisis_ufe_buscar, documento, request_id_var.get()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Intelisis UFE search failed")
        raise HTTPException(
            502, "No fue posible buscar el comprobante."
        ) from exc


@router.get("/{id_venta}")
async def detalle_ufe(request: Request, id_venta: int):
    """Trazabilidad de un comprobante: venta, intentos del generador y SUNAT."""
    _protected(request)
    try:
        return await run_blocking(
            clean_intelisis_ufe_detail, id_venta, request_id_var.get()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Intelisis UFE detail failed")
        raise HTTPException(
            502, "No fue posible consultar la trazabilidad del comprobante."
        ) from exc


@router.post("/validar")
async def validar_ufe(request: Request):
    """Consulta individual en SUNAT y deja el estado en el cache local.

    No escribe en Intelisis.
    """
    _protected(request)
    body = await read_json_limited(request, MAX_REQUEST_BYTES)
    data = body if isinstance(body, dict) else {}
    try:
        id_venta = int(data.get("id_venta", 0) or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "Identificador de comprobante inválido.")
    if id_venta <= 0:
        raise HTTPException(400, "Identificador de comprobante inválido.")
    try:
        return await run_blocking(
            clean_intelisis_ufe_validate,
            id_venta,
            _actor_email(request),
            request_id_var.get(),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Intelisis UFE validation failed")
        raise HTTPException(502, "No fue posible validar en SUNAT.") from exc
