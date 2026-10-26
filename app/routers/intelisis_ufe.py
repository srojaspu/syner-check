"""Endpoints de la pantalla Intelisis UFE.

Viven en un router propio para que ``app.main`` siga siendo el punto de
composicion de la aplicacion y no se llene de handlers de una sola
pantalla.

Solo lectura, salvo dos escrituras acotadas: la validación individual en
SUNAT (guarda el estado en la base de syner-check) y el reenvío manual (una
fila ``EN_COLA`` en ``dbo.FE_Reenvio``, la cola del propio ERP). Esta
aplicación nunca ejecuta el generador UFE: eso es del worker PHP del ERP.
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
    intelisis_reenvio_encolar as clean_intelisis_reenvio_encolar,
    intelisis_reenvio_resolver as clean_intelisis_reenvio_resolver,
    intelisis_reenvios_listar as clean_intelisis_reenvios_listar,
    intelisis_ufe_buscar as clean_intelisis_ufe_buscar,
    intelisis_ufe_detail as clean_intelisis_ufe_detail,
    intelisis_ufe_list as clean_intelisis_ufe_list,
    intelisis_ufe_sin_documento as clean_intelisis_ufe_sin_documento,
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
# Estados derivados del card Validador: agrupan por el mismo criterio que los
# KPIs, no por `estado_generacion`.
UFE_DERIVADOS = {
    "sin_traza",
    "pendientes_conclusion",
    "en_espera",
    "no_aplica",
}
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
    derivado: str = Query("", max_length=32),
    incidencia: str = Query("", max_length=60),
    tipo: str = Query("", max_length=20),
    generador: str = Query("", max_length=20),
    sunat: str = Query("", max_length=30),
    estatus: str = Query("", max_length=20),
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
    if derivado and derivado not in UFE_DERIVADOS:
        raise HTTPException(400, "Estado derivado invalido.")
    if resultado and resultado.upper() not in {"CONFORME", "REVISAR"}:
        raise HTTPException(400, "Resultado invalido.")
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
            derivado=derivado,
            incidencia=incidencia,
            tipos=tipos,
            generador=generador.upper(),
            sunat=sunat.upper(),
            estatus=estatus.upper(),
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


@router.get("/reenvios")
async def listar_reenvios_ufe(
    request: Request,
    limit: int = Query(20, ge=1, le=200),
    estado: str = Query("", max_length=20),
):
    """Panel de la cola del ERP: worker, pendientes, activos e historial."""
    _protected(request)
    try:
        return await run_blocking(
            clean_intelisis_reenvios_listar, limit, estado
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Intelisis UFE resend queue read failed")
        raise HTTPException(
            502, "No fue posible consultar la cola de reenvíos."
        ) from exc


@router.post("/reenviar")
async def reenviar_ufe(request: Request):
    """Encola uno o varios reenvíos en la cola del ERP (``dbo.FE_Reenvio``).

    No ejecuta el SP: el worker PHP del ERP es el único que genera. Aquí solo
    se registra la intención con auditoría (usuario, motivo, token). Un
    documento rechazado no bloquea a los demás del lote.

    ``token`` es la clave de idempotencia de la solicitud (32 hex): si el
    navegador reintenta con el mismo token, no se duplica la fila.
    """
    _protected(request)
    body = await read_json_limited(request, MAX_REQUEST_BYTES)
    data = body if isinstance(body, dict) else {}
    raw_ids = data.get("ids")
    if raw_ids is None and data.get("id_venta") is not None:
        raw_ids = [data.get("id_venta")]
    if not isinstance(raw_ids, list) or not raw_ids:
        raise HTTPException(400, "Indica los comprobantes a reenviar.")
    ids: list[int] = []
    for item in raw_ids:
        try:
            ids.append(int(item))
        except (TypeError, ValueError):
            raise HTTPException(400, "Identificador de comprobante inválido.")
    motivo = data.get("motivo", "")
    motivo = motivo.strip() if isinstance(motivo, str) else ""
    if not motivo or len(motivo) > 500:
        raise HTTPException(
            400, "El motivo debe tener entre 1 y 500 caracteres."
        )
    token_raw = data.get("token", "")
    if token_raw is None:
        token = ""
    elif isinstance(token_raw, str):
        token = token_raw.strip()
    else:
        raise HTTPException(400, "Token de solicitud inválido.")
    if token and (
        len(token) != 32
        or any(caracter not in "0123456789abcdefABCDEF" for caracter in token)
    ):
        raise HTTPException(400, "Token de solicitud inválido.")
    # `forzar` regenera un documento ya emitido: solo el booleano JSON `true`
    # lo activa. Un "false" (texto), 1 o cualquier otra cosa no fuerza.
    forzar = data.get("forzar") is True
    try:
        return await run_blocking(
            clean_intelisis_reenvio_encolar,
            ids,
            motivo,
            forzar,
            _actor_email(request),
            request_id_var.get(),
            token,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Intelisis UFE resend enqueue failed")
        raise HTTPException(502, "No fue posible encolar el reenvío.") from exc


@router.post("/reenvios/{queue_id}/resolver")
async def resolver_reenvio_ufe(request: Request, queue_id: int):
    """Cierra a mano un NO_CONFIRMADO de la cola del ERP (nota obligatoria)."""
    _protected(request)
    body = await read_json_limited(request, MAX_REQUEST_BYTES)
    data = body if isinstance(body, dict) else {}
    nota = data.get("nota", "")
    nota = nota if isinstance(nota, str) else ""
    try:
        return await run_blocking(
            clean_intelisis_reenvio_resolver,
            queue_id,
            nota,
            _actor_email(request),
            request_id_var.get(),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Intelisis UFE resend resolve failed")
        raise HTTPException(502, "No fue posible resolver el reenvío.") from exc


@router.get("/sin-documento")
async def ventas_sin_documento(
    request: Request,
    desde: str = Query(..., min_length=10, max_length=10),
    hasta: str = Query(..., min_length=10, max_length=10),
):
    """Ventas del periodo que no tienen comprobante electronico.

    Declarada antes de ``/{id_venta}``: si no, FastAPI intentaria leer
    "sin-documento" como identificador. Se carga solo al abrir el dialogo:
    no forma parte del listado ni de sus KPIs.
    """
    _protected(request)
    try:
        return await run_blocking(
            clean_intelisis_ufe_sin_documento,
            desde,
            hasta,
            request_id_var.get(),
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Intelisis UFE sin-documento failed")
        raise HTTPException(
            502, "No fue posible consultar las ventas sin documentar."
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
