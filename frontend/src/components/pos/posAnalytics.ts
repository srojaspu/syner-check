import type {
  PosAnalysis,
  PosClientLog,
  PosEvento,
  PosNivel,
} from "../../api/types";
import {
  describePosEvent,
  extractOrderNumber,
  parsePosValueSafe,
  type PosEventDescription,
  type PosParsedValue,
} from "./posCatalog";

export type PosKpiCardId =
  | "ventas_exitosas"
  | "ventas_resueltas"
  | "ventas_fallidas"
  | "incidentes_caja"
  | "errores_instancia";

export const BALANCE_KEYS = new Set([
  "BALANCE_FETCH_FAILED",
  "BALANCE_OPEN_FAILED",
  "BALANCE_CLOSE_FAILED",
  "BALANCE_REPORT_FAILED",
]);

export interface EnrichedPosLog extends PosEvento {
  value: string | null;
  parsedValue: PosParsedValue;
  descripcion: PosEventDescription;
  orderGroupKey: string | null;
  balanceGroupKey: string | null;
  balanceGroupLabel: string | null;
  isNucError: boolean;
}

export interface KpiSubGroup {
  key: string;
  label: string;
  count: number;
}

export interface PosOperationalCards {
  ventasExitosas: {
    count: number;
    eventosCount: number;
    conTarjeta: number;
  };
  ventasResueltas: {
    count: number;
    eventosCount: number;
    advertenciasCount: number;
  };
  ventasFallidas: {
    count: number;
    eventosCount: number;
    inconclusas: number;
    cobroSinEmision: number;
    montoRiesgo: string | null;
    pedidos: KpiSubGroup[];
  };
  incidentesCaja: {
    count: number;
    bloqueantes: number;
    instanciasAfectadas: number;
    grupos: KpiSubGroup[];
  };
  erroresInstancia: {
    count: number;
    instanciasAfectadas: number;
    grupos: KpiSubGroup[];
  };
}

export interface PosAnalyticsModel {
  items: EnrichedPosLog[];
  cards: PosOperationalCards;
  cardOids: Record<PosKpiCardId, Set<string>>;
}

const BALANCE_MSG_RE = /\bbalance\s+([A-Za-z0-9_-]{1,24})\b/i;
const AMOUNT_MSG_RE = /\bOrder\s+\d{1,12},\s*([A-Z]{3})\s+(\d+(?:\.\d{1,2})?)/i;

/**
 * Extrae la lista completa de logs del periodo desde `PosAnalysis`.
 * Soporta `analysis.logs` y degrada limpiamente a `analysis.eventos.items`
 * para mantener compatibilidad con fixtures antiguos.
 */
export function extractClientLogsFromAnalysis(
  analysis: PosAnalysis | null,
): PosClientLog[] {
  if (!analysis) return [];
  if (Array.isArray(analysis.logs)) return analysis.logs;
  return analysis.eventos.items.map((item) => ({
    oid: item.oid,
    fecha: item.fecha,
    nivel: item.nivel,
    clave: item.clave,
    instancia: item.instancia,
    mensaje: item.mensaje,
    value:
      item.pedido || item.importe || item.serial || item.version
        ? JSON.stringify({
            orderNumber: item.pedido ?? undefined,
            amount: item.importe ?? undefined,
            currency: item.moneda ?? undefined,
            serial: item.serial ?? undefined,
            version: item.version ?? undefined,
          })
        : null,
  }));
}

export function isNucServerFailure(
  log: Pick<PosClientLog, "nivel" | "mensaje" | "value">,
  parsed: PosParsedValue,
): boolean {
  if (log.nivel !== "WARN" && log.nivel !== "ERROR") return false;
  const msg = log.mensaje.toLowerCase();
  if (
    msg.includes("no response before the timeout") ||
    msg.includes("connection failed mid-request") ||
    msg.includes("connection to the backend never opened") ||
    /the backend answered http\s+5\d\d/i.test(log.mensaje)
  ) {
    return true;
  }

  const rawValue = (log.value ?? "").toLowerCase();
  const exc = `${parsed.exception ?? ""} ${parsed.exceptionMessage ?? ""}`.toLowerCase();
  const haystack = `${exc} ${rawValue}`;
  return (
    haystack.includes("no response before the timeout") ||
    haystack.includes("connection failed mid-request") ||
    haystack.includes("the backend answered http 5") ||
    haystack.includes("sockettimeoutexception") ||
    haystack.includes("read timed out") ||
    haystack.includes("connectexception") ||
    haystack.includes("failed to connect") ||
    haystack.includes("connection refused") ||
    exc.trim() === "timeout" ||
    exc.endsWith(" timeout")
  );
}

