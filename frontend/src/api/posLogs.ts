import { api } from "./client";
import type { PosAnalysis, PosEventoResponse } from "./types";

export type PosOrden = "reciente" | "antiguo";

export interface PosAnalysisParams {
  desde: string;
  hasta: string;
  nivel?: string;
  clave?: string;
  instancia?: string;
  serial?: string;
  q?: string;
  orden?: PosOrden;
  page?: number;
  limit?: number;
}

function query(values: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  return search.toString();
}

/** Una llamada por ventana: el backend cachea el snapshot y filtra en memoria. */
export function getPosAnalysis(
  params: PosAnalysisParams,
  signal?: AbortSignal,
): Promise<PosAnalysis> {
  return api<PosAnalysis>(`/api/pos/analisis?${query({ ...params })}`, {
    signal,
  });
}

/** Detalle técnico de un evento (recarga estrecha si la ventana es larga). */
export function getPosEvent(
  params: { oid: string; at: string; desde: string; hasta: string },
  signal?: AbortSignal,
): Promise<PosEventoResponse> {
  return api<PosEventoResponse>(`/api/pos/evento?${query({ ...params })}`, {
    signal,
  });
}


