import type {
  IntelisisUfeSituacion,
  UfeEstadoGeneracion,
  UfeEstadoSunat,
  UfeEstatusErp,
} from "../api/types";

/** Tono semántico de un estado (nunca es el único portador del significado). */
export type UfeTono = "ok" | "warn" | "bad" | "muted" | "neutral";

/** Etiquetas del estado del generador (columna "Estado"). */
export const ESTADO_GENERACION_LABEL: Record<UfeEstadoGeneracion, string> = {
  generado: "Generado",
  error_validacion: "Error de validación",
  omitido_validacion: "Omitido en validación",
  sin_bloque: "Sin bloque de tipo",
  en_proceso: "En proceso",
  sin_registro: "Sin registro",
  fuera_de_bitacora: "Fuera de bitácora",
};

/** Etiquetas del estado SUNAT. */
export const ESTADO_SUNAT_LABEL: Record<UfeEstadoSunat, string> = {
  ACEPTADO: "Aceptado",
  AUTORIZADO: "Autorizado",
  PENDIENTE: "En cola",
  PROCESANDO: "Procesando",
  "SUNAT NO ENCONTRADO": "No encontrado",
  "SUNAT NO ACEPTADO": "No aceptado",
  ERROR: "Error de validación",
  "SUNAT SIN CONSULTA": "Sin consulta",
};

/** Orden del ciclo de vida: el card lista los estados en este orden. */
export const ESTADOS_GENERACION: UfeEstadoGeneracion[] = [
  "generado",
  "en_proceso",
  "error_validacion",
  "omitido_validacion",
  "sin_bloque",
  "sin_registro",
  "fuera_de_bitacora",
];

export const ESTADOS_SUNAT: UfeEstadoSunat[] = [
  "ACEPTADO",
  "AUTORIZADO",
  "PENDIENTE",
  "PROCESANDO",
  "SUNAT NO ENCONTRADO",
  "SUNAT NO ACEPTADO",
  "ERROR",
  "SUNAT SIN CONSULTA",
];

/* --- Eje ERP: los cuatro estados de `dbo.Venta` ------------------------- */

/**
 * Estado de la venta en el ERP. El listado solo puede devolver CONCLUIDO y
 * PENDIENTE; SINAFECTAR y CANCELADO se cuentan en la tarjeta (no tienen
 * comprobante electrónico y por eso no aparecen en la grilla).
 */
export const ERP_ESTADOS: UfeEstatusErp[] = [
  "CONCLUIDO",
  "PENDIENTE",
  "SINAFECTAR",
  "CANCELADO",
];

export const ERP_ESTADO_LABEL: Record<UfeEstatusErp, string> = {
  CONCLUIDO: "Concluida",
  PENDIENTE: "Pendiente",
  SINAFECTAR: "Sin afectar",
  CANCELADO: "Cancelada",
};

export const ERP_ESTADO_TONO: Record<UfeEstatusErp, UfeTono> = {
  CONCLUIDO: "ok",
  PENDIENTE: "warn",
  SINAFECTAR: "muted",
  CANCELADO: "neutral",
};

export const ERP_ESTADO_DESC: Record<UfeEstatusErp, string> = {
  CONCLUIDO: "Afectada y concluida en el ERP.",
  PENDIENTE: "Registrada, sin conclusión en el ERP.",
  SINAFECTAR: "No llegó a afectarse: no tiene comprobante electrónico emitido.",
  CANCELADO: "Cancelada en el ERP; no forma parte del listado.",
};

/* --- Eje Validador: estados del generador + derivados ------------------- */

/**
 * Claves derivadas que no existen como estado técnico pero explican el
 * desglose: viven en los KPIs y no se pueden filtrar en el servidor.
 */
export type UfeEstadoDerivado =
  | "sin_traza"
  | "pendientes_conclusion"
  | "en_espera"
  | "no_aplica";

export const ESTADO_GENERACION_TONO: Record<UfeEstadoGeneracion, UfeTono> = {
  generado: "ok",
  error_validacion: "bad",
  omitido_validacion: "bad",
  sin_bloque: "bad",
  en_proceso: "warn",
  sin_registro: "muted",
  fuera_de_bitacora: "muted",
};

export const ESTADO_GENERACION_DESC: Record<UfeEstadoGeneracion, string> = {
  generado: "El generador emitió el documento electrónico.",
  error_validacion: "El generador rechazó la validación del documento.",
  omitido_validacion:
    "El generador omitió la validación: el número de documento no era válido.",
  sin_bloque: "No se encontró el bloque de tipo de documento.",
  en_proceso: "El generador está trabajando en este documento.",
  sin_registro: "Sin fila en la bitácora del generador.",
  fuera_de_bitacora: "Emitida antes del inicio de la bitácora (24-09-2026).",
};

export const DERIVADO_LABEL: Record<UfeEstadoDerivado, string> = {
  sin_traza: "Sin traza",
  pendientes_conclusion: "Pendiente de conclusión",
  en_espera: "En ventana de gracia",
  no_aplica: "No aplica",
};

export const DERIVADO_TONO: Record<UfeEstadoDerivado, UfeTono> = {
  sin_traza: "bad",
  pendientes_conclusion: "muted",
  en_espera: "muted",
  no_aplica: "muted",
};

export const DERIVADO_DESC: Record<UfeEstadoDerivado, string> = {
  sin_traza:
    "Concluida en el ERP sin registro en la bitácora: es un fallo del generador.",
  pendientes_conclusion:
    "Todavía no concluida en el ERP: no debía pasar por el generador (D19).",
  en_espera:
    "Emitida hace menos de 4 horas: el generador puede tardar en tomarla.",
  no_aplica:
    "Nota de crédito que acredita un documento de SynerPOS (SE-*).",
};

/* --- Eje SUNAT --------------------------------------------------------- */

export const ESTADO_SUNAT_TONO: Record<UfeEstadoSunat, UfeTono> = {
  ACEPTADO: "ok",
  AUTORIZADO: "ok",
  PENDIENTE: "muted",
  PROCESANDO: "neutral",
  "SUNAT NO ACEPTADO": "bad",
  "SUNAT NO ENCONTRADO": "bad",
  ERROR: "bad",
  "SUNAT SIN CONSULTA": "muted",
};

export const ESTADO_SUNAT_DESC: Record<UfeEstadoSunat, string> = {
  ACEPTADO: "SUNAT aceptó el comprobante.",
  AUTORIZADO: "SUNAT autorizó el comprobante.",
  PENDIENTE: "El lote está en cola en SUNAT.",
  PROCESANDO: "SUNAT está procesando el lote.",
  "SUNAT NO ACEPTADO": "SUNAT rechazó el comprobante.",
  "SUNAT NO ENCONTRADO": "El comprobante no existe en SUNAT.",
  ERROR:
    "El validador rechazó la consulta: revisa la serie y el número enviados.",
  "SUNAT SIN CONSULTA": "Todavía no se consultó en SUNAT.",
};

/* --- Diálogo "Ventas sin documentar" ----------------------------------- */

export const SITUACION_LABEL: Record<IntelisisUfeSituacion, string> = {
  sin_documento: "Sin documento",
  documento_invalido: "Documento inválido",
};
