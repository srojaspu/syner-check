/**
 * Estado de dominio de una operación larga (validación SUNAT, envío a
 * MovSynerPos).
 *
 * Es la única fuente de verdad para saber si el proceso sigue en curso y con
 * qué resultado terminó. No se deriva de etiquetas de UI: antes el modal
 * decidía comparando strings en español y podía quedarse girando para siempre.
 */
export type OperationStatus =
  | "idle"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export function isOperationRunning(status: OperationStatus): boolean {
  return status === "running";
}

/** Resultado terminal a partir de los contadores del proceso. */
export function outcomeFromCounts(problems: number): OperationStatus {
  return problems > 0 ? "partial" : "completed";
}