function resolveAmountAndCurrency(
  mensaje: string,
  parsed: PosParsedValue,
): { importe: string | null; moneda: string | null } {
  const rawAmount =
    typeof parsed.amount === "string" && parsed.amount.trim()
      ? parsed.amount.trim()
      : null;
  const rawCurrency =
    typeof parsed.currency === "string" && parsed.currency.trim()
      ? parsed.currency.trim()
      : null;
  if (rawAmount) {
    return { importe: rawAmount, moneda: rawCurrency };
  }
  const match = AMOUNT_MSG_RE.exec(mensaje);
  if (match) {
    return { moneda: match[1], importe: match[2] };
  }
  return { importe: null, moneda: rawCurrency };
}

function resolveBalanceGroup(
  log: Pick<PosClientLog, "clave" | "mensaje">,
  parsed: PosParsedValue,
): { key: string | null; label: string | null } {
  if (!BALANCE_KEYS.has(log.clave)) return { key: null, label: null };
  const num =
    (typeof parsed.balanceNumber === "string" && parsed.balanceNumber.trim()) ||
    (typeof parsed.balanceId === "string" && parsed.balanceId.trim()) ||
    (BALANCE_MSG_RE.exec(log.mensaje)?.[1] ?? "");
  if (num) {
    return { key: num, label: `Caja ${num}` };
  }
  return { key: "__sin_caja__", label: "Sin N° de caja" };
}

/**
 * Analiza en el cliente todos los logs del periodo y construye:
 * - filas enriquecidas con traducción y datos parseados de forma segura
 * - conteos y desgloses de las 5 tarjetas KPI operativas
 * - conjuntos de `oid` por tarjeta para filtrado instantáneo (O(1))
 */
