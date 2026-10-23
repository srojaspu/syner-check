"""Casos de uso del reenvio manual al generador UFE.

Orquesta dos piezas por puertos: el lector de comprobantes (para validar el
estado antes de encolar) y la cola del ERP (``dbo.FE_Reenvio``). No conoce
FastAPI, pyodbc ni el reloj real.

Contrato del reenvio, en una linea: **encolar no genera**; el worker PHP del
ERP (``rmand2/bin/fe_worker.php``) es el unico que ejecuta el SP, de a un
documento, y nunca reintenta solo cuando el resultado es incierto. Nuestra
aplicacion solo escribe la intencion en la misma cola que usa el ERP.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Sequence

from src.application.intelisis_ufe_filas import fila_documento
from src.application.ports import IntelisisReenvioQueue, IntelisisUfeReader
from src.domain import intelisis_reenvio as dominio
from src.domain.errors import ReenvioNoPermitidoError

logger = logging.getLogger("syner_check.intelisis_reenvio")


def encolar_reenvio(
    reader: IntelisisUfeReader,
    queue: IntelisisReenvioQueue,
    *,
    ids: Sequence[object],
    usuario: str,
    motivo: str,
    forzar: bool = False,
    max_batch: int = 10,
    correlation_id: str = "",
    token: str = "",
    now: datetime | None = None,
) -> dict[str, Any]:
    """Valida cada comprobante y lo encola. Devuelve el resultado por documento.

    Un lote no es atomico a proposito: si un documento esta en curso, los
    demas se encolan igual y el usuario ve exactamente cual fallo y por que.

    ``token`` identifica la solicitud completa (idempotencia): el navegador lo
    genera al abrir la confirmacion y lo repite si el usuario reintenta. Cada
    fila recibe un token derivado porque ``FE_Reenvio.Token`` es unico.
    """
    limpios = dominio.validar_peticion(ids, max_batch)
    motivo_limpio = dominio.validar_motivo(motivo)
    actor = str(usuario or "").strip()
    if not actor:
        raise ValueError("Falta el usuario que solicita el reenvio.")
    token_lote = dominio.validar_token(token) if token else dominio.nuevo_token()
    momento = now or datetime.now()

    detalle: list[dict[str, Any]] = []
    encolados = 0
    duplicados = 0
    for id_venta in limpios:
        item: dict[str, Any] = {
            "id_venta": id_venta,
            "documento": "",
            "tipo": "",
            "procedimiento": "",
            "estado": "rechazado",
            "motivo": "",
            "queue_id": None,
        }
        rows = reader.fetch_row(id_venta)
        if not rows:
            item["motivo"] = "Comprobante no encontrado."
            detalle.append(item)
            continue
        fila = fila_documento(rows[0], momento)
        item["documento"] = fila.get("documento") or ""
        try:
            tipo = dominio.validar_encolado(
                estatus_erp=fila.get("estatus_erp", ""),
                estado_generacion=fila.get("estado_generacion", ""),
                tipo_documento_pu=fila.get("tipo_documento_pu", ""),
                exento_generador=bool(fila.get("exento_generador")),
                forzar=bool(forzar),
            )
        except ReenvioNoPermitidoError as exc:
            item["motivo"] = str(exc)
            detalle.append(item)
            continue

        try:
            creado = queue.encolar(
                id_venta=id_venta,
                usuario=actor,
                motivo=motivo_limpio,
                token=dominio.token_fila(token_lote, id_venta),
                correlation_id=correlation_id,
            )
        except ReenvioNoPermitidoError as exc:
            item["motivo"] = str(exc)
            detalle.append(item)
            continue
        item["tipo"] = tipo
        item["procedimiento"] = dominio.procedimiento_para(tipo)
        item["queue_id"] = int(creado["id"])
        if creado.get("duplicado"):
            item["estado"] = "ya_registrado"
            item["motivo"] = "Solicitud ya registrada; no se duplico."
            duplicados += 1
        else:
            item["estado"] = "encolado"
            encolados += 1
        detalle.append(item)

    rechazados = len(detalle) - encolados - duplicados
    logger.info(
        "Intelisis UFE resend enqueue correlation_id=%s actor=%s token=%s "
        "total=%d encolados=%d duplicados=%d rechazados=%d forzar=%s",
        correlation_id,
        actor,
        token_lote[:8],
        len(detalle),
        encolados,
        duplicados,
        rechazados,
        bool(forzar),
    )
    return {
        "total": len(detalle),
        "encolados": encolados,
        "duplicados": duplicados,
        "rechazados": rechazados,
        "detalle": detalle,
    }


def listar_reenvios(
    queue: IntelisisReenvioQueue,
    *,
    limit: int = 20,
    estado: str = "",
) -> dict[str, Any]:
    """Panel de cola: worker, pendientes, activos, historial y conteos."""
    filtro = str(estado or "").strip().upper()
    if filtro and filtro not in dominio.ESTADOS:
        raise ValueError("Estado de reenvio invalido.")
    return queue.panel(limit=max(1, min(int(limit), 200)), estado=filtro)


def resolver_reenvio(
    queue: IntelisisReenvioQueue,
    *,
    queue_id: int,
    actor: str,
    nota: str,
    correlation_id: str = "",
) -> dict[str, Any]:
    """Cierra a mano un NO_CONFIRMADO (paridad ``feop_resolve``)."""
    identificador = int(queue_id)
    if identificador <= 0:
        raise ValueError("Identificador de reenvio invalido.")
    persona = str(actor or "").strip()
    if not persona:
        raise ValueError("Falta el usuario que resuelve el reenvio.")
    texto = dominio.validar_nota(nota)
    resultado = queue.resolver(identificador, actor=persona, nota=texto)
    logger.info(
        "Intelisis UFE resend resolved queue_id=%d actor=%s correlation_id=%s",
        identificador,
        persona,
        correlation_id,
    )
    return {
        "queue_id": identificador,
        "estado": dominio.REVISADO_MANUAL,
        "mensaje": resultado.get("mensaje", ""),
    }


__all__ = [
    "encolar_reenvio",
    "listar_reenvios",
    "resolver_reenvio",
]
