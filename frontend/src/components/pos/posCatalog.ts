import type { PosClientLog } from "../../api/types";
import { numeroFmt } from "./format";

export interface EventCatalogEntry {
  clave: string;
  corto: string;
  mensaje: string;
}

/**
 * Diccionario oficial de eventos POS (SynerCOM – Perfumerías Unidas).
 * Traduce cada `key` técnica a lenguaje natural claro para operación.
 */
export const EVENT_DICTIONARY: Record<string, EventCatalogEntry> = {
  SALE_GATEWAY_CHARGE_APPROVED: {
    clave: "SALE_GATEWAY_CHARGE_APPROVED",
    corto: "Cobro con tarjeta aprobado",
    mensaje: "La pasarela aprobó el cobro con tarjeta exitosamente.",
  },
  SALE_GATEWAY_REGISTER_FAILED: {
    clave: "SALE_GATEWAY_REGISTER_FAILED",
    corto: "Cobro no registrado en POS",
    mensaje:
      "Cobro aprobado en tarjeta, pero falló el registro en el punto de venta. La venta continuó.",
  },
  SALE_GATEWAY_REGISTER_SKIPPED: {
    clave: "SALE_GATEWAY_REGISTER_SKIPPED",
    corto: "Pasarela sin serial de terminal",
    mensaje:
      "Cobro aprobado, pero la pasarela no envió el serial del terminal. La venta continuó.",
  },
  SALE_EMISSION_SUCCEEDED: {
    clave: "SALE_EMISSION_SUCCEEDED",
    corto: "Comprobante emitido",
    mensaje:
      "Comprobante emitido correctamente (Boleta/Factura/Ticket/Nota de Crédito).",
  },
  SALE_EMISSION_NOT_SENT: {
    clave: "SALE_EMISSION_NOT_SENT",
    corto: "Emisión no enviada (sin conexión)",
    mensaje:
      "No se pudo enviar la solicitud de comprobante (sin conexión). Se puede reintentar.",
  },
  SALE_EMISSION_INCONCLUSIVE: {
    clave: "SALE_EMISSION_INCONCLUSIVE",
    corto: "Emisión inconclusa (verificar)",
    mensaje:
      "Falló la emisión del comprobante y el estado final es incierto. Requiere verificación manual.",
  },
  BALANCE_FETCH_FAILED: {
    clave: "BALANCE_FETCH_FAILED",
    corto: "Error al consultar caja (bloqueado)",
    mensaje:
      "Error al consultar la caja abierta. Se han bloqueado las ventas en el terminal.",
  },
  BALANCE_OPEN_FAILED: {
    clave: "BALANCE_OPEN_FAILED",
    corto: "Error al abrir caja (bloqueado)",
    mensaje:
      "Error al abrir la caja registradora. Se han bloqueado las ventas en el terminal.",
  },
  BALANCE_CLOSE_FAILED: {
    clave: "BALANCE_CLOSE_FAILED",
    corto: "Error al cerrar caja (bloqueado)",
    mensaje:
      "Error al cerrar la caja registradora. Se han bloqueado las ventas en el terminal.",
  },
  BALANCE_REPORT_FAILED: {
    clave: "BALANCE_REPORT_FAILED",
    corto: "Fallo en reporte de caja",
    mensaje:
      "Falló la carga del reporte/resumen de caja. Las ventas continúan activas.",
  },
};

export interface PosParsedValue {
  version?: string;
  serial?: string;
  orderId?: string;
  orderNumber?: string;
  amount?: string;
  chargedAmount?: string;
  currency?: string;
  elapsedMs?: number | string;
  docType?: string;
  documentNumber?: string;
  documentId?: string;
  gateway?: string;
  brand?: string;
  maskedPan?: string;
  balanceId?: string;
  balanceNumber?: string;
  balanceOid?: string;
  balanceStartAt?: string;
  previousState?: string;
  failedEndpoint?: string;
  exception?: string;
  exceptionMessage?: string;
}

/**
 * Parseo defensivo de `log.value` (cadena JSON serializada, puede ser null o "{}").
 * Nunca lanza excepciones.
 */
