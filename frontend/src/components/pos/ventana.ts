import { formatLimaIso } from "./posCatalog";
import { horasDeRango, type RangoId } from "./rangos";

/**
 * Reglas de la ventana de consulta de logs POS.
 *
 * Todo aquí es puro (sin React ni red) para poder probarlo y para que la UI
 * valide exactamente lo mismo que el backend: fechas ISO con offset de Perú,
 * fin posterior al inicio y un máximo de 31 días.
 */

export const MAX_VENTANA_DIAS = 31;
const MINUTO_MS = 60_000;
const DIA_MS = 24 * 60 * MINUTO_MS;
const OFFSET_LIMA = "-05:00";
const MESES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "set",
  "oct",
  "nov",
  "dic",
] as const;

export interface Ventana {
  desde: string;
  hasta: string;
}

export type SeleccionVentana =
  | { tipo: "preset"; rango: RangoId }
  | { tipo: "personalizada" };

export type ResultadoVentana =
  | { ok: true; ventana: Ventana }
  | { ok: false; error: string };

/**
 * Ventana de un preset que termina ahora, redondeada al minuto para que
 * peticiones cercanas compartan la misma entrada de caché del backend.
 */
export function ventanaDeRango(
  rango: RangoId,
  ahora: Date = new Date(),
): Ventana {
  const hasta = new Date(ahora);
  hasta.setSeconds(0, 0);
  const desde = new Date(hasta.getTime() - horasDeRango(rango) * 3_600_000);
  return { desde: formatLimaIso(desde), hasta: formatLimaIso(hasta) };
}

/** Convierte un ISO con offset a la hora de pared de Perú (`YYYY-MM-DDTHH:mm`). */
export function isoAHoraLocal(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatLimaIso(parsed).slice(0, 16);
}

/**
 * Interpreta un valor de `datetime-local` como hora de Perú y lo serializa con
 * offset fijo. A propósito no usa `new Date(valor)`: eso aplicaría la zona del
 * navegador y correría la ventana cinco horas fuera de Lima.
 */
export function horaLocalAIso(valor: string): string | null {
  const texto = valor.trim();
  const conSegundos = texto.length === 16 ? `${texto}:00` : texto;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(conSegundos)) return null;

  const iso = `${conSegundos}${OFFSET_LIMA}`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  // Rechaza fechas que el motor normaliza (p. ej. 31 de febrero).
  if (isoAHoraLocal(iso) !== conSegundos.slice(0, 16)) return null;
  return iso;
}

export function resolverVentanaPersonalizada(
  desdeLocal: string,
  hastaLocal: string,
): ResultadoVentana {
  if (!desdeLocal.trim() || !hastaLocal.trim()) {
    return { ok: false, error: "Indica la fecha y hora de inicio y fin." };
  }

  const desde = horaLocalAIso(desdeLocal);
  const hasta = horaLocalAIso(hastaLocal);
  if (!desde || !hasta) {
    return { ok: false, error: "Usa una fecha y hora válidas." };
  }

  const inicio = Date.parse(desde);
  const fin = Date.parse(hasta);
  if (fin <= inicio) {
    return { ok: false, error: "La fecha final debe ser posterior a la inicial." };
  }
  if (fin - inicio > MAX_VENTANA_DIAS * DIA_MS) {
    return {
      ok: false,
      error: `El rango no puede superar ${MAX_VENTANA_DIAS} días.`,
    };
  }
  return { ok: true, ventana: { desde, hasta } };
}

/** Duración compacta para el resumen: `45 min`, `6 h 30 min`, `8 d 3 h`. */
export function duracionLegible(desde: string, hasta: string): string {
  const inicio = Date.parse(desde);
  const fin = Date.parse(hasta);
  if (Number.isNaN(inicio) || Number.isNaN(fin) || fin <= inicio) return "";

  const minutos = Math.round((fin - inicio) / MINUTO_MS);
  const dias = Math.floor(minutos / 1440);
  const horas = Math.floor((minutos % 1440) / 60);
  const resto = minutos % 60;

  if (dias > 0) return horas > 0 ? `${dias} d ${horas} h` : `${dias} d`;
  if (horas > 0) return resto > 0 ? `${horas} h ${resto} min` : `${horas} h`;
  return `${resto} min`;
}

interface PartesLima {
  anio: number;
  mes: number;
  dia: number;
  hora: string;
}

function partesLima(iso: string): PartesLima | null {
  const local = isoAHoraLocal(iso);
  if (!local) return null;
  const [fecha, hora] = local.split("T");
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return { anio, mes, dia, hora };
}

/** Etiqueta del rango visible, en hora de Perú: `24 nov, 08:15 → 24 nov, 11:45`. */
export function etiquetaVentana(ventana: Ventana): string {
  const inicio = partesLima(ventana.desde);
  const fin = partesLima(ventana.hasta);
  if (!inicio || !fin) return "";

  const mismoAnio = inicio.anio === fin.anio;
  const formatear = (parte: PartesLima) =>
    `${parte.dia} ${MESES[parte.mes - 1]}${
      mismoAnio ? "" : ` ${parte.anio}`
    }, ${parte.hora}`;
  return `${formatear(inicio)} → ${formatear(fin)}`;
}
