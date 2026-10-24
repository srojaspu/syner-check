import type { UfeEstadoGeneracion, UfeEstadoSunat } from "../api/types";

/** Etiquetas del estado del generador (columna "Estado"). */
export const ESTADO_GENERACION_LABEL: Record<UfeEstadoGeneracion, string> = {
  generado: "Generado",
  error_validacion: "Error de validación",
  omitido_validacion: "Omitido en validación",
  sin_bloque: "Sin bloque de tipo",
  en_proceso: "En proceso",
  sin_registro: "Sin traza",
  fuera_de_bitacora: "Fuera de bitácora",
};

/** Etiquetas del estado SUNAT. */
export const ESTADO_SUNAT_LABEL: Record<UfeEstadoSunat, string> = {
  ACEPTADO: "Aceptado",
  "SUNAT NO ENCONTRADO": "No encontrado",
  "SUNAT NO ACEPTADO": "No aceptado",
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
  "SUNAT NO ENCONTRADO",
  "SUNAT NO ACEPTADO",
  "SUNAT SIN CONSULTA",
];
