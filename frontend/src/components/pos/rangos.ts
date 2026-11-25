export const RANGOS = [
  { id: "1h", label: "1 h", horas: 1 },
  { id: "24h", label: "24 h", horas: 24 },
  { id: "7d", label: "7 días", horas: 24 * 7 },
  { id: "30d", label: "30 días", horas: 24 * 30 },
] as const;

export type RangoId = (typeof RANGOS)[number]["id"];

export const RANGO_POR_DEFECTO: RangoId = "24h";

export function horasDeRango(id: RangoId): number {
  return RANGOS.find((item) => item.id === id)?.horas ?? 24;
}