export function analyzePosLogs(rawLogs: PosClientLog[]): PosAnalyticsModel {
  const enriched: EnrichedPosLog[] = rawLogs.map((log) => {
    const parsedValue = parsePosValueSafe(log.value);
    const pedido = extractOrderNumber(log.mensaje, parsedValue);
    const { importe, moneda } = resolveAmountAndCurrency(
      log.mensaje,
      parsedValue,
    );
    const serial =
      typeof parsedValue.serial === "string" && parsedValue.serial.trim()
        ? parsedValue.serial.trim()
        : null;
    const version =
      typeof parsedValue.version === "string" && parsedValue.version.trim()
        ? parsedValue.version.trim()
        : null;
    const orderGroupKey = pedido ? `${log.instancia}::${pedido}` : null;
    const balanceGroup = resolveBalanceGroup(log, parsedValue);
    const nucError = isNucServerFailure(log, parsedValue);

    return {
      oid: log.oid,
      fecha: log.fecha,
      nivel: log.nivel,
      clave: log.clave,
      instancia: log.instancia,
      mensaje: log.mensaje,
      pedido,
      importe,
      moneda,
      serial,
      version,
      value: log.value,
      parsedValue,
      descripcion: describePosEvent(log, parsedValue),
      orderGroupKey,
      balanceGroupKey: balanceGroup.key,
      balanceGroupLabel: balanceGroup.label,
      isNucError: nucError,
    };
  });

  // 1) Agrupar pedidos por (instancia, orderNumber)
  const orders = new Map<string, EnrichedPosLog[]>();
  for (const item of enriched) {
    if (!item.orderGroupKey) continue;
    const bucket = orders.get(item.orderGroupKey);
    if (bucket) {
      bucket.push(item);
    } else {
      orders.set(item.orderGroupKey, [item]);
    }
  }

  const cardOids: Record<PosKpiCardId, Set<string>> = {
    ventas_exitosas: new Set<string>(),
    ventas_resueltas: new Set<string>(),
    ventas_fallidas: new Set<string>(),
    incidentes_caja: new Set<string>(),
    errores_instancia: new Set<string>(),
  };

  let okCount = 0;
  let okConTarjeta = 0;
  let resueltasCount = 0;
  let resueltasWarns = 0;
  let fallidasCount = 0;
  let fallidasInconclusas = 0;
  let fallidasSinEmision = 0;
  let montoRiesgoCents = 0;
  let tieneMontoRiesgo = false;
  const pedidosFallidos: KpiSubGroup[] = [];

  for (const [groupKey, groupItems] of orders.entries()) {
    let hasError = false;
    let hasWarn = false;
    let allInfo = true;
    let hasSucceeded = false;
    let hasChargeApproved = false;
    let hasInconclusive = false;
    let warnEventsInOrder = 0;

    for (const ev of groupItems) {
      if (ev.nivel === "ERROR") {
        hasError = true;
        allInfo = false;
      } else if (ev.nivel === "WARN") {
        hasWarn = true;
        allInfo = false;
        warnEventsInOrder += 1;
      } else if (ev.nivel !== "INFO") {
        allInfo = false;
      }

      if (ev.clave === "SALE_EMISSION_SUCCEEDED") hasSucceeded = true;
      if (ev.clave === "SALE_GATEWAY_CHARGE_APPROVED") hasChargeApproved = true;
      if (ev.clave === "SALE_EMISSION_INCONCLUSIVE") hasInconclusive = true;
    }

    const isChargeWithoutEmission = hasChargeApproved && !hasSucceeded;
    const isUnresolvedWarnWithoutEmission = hasWarn && !hasSucceeded;

    if (
      hasError ||
      hasInconclusive ||
      isChargeWithoutEmission ||
      isUnresolvedWarnWithoutEmission
    ) {
      fallidasCount += 1;
      if (hasInconclusive || hasError) fallidasInconclusas += 1;
      else if (isChargeWithoutEmission) fallidasSinEmision += 1;

      for (const ev of groupItems) {
        cardOids.ventas_fallidas.add(ev.oid);
      }

      const sample = groupItems[0];
      const orderNum = sample.pedido ?? groupKey;
      pedidosFallidos.push({
        key: orderNum,
        label: `Pedido ${orderNum} · ${sample.instancia}`,
        count: groupItems.length,
      });

      // Sumar monto una sola vez por pedido fallido/inconcluso
      const amountStr = groupItems.find((x) => x.importe)?.importe;
      if (amountStr) {
        const num = Number(amountStr);
        if (Number.isFinite(num) && num >= 0) {
          montoRiesgoCents += Math.round(num * 100);
          tieneMontoRiesgo = true;
        }
      }
    } else if (hasWarn && hasSucceeded) {
      resueltasCount += 1;
      resueltasWarns += warnEventsInOrder;
      for (const ev of groupItems) {
        cardOids.ventas_resueltas.add(ev.oid);
      }
    } else if (allInfo && hasSucceeded) {
      okCount += 1;
      if (hasChargeApproved) okConTarjeta += 1;
      for (const ev of groupItems) {
        cardOids.ventas_exitosas.add(ev.oid);
      }
    }
  }

  // 2) Card 4: Incidentes de Caja (BALANCE_*) agrupados por balanceNumber / balanceId
  let cajaCount = 0;
  let cajaBloqueantes = 0;
  const cajaInstances = new Set<string>();
  const cajaGroupsMap = new Map<string, { label: string; count: number }>();

  // 3) Card 5: Errores de Instancia / NUC agrupados por log.instancia
  let nucCount = 0;
  const nucGroupsMap = new Map<string, number>();

  for (const ev of enriched) {
    if (BALANCE_KEYS.has(ev.clave)) {
      cajaCount += 1;
      cardOids.incidentes_caja.add(ev.oid);
      cajaInstances.add(ev.instancia);
      if (ev.nivel === "ERROR") cajaBloqueantes += 1;

      const gKey = ev.balanceGroupKey ?? "__sin_caja__";
      const gLabel = ev.balanceGroupLabel ?? "Sin N° de caja";
      const prev = cajaGroupsMap.get(gKey);
      if (prev) {
        prev.count += 1;
      } else {
        cajaGroupsMap.set(gKey, { label: gLabel, count: 1 });
      }
    }

    if (ev.isNucError) {
      nucCount += 1;
      cardOids.errores_instancia.add(ev.oid);
      nucGroupsMap.set(ev.instancia, (nucGroupsMap.get(ev.instancia) ?? 0) + 1);
    }
  }

  const cajaGrupos: KpiSubGroup[] = Array.from(cajaGroupsMap.entries())
    .map(([key, val]) => ({ key, label: val.label, count: val.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const nucGrupos: KpiSubGroup[] = Array.from(nucGroupsMap.entries())
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    items: enriched,
    cardOids,
    cards: {
      ventasExitosas: {
        count: okCount,
        eventosCount: cardOids.ventas_exitosas.size,
        conTarjeta: okConTarjeta,
      },
      ventasResueltas: {
        count: resueltasCount,
        eventosCount: cardOids.ventas_resueltas.size,
        advertenciasCount: resueltasWarns,
      },
      ventasFallidas: {
        count: fallidasCount,
        eventosCount: cardOids.ventas_fallidas.size,
        inconclusas: fallidasInconclusas,
        cobroSinEmision: fallidasSinEmision,
        montoRiesgo:
          fallidasCount === 0
            ? "0.00"
            : tieneMontoRiesgo
              ? (montoRiesgoCents / 100).toFixed(2)
              : null,
        pedidos: pedidosFallidos,
      },
      incidentesCaja: {
        count: cajaCount,
        bloqueantes: cajaBloqueantes,
        instanciasAfectadas: cajaInstances.size,
        grupos: cajaGrupos,
      },
      erroresInstancia: {
        count: nucCount,
        instanciasAfectadas: nucGroupsMap.size,
        grupos: nucGrupos,
      },
    },
  };
}

export interface PosLogFilterCriteria {
  card?: PosKpiCardId | null;
  subGrupo?: string | null;
  instancia?: string | null;
  serial?: string | null;
  nivel?: PosNivel | string | null;
  clave?: string | null;
  q?: string | null;
}

export function filterPosLogs(
  model: PosAnalyticsModel,
  criteria: PosLogFilterCriteria,
): EnrichedPosLog[] {
  const allowedOids = criteria.card ? model.cardOids[criteria.card] : null;
  const needle = (criteria.q ?? "").trim().toLowerCase();

  return model.items.filter((item) => {
    if (allowedOids && !allowedOids.has(item.oid)) return false;

    if (criteria.subGrupo) {
      if (
        criteria.card === "incidentes_caja" &&
        item.balanceGroupKey !== criteria.subGrupo
      ) {
        return false;
      }
      if (
        criteria.card === "ventas_fallidas" &&
        item.pedido !== criteria.subGrupo
      ) {
        return false;
      }
    }

    if (criteria.instancia && item.instancia !== criteria.instancia) {
      return false;
    }
    if (criteria.serial && item.serial !== criteria.serial) {
      return false;
    }
    if (
      criteria.nivel &&
      criteria.nivel !== "__todos__" &&
      item.nivel !== criteria.nivel
    ) {
      return false;
    }
    if (
      criteria.clave &&
      criteria.clave !== "__todas__" &&
      item.clave !== criteria.clave
    ) {
      return false;
    }

    if (needle) {
      const matchText =
        item.mensaje.toLowerCase().includes(needle) ||
        item.clave.toLowerCase().includes(needle) ||
        item.descripcion.mensajeLegible.toLowerCase().includes(needle) ||
        (item.descripcion.subtexto ?? "").toLowerCase().includes(needle) ||
        (item.pedido ?? "").toLowerCase().includes(needle) ||
        (item.balanceGroupKey ?? "").toLowerCase().includes(needle) ||
        item.instancia.toLowerCase().includes(needle);
      if (!matchText) return false;
    }

    return true;
  });
}