export function parsePosValueSafe(
  raw: string | null | undefined,
): PosParsedValue {
  if (!raw) return {};
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "{}") return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as PosParsedValue;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Formatea un `Date` en RFC 3339 con el huso horario fijo de Perú (-05:00, sin DST).
 * Ejemplo: `"2026-11-26T00:00:00-05:00"`.
 */
export function formatLimaIso(date: Date): string {
  const limaMillis = date.getTime() - 5 * 3_600_000;
  const lima = new Date(limaMillis);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${lima.getUTCFullYear()}-${pad(lima.getUTCMonth() + 1)}-${pad(lima.getUTCDate())}` +
    `T${pad(lima.getUTCHours())}:${pad(lima.getUTCMinutes())}:${pad(lima.getUTCSeconds())}-05:00`
  );
}

const DOC_LABELS: Record<string, string> = {
  RECEIPT: "Boleta",
  INVOICE: "Factura",
  TICKET: "Ticket",
  CREDITNOTE: "Nota de crédito",
  BS: "Boleta",
  FA: "Factura",
  NC: "Nota de crédito",
  TK: "Ticket",
};

const ENDPOINT_LABELS: Record<string, string> = {
  "/api/receipts": "Boletas",
  "/api/invoices": "Facturas",
  "/api/tickets": "Tickets",
  "/api/creditnotes": "Notas de crédito",
};

const ORDER_MSG_RE = /\bOrder\s+(\d{1,12})\b/i;
const BALANCE_MSG_RE = /\bbalance\s+([A-Za-z0-9_-]{1,24})\b/i;
const DOC_MSG_RE = /\bdocument\s+([A-Z]{2}\d{2}-\d+)\b/i;

export function extractOrderNumber(
  mensaje: string,
  parsed: PosParsedValue,
): string | null {
  const fromValue =
    typeof parsed.orderNumber === "string" ? parsed.orderNumber.trim() : "";
  if (/^\d{1,12}$/.test(fromValue)) return fromValue;
  const match = ORDER_MSG_RE.exec(mensaje);
  return match ? match[1] : null;
}

export function extractElapsedMs(parsed: PosParsedValue): number | null {
  if (parsed.elapsedMs === undefined || parsed.elapsedMs === null) return null;
  const num = Number(parsed.elapsedMs);
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : null;
}

export function translateFailureMotive(
  mensaje: string,
  parsed: PosParsedValue,
): { motivoLegible: string | null; motivoTecnico: string | null } {
  const lower = mensaje.toLowerCase();
  if (lower.includes("no response before the timeout")) {
    return {
      motivoLegible: "Sin respuesta antes del timeout",
      motivoTecnico: "no response before the timeout",
    };
  }
  if (lower.includes("connection failed mid-request")) {
    return {
      motivoLegible: "Conexión interrumpida a mitad de petición",
      motivoTecnico: "the connection failed mid-request",
    };
  }
  if (lower.includes("connection to the backend never opened")) {
    return {
      motivoLegible: "No se pudo abrir conexión con SynerPOS",
      motivoTecnico: "the connection to the backend never opened",
    };
  }
  const httpMatch = /the backend answered http\s+(\d{3})/i.exec(mensaje);
  if (httpMatch) {
    return {
      motivoLegible: `Servidor local respondió HTTP ${httpMatch[1]}`,
      motivoTecnico: `the backend answered HTTP ${httpMatch[1]}`,
    };
  }
  if (lower.includes("unexpected client-side error")) {
    return {
      motivoLegible: "Error inesperado en el terminal",
      motivoTecnico: "an unexpected client-side error",
    };
  }

  const exc = `${parsed.exception ?? ""} ${parsed.exceptionMessage ?? ""}`.trim();
  const excLower = exc.toLowerCase();
  if (
    excLower.includes("sockettimeoutexception") ||
    excLower.includes("timed out") ||
    excLower === "timeout" ||
    excLower.endsWith(" timeout")
  ) {
    return {
      motivoLegible: "Tiempo de espera agotado hacia SynerPOS",
      motivoTecnico: exc || "timeout",
    };
  }
  if (
    excLower.includes("connectexception") ||
    excLower.includes("failed to connect") ||
    excLower.includes("connection refused")
  ) {
    return {
      motivoLegible: "Fallo de conexión hacia SynerPOS local",
      motivoTecnico: exc,
    };
  }

  return { motivoLegible: null, motivoTecnico: exc || null };
}

function translateEndpoint(endpoint: string | undefined): string | null {
  if (!endpoint) return null;
  if (ENDPOINT_LABELS[endpoint]) {
    return `${ENDPOINT_LABELS[endpoint]} (${endpoint})`;
  }
  if (endpoint.includes("/summary")) {
    return `Resumen de caja (${endpoint})`;
  }
  return endpoint;
}

export interface PosEventDescription {
  mensajeLegible: string;
  subtexto: string | null;
  tooltip: {
    mensajeOriginal: string;
    motivo: string | null;
    elapsedMs: string | null;
    caja: string | null;
    endpoint: string | null;
    excepcion: string | null;
  };
}

/**
 * Construye la descripción traducida + subtexto operativo + datos de tooltip
 * para cualquier fila de log o sheet de detalle.
 */
export function describePosEvent(
  log: Pick<PosClientLog, "clave" | "mensaje"> & { value?: string | null },
  preParsed?: PosParsedValue,
): PosEventDescription {
  const parsed = preParsed ?? parsePosValueSafe(log.value);
  const entry = EVENT_DICTIONARY[log.clave];
  const mensajeLegible = entry ? entry.mensaje : log.mensaje;

  const { motivoLegible, motivoTecnico } = translateFailureMotive(
    log.mensaje,
    parsed,
  );
  const elapsed = extractElapsedMs(parsed);
  const elapsedLabel =
    elapsed !== null ? `${numeroFmt.format(elapsed)} ms` : null;

  const docNum =
    parsed.documentNumber ||
    (DOC_MSG_RE.exec(log.mensaje)?.[1] ?? undefined);
  const docTypeLabel = parsed.docType
    ? DOC_LABELS[parsed.docType.toUpperCase()] ?? parsed.docType
    : docNum
      ? DOC_LABELS[docNum.slice(0, 2).toUpperCase()] ?? null
      : null;
  const comprobante = docNum
    ? `${docTypeLabel ? `${docTypeLabel} ` : ""}${docNum}`
    : docTypeLabel;

  const pasarelaParts = [
    parsed.gateway,
    parsed.brand,
    parsed.maskedPan,
  ].filter(Boolean);
  const pasarela = pasarelaParts.length > 0 ? pasarelaParts.join(" · ") : null;

  const balanceNum =
    parsed.balanceNumber ||
    parsed.balanceId ||
    (BALANCE_MSG_RE.exec(log.mensaje)?.[1] ?? undefined);
  const caja = balanceNum ? `Caja ${balanceNum}` : null;
  const endpoint = translateEndpoint(parsed.failedEndpoint);

  const subParts: string[] = [];
  if (caja) subParts.push(caja);
  if (endpoint) subParts.push(endpoint);
  if (comprobante) subParts.push(comprobante);
  if (pasarela && log.clave.startsWith("SALE_GATEWAY_")) subParts.push(pasarela);
  if (motivoLegible) subParts.push(motivoLegible);
  if (elapsedLabel) subParts.push(elapsedLabel);

  const excepcion =
    parsed.exception || parsed.exceptionMessage
      ? [parsed.exception, parsed.exceptionMessage].filter(Boolean).join(": ")
      : motivoTecnico;

  return {
    mensajeLegible,
    subtexto: subParts.length > 0 ? subParts.join(" · ") : null,
    tooltip: {
      mensajeOriginal: log.mensaje,
      motivo: motivoLegible,
      elapsedMs: elapsedLabel,
      caja,
      endpoint,
      excepcion: excepcion ?? null,
    },
  };
}

export function shortEventLabel(clave: string): string {
  return EVENT_DICTIONARY[clave]?.corto ?? clave;
}
