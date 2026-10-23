"""Reglas del reenvio manual al generador UFE (dominio puro).

La cola es ``dbo.FE_Reenvio`` de PUnidas: la misma tabla y el mismo worker
que usa el ERP (``C:\\Projects\\PHP\\rmand2``, ``bin/fe_worker.php`` en su
tarea programada). Este modulo solo modela el contrato: que se puede encolar,
con que tipo y que procedimiento, y cuando un caso se cierra a mano. No
conoce pyodbc, ni el reloj, ni FastAPI.

Ciclo de vida (``CK_FE_Reenvio_Estado``)::

    EN_COLA -> EJECUTANDO -> FINALIZADO_OK | FINALIZADO_REVISAR
                          -> NO_CONFIRMADO | NO_EJECUTADO
    NO_CONFIRMADO -> REVISADO_MANUAL      (solo por accion humana)

El generador lo ejecuta el worker del ERP, fuera de nuestro proceso: aqui
nunca se ejecuta un SP, solo se registra la intencion.
"""

from __future__ import annotations

from hashlib import sha256
from typing import Sequence
from uuid import uuid4

from src.domain import intelisis_ufe as ufe
from src.domain.errors import ReenvioNoPermitidoError

# --- Estados de la cola ----------------------------------------------------

EN_COLA = "EN_COLA"
EJECUTANDO = "EJECUTANDO"
FINALIZADO_OK = "FINALIZADO_OK"
FINALIZADO_REVISAR = "FINALIZADO_REVISAR"
NO_EJECUTADO = "NO_EJECUTADO"
NO_CONFIRMADO = "NO_CONFIRMADO"
REVISADO_MANUAL = "REVISADO_MANUAL"

ESTADOS: tuple[str, ...] = (
    EN_COLA,
    EJECUTANDO,
    FINALIZADO_OK,
    FINALIZADO_REVISAR,
    NO_EJECUTADO,
    NO_CONFIRMADO,
    REVISADO_MANUAL,
)

# Estados que bloquean un segundo reenvio del mismo comprobante: es la misma
# guarda de ``feop_enqueue`` (``EN_COLA``, ``EJECUTANDO``, ``NO_CONFIRMADO``).
ESTADOS_ACTIVOS: tuple[str, ...] = (EN_COLA, EJECUTANDO, NO_CONFIRMADO)
ESTADOS_FINALES: tuple[str, ...] = (
    FINALIZADO_OK,
    FINALIZADO_REVISAR,
    NO_EJECUTADO,
    REVISADO_MANUAL,
)

# --- Generadores (lista cerrada, igual que ``feop_proc``) ------------------

PROC_UBL21 = "SPPUFE_UBL21"
PROC_NCND = "SPPUFE_UBL21_NCND"
PROCEDIMIENTOS: tuple[str, ...] = (PROC_UBL21, PROC_NCND)

# --- Tipos de comprobante (columna ``Tipo`` char(2) de FE_Reenvio) ---------

TIPO_FACTURA = "01"
TIPO_BOLETA = "03"
TIPO_NC = "07"
TIPO_ND = "08"
TIPOS: tuple[str, ...] = (TIPO_FACTURA, TIPO_BOLETA, TIPO_NC, TIPO_ND)
TIPOS_NC_ND = {TIPO_NC, TIPO_ND}

# --- Limites de entrada ----------------------------------------------------

MOTIVO_MAX = 500  # nvarchar(500) de FE_Reenvio.Motivo
NOTA_MAX = 500  # nvarchar(500) de FE_Reenvio.Revision
LOTE_MAX = 50
TOKEN_LARGO = 32
_HEX = set("0123456789abcdef")

# Estados de generacion que SI se pueden reenviar: el documento no tiene un
# resultado valido en la bitacora.
ESTADOS_REENVIABLES = {
    ufe.ESTADO_SIN_REGISTRO,
    ufe.ESTADO_ERROR_VALIDACION,
    ufe.ESTADO_OMITIDO_VALIDACION,
    ufe.ESTADO_SIN_BLOQUE,
    ufe.ESTADO_FUERA_DE_BITACORA,
}

# Estados que solo se aceptan con ``forzar``: ya hay un documento emitido.
# El flag es una confirmacion de la API, no una columna: FE_Reenvio es del
# ERP y no se le agregan columnas.
ESTADOS_SOLO_FORZANDO = {ufe.ESTADO_GENERADO}

# Estados que nunca se aceptan: el generador esta trabajando.
ESTADOS_BLOQUEADOS = {ufe.ESTADO_EN_PROCESO}


def tipo_comprobante(valor: object) -> str:
    """Normaliza el ``TipoDocumentoPU`` de Intelisis: ``01``/``03``/``07``/``08``."""
    tipo = str(valor or "").strip()
    if tipo.isdigit() and len(tipo) == 1:
        tipo = tipo.zfill(2)
    if tipo not in TIPOS:
        raise ReenvioNoPermitidoError(
            "El tipo de comprobante no se puede reenviar."
        )
    return tipo


def procedimiento_para(tipo: object) -> str:
    """Generador que corresponde al tipo (misma tabla que ``feop_proc``)."""
    codigo = tipo_comprobante(tipo)
    return PROC_NCND if codigo in TIPOS_NC_ND else PROC_UBL21


