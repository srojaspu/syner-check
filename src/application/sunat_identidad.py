"""Identidad y estado de un comprobante en SUNAT.

Reglas compartidas por los dos flujos que consultan SUNAT:

- el flujo de SynerPOS (``src.application.use_cases``), que valida vouchers
  con numero ``SERIE-CORRELATIVO``;
- el flujo de Intelisis UFE (``src.application.intelisis_ufe``), que arma la
  identidad desde el documento oficial del comprobante.

Viven aqui para que las dos rutas usen exactamente la misma clave de cache
``(ruc, tipo, serie, numero)`` y el mismo payload al validador. Un desajuste
entre ellas se traduce en "SUNAT sin consultar" en pantalla, asi que el modulo
es deliberadamente pequeno y sin dependencias externas.
"""

from __future__ import annotations

import math
from datetime import date

# Tipo de comprobante (el del dominio de SUNAT) -> codigo de dos digitos.
TIPO_CODES: dict[str, str] = {
    "FACTURA": "01",
    "BOLETA": "03",
    "NOTA DE CREDITO": "07",
}

# Estados que devuelve el validador.
ESTADOS_CONOCIDOS: tuple[str, ...] = (
    "ACEPTADO",
    "NO_EXISTE",
    "ANULADO",
    "AUTORIZADO",
    "NO_AUTORIZADO",
    "DESCONOCIDO",
)


def norm_numero(raw: object) -> str:
    """Cache-key numero: los ceros a la izquierda no significan nada.

    ``'00000152'`` y ``'152'`` son el mismo comprobante. El payload al
    validador conserva el numero tal como se imprimio; solo la clave del
    cache se normaliza.
    """
    text = str(raw or "").strip()
    return text.lstrip("0") or "0" if text else ""


def sunat_cache_key(
    ruc: str, tipo_value: str, number: str
) -> tuple[str, str, str, str] | None:
    """Clave del cache SUNAT ``(ruc, tipo, serie, numero)`` o None.

    ``number`` es ``SERIE-CORRELATIVO``. Un numero sin correlativo, con
    letras o una serie larga no se puede consultar contra SUNAT.
    """
    code = TIPO_CODES.get(str(tipo_value or "").strip().upper(), "")
    text = str(number or "").strip().upper()
    if not code or "-" not in text:
        return None
    serie, _, numero = text.rpartition("-")
    serie = serie.strip()
    if not serie or len(serie) > 20 or not numero.strip().isdigit():
        return None
    if len(numero.strip()) > 20:
        return None
    numero = norm_numero(numero)
    if not serie or not numero:
        return None
    return (str(ruc).strip(), code, serie, numero)


def sunat_doc_payload(
    ruc: str, tipo_value: str, number: str, date_iso: str, importe: object
) -> dict[str, object]:
    """Payload al validador para un comprobante; lanza ValueError si no aplica.

    El numero conserva los ceros con que se imprimio: SUNAT identifica el
    documento por serie y correlativo, y el PDF debe mostrarlo igual.
    """
    clean_ruc = str(ruc or "").strip()
    if not clean_ruc.isdigit() or len(clean_ruc) != 11:
        raise ValueError(f"RUC emisor inválido para SUNAT: {ruc!r}.")
    key = sunat_cache_key(clean_ruc, tipo_value, number)
    if key is None:
        raise ValueError(f"Número/tipo no válido para SUNAT: {number!r}.")
    try:
        day = date.fromisoformat(str(date_iso or "")[:10])
    except ValueError as exc:
        raise ValueError(f"Fecha no válida para SUNAT: {date_iso!r}.") from exc
    try:
        amount = round(float(importe), 2)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Importe no válido para SUNAT: {importe!r}.") from exc
    if not math.isfinite(amount) or amount < 0:
        raise ValueError(f"Importe no válido para SUNAT: {importe!r}.")
    _, code, serie, _normalized = key
    numero = str(number or "").strip().upper().rpartition("-")[2].strip()
    return {
        "ruc": clean_ruc,
        "tipo": code,
        "serie": serie,
        "numero": numero,
        "fecha_emision": day.isoformat(),
        "importe": amount,
    }


def sunat_map_estado(raw: object) -> str:
    """Estado del validador, normalizado a los valores conocidos."""
    token = str(raw or "").strip().upper()
    return token if token in ESTADOS_CONOCIDOS else "DESCONOCIDO"