def validar_encolado(
    *,
    estatus_erp: str,
    estado_generacion: str,
    tipo_documento_pu: object,
    exento_generador: bool = False,
    forzar: bool = False,
) -> str:
    """Valida un comprobante antes de encolarlo y devuelve su tipo normalizado.

    Raises:
        ReenvioNoPermitidoError: con un mensaje apto para mostrar al usuario.
    """
    estatus = str(estatus_erp or "").strip().upper()
    if estatus != "CONCLUIDO":
        raise ReenvioNoPermitidoError(
            "Solo se puede reenviar un comprobante concluido."
        )
    if exento_generador:
        raise ReenvioNoPermitidoError(
            "Este documento no pasa por el generador de Intelisis "
            "(nota de credito sobre un documento de SynerPOS)."
        )
    estado = str(estado_generacion or "").strip()
    if estado in ESTADOS_BLOQUEADOS:
        raise ReenvioNoPermitidoError(
            "El generador esta trabajando en este documento; "
            "espera a que termine antes de reenviar."
        )
    if estado in ESTADOS_SOLO_FORZANDO and not forzar:
        raise ReenvioNoPermitidoError(
            "El documento ya esta generado. Confirma 'forzar' para regenerarlo."
        )
    if estado not in ESTADOS_REENVIABLES and estado not in ESTADOS_SOLO_FORZANDO:
        raise ReenvioNoPermitidoError(
            "El estado del documento no permite reenviarlo."
        )
    return tipo_comprobante(tipo_documento_pu)


def validar_peticion(ids: Sequence[object], max_batch: int) -> list[int]:
    """Normaliza la lista de documentos de una solicitud de reenvio.

    Rechaza listas vacias, documentos repetidos, identificadores invalidos y
    lotes por encima del tope. Devuelve los ids en el orden recibido.
    """
    tope = max(1, int(max_batch))
    limpios: list[int] = []
    vistos: set[int] = set()
    for item in ids:
        try:
            id_venta = int(item)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            raise ValueError("Identificador de comprobante invalido.") from None
        if id_venta <= 0:
            raise ValueError("Identificador de comprobante invalido.")
        if id_venta in vistos:
            raise ValueError("La solicitud repite un comprobante.")
        vistos.add(id_venta)
        limpios.append(id_venta)
    if not limpios:
        raise ValueError("Selecciona al menos un comprobante.")
    if len(limpios) > tope:
        raise ValueError(
            f"El lote supera el maximo de {tope} comprobantes por solicitud."
        )
    return limpios


def validar_motivo(motivo: object) -> str:
    """Motivo obligatorio, 1..500 caracteres y sin caracteres de control.

    Es la misma validacion de ``feop_text``: un reenvio sin motivo no deja
    trazabilidad en la cola del ERP.
    """
    return _texto(motivo, MOTIVO_MAX, "El motivo")


def validar_nota(nota: object) -> str:
    """Una resolucion manual exige nota: sin ella no hay trazabilidad."""
    return _texto(nota, NOTA_MAX, "La nota de revision")


def _texto(valor: object, maximo: int, etiqueta: str) -> str:
    texto = str(valor or "").strip()
    if not texto:
        raise ValueError(f"{etiqueta} es obligatorio.")
    if len(texto) > maximo:
        raise ValueError(f"{etiqueta} no puede superar {maximo} caracteres.")
    if any(ord(caracter) < 32 or ord(caracter) == 127 for caracter in texto):
        raise ValueError(f"{etiqueta} contiene caracteres no permitidos.")
    return texto


def validar_token(token: object) -> str:
    """Token de idempotencia: 32 caracteres hexadecimales (como ``feop_enqueue``)."""
    texto = str(token or "").strip().lower()
    if len(texto) != TOKEN_LARGO or any(caracter not in _HEX for caracter in texto):
        raise ValueError("Token de solicitud invalido.")
    return texto


def nuevo_token() -> str:
    """Token nuevo para una solicitud que no trae uno."""
    return uuid4().hex


def token_fila(token_lote: str, id_venta: int) -> str:
    """Token unico por fila, derivado del token de la solicitud.

    ``FE_Reenvio.Token`` es unico por fila: un lote de N documentos necesita
    N tokens. Derivarlos de forma determinista conserva la idempotencia: el
    mismo token + el mismo documento producen siempre la misma fila.
    """
    base = f"{validar_token(token_lote)}:{int(id_venta)}"
    return sha256(base.encode("utf-8")).hexdigest()[:TOKEN_LARGO]


def puede_resolver(estado: str) -> bool:
    """Solo un NO_CONFIRMADO se resuelve a mano (``feop_resolve``)."""
    return str(estado or "").strip().upper() == NO_CONFIRMADO


__all__ = [
    "EJECUTANDO",
    "EN_COLA",
    "ESTADOS",
    "ESTADOS_ACTIVOS",
    "ESTADOS_FINALES",
    "FINALIZADO_OK",
    "FINALIZADO_REVISAR",
    "LOTE_MAX",
    "MOTIVO_MAX",
    "NOTA_MAX",
    "NO_CONFIRMADO",
    "NO_EJECUTADO",
    "PROCEDIMIENTOS",
    "PROC_NCND",
    "PROC_UBL21",
    "REVISADO_MANUAL",
    "TIPOS",
    "TIPOS_NC_ND",
    "nuevo_token",
    "procedimiento_para",
    "puede_resolver",
    "tipo_comprobante",
    "token_fila",
    "validar_encolado",
    "validar_motivo",
    "validar_nota",
    "validar_peticion",
    "validar_token",
]
