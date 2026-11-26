import { describe, expect, it } from "vitest";
import type { PosClientLog } from "../../api/types";
import {
  EVENT_DICTIONARY,
  describePosEvent,
  formatLimaIso,
  parsePosValueSafe,
} from "./posCatalog";
import {
  analyzePosLogs,
  filterPosLogs,
} from "./posAnalytics";

function mkLog(
  partial: Partial<PosClientLog> & { oid: string; clave: string },
): PosClientLog {
  return {
    oid: partial.oid,
    fecha: partial.fecha ?? "2026-11-26T12:00:00-05:00",
    nivel: partial.nivel ?? "INFO",
    clave: partial.clave,
    instancia: partial.instancia ?? "Tienda Jockey Plaza",
    mensaje: partial.mensaje ?? "Log message.",
    value: partial.value ?? null,
  };
}

describe("posCatalog — diccionario y parseo seguro", () => {
  it("traduce las 10 claves oficiales exactamente al español natural", () => {
    expect(Object.keys(EVENT_DICTIONARY)).toHaveLength(10);
    expect(EVENT_DICTIONARY.SALE_GATEWAY_CHARGE_APPROVED.mensaje).toBe(
      "La pasarela aprobó el cobro con tarjeta exitosamente.",
    );
    expect(EVENT_DICTIONARY.SALE_GATEWAY_REGISTER_FAILED.mensaje).toBe(
      "Cobro aprobado en tarjeta, pero falló el registro en el punto de venta. La venta continuó.",
    );
    expect(EVENT_DICTIONARY.SALE_GATEWAY_REGISTER_SKIPPED.mensaje).toBe(
      "Cobro aprobado, pero la pasarela no envió el serial del terminal. La venta continuó.",
    );
    expect(EVENT_DICTIONARY.SALE_EMISSION_SUCCEEDED.mensaje).toBe(
      "Comprobante emitido correctamente (Boleta/Factura/Ticket/Nota de Crédito).",
    );
    expect(EVENT_DICTIONARY.SALE_EMISSION_NOT_SENT.mensaje).toBe(
      "No se pudo enviar la solicitud de comprobante (sin conexión). Se puede reintentar.",
    );
    expect(EVENT_DICTIONARY.SALE_EMISSION_INCONCLUSIVE.mensaje).toBe(
      "Falló la emisión del comprobante y el estado final es incierto. Requiere verificación manual.",
    );
    expect(EVENT_DICTIONARY.BALANCE_FETCH_FAILED.mensaje).toBe(
      "Error al consultar la caja abierta. Se han bloqueado las ventas en el terminal.",
    );
    expect(EVENT_DICTIONARY.BALANCE_OPEN_FAILED.mensaje).toBe(
      "Error al abrir la caja registradora. Se han bloqueado las ventas en el terminal.",
    );
    expect(EVENT_DICTIONARY.BALANCE_CLOSE_FAILED.mensaje).toBe(
      "Error al cerrar la caja registradora. Se han bloqueado las ventas en el terminal.",
    );
    expect(EVENT_DICTIONARY.BALANCE_REPORT_FAILED.mensaje).toBe(
      "Falló la carga del reporte/resumen de caja. Las ventas continúan activas.",
    );
  });

  it("parsePosValueSafe maneja null, {}, JSON corrupto y tipos no objeto sin lanzar", () => {
    expect(parsePosValueSafe(null)).toEqual({});
    expect(parsePosValueSafe(undefined)).toEqual({});
    expect(parsePosValueSafe("")).toEqual({});
    expect(parsePosValueSafe("{}")).toEqual({});
    expect(parsePosValueSafe("{corrupto")).toEqual({});
    expect(parsePosValueSafe("[1,2,3]")).toEqual({});
    expect(
      parsePosValueSafe('{"orderNumber":"03902","elapsedMs":"15002"}'),
    ).toEqual({
      orderNumber: "03902",
      elapsedMs: "15002",
    });
  });

  it("describePosEvent extrae motivo de INCONCLUSIVE, elapsedMs y datos de caja", () => {
    const inconclusive = describePosEvent(
      mkLog({
        oid: "1",
        nivel: "ERROR",
        clave: "SALE_EMISSION_INCONCLUSIVE",
        mensaje:
          "Sale emission inconclusive (no response before the timeout); the document may or may not exist. Order 08008, PEN 340.45.",
        value: JSON.stringify({
          orderNumber: "08008",
          amount: "340.45",
          currency: "PEN",
          elapsedMs: 15004,
        }),
      }),
    );
    expect(inconclusive.mensajeLegible).toBe(
      "Falló la emisión del comprobante y el estado final es incierto. Requiere verificación manual.",
    );
    expect(inconclusive.subtexto).toContain("Sin respuesta antes del timeout");
    expect(inconclusive.subtexto).toContain("15");
    expect(inconclusive.tooltip.mensajeOriginal).toContain(
      "no response before the timeout",
    );

    const reportFailed = describePosEvent(
      mkLog({
        oid: "2",
        nivel: "WARN",
        clave: "BALANCE_REPORT_FAILED",
        mensaje:
          "Close-out report of balance 00960 failed at /api/invoices (the backend answered HTTP 500).",
        value: JSON.stringify({
          balanceNumber: "00960",
          balanceId: "b-960",
          failedEndpoint: "/api/invoices",
          elapsedMs: 310,
        }),
      }),
    );
    expect(reportFailed.subtexto).toContain("Caja 00960");
    expect(reportFailed.subtexto).toContain("Facturas");
    expect(reportFailed.subtexto).toContain("HTTP 500");
  });

  it("formatLimaIso formatea siempre en RFC 3339 con offset -05:00 de Perú", () => {
    // 2026-11-26T05:00:00Z == 2026-11-26T00:00:00-05:00
    const iso = formatLimaIso(new Date("2026-11-26T05:00:00.000Z"));
    expect(iso).toBe("2026-11-26T00:00:00-05:00");
  });
});

describe("posAnalytics — clasificación de las 5 tarjetas y filtrado interactivo", () => {
  const SAMPLE_LOGS: PosClientLog[] = [
    // Pedido 1001 (Tienda A): 100% exitoso con tarjeta (INFO + INFO)
    mkLog({
      oid: "1",
      instancia: "Tienda A",
      nivel: "INFO",
      clave: "SALE_GATEWAY_CHARGE_APPROVED",
      mensaje: "Gateway charge approved. Order 01001, PEN 100.00.",
      value: JSON.stringify({
        orderNumber: "01001",
        amount: "100.00",
        currency: "PEN",
        serial: "S1",
      }),
    }),
    mkLog({
      oid: "2",
      instancia: "Tienda A",
      nivel: "INFO",
      clave: "SALE_EMISSION_SUCCEEDED",
      mensaje: "Sale emitted as document BS01-0001. Order 01001, PEN 100.00.",
      value: JSON.stringify({
        orderNumber: "01001",
        amount: "100.00",
        currency: "PEN",
        documentNumber: "BS01-0001",
        serial: "S1",
      }),
    }),
    // Pedido 1001 en OTRA tienda (Tienda B) solo con message (sin value, ej. ventana 30d) -> 100% exitoso independiente
    mkLog({
      oid: "3",
      instancia: "Tienda B",
      nivel: "INFO",
      clave: "SALE_EMISSION_SUCCEEDED",
      mensaje: "Sale emitted as document FA01-0020. Order 01001, PEN 250.00.",
      value: null,
    }),
    // Pedido 1002 (Tienda A): incidencia resuelta (CHARGE_APPROVED + REGISTER_FAILED [WARN] + EMISSION_SUCCEEDED)
    mkLog({
      oid: "4",
      instancia: "Tienda A",
      nivel: "INFO",
      clave: "SALE_GATEWAY_CHARGE_APPROVED",
      mensaje: "Gateway charge approved. Order 01002, PEN 80.00.",
      value: JSON.stringify({ orderNumber: "01002", amount: "80.00", currency: "PEN" }),
    }),
    mkLog({
      oid: "5",
      instancia: "Tienda A",
      nivel: "WARN",
      clave: "SALE_GATEWAY_REGISTER_FAILED",
      mensaje:
        "Register of the IZIPAY charge failed; the payment goes on. Order 01002, PEN 80.00.",
      value: JSON.stringify({
        orderNumber: "01002",
        amount: "80.00",
        currency: "PEN",
        exception: "java.net.SocketTimeoutException",
        exceptionMessage: "timeout",
      }),
    }),
    mkLog({
      oid: "6",
      instancia: "Tienda A",
      nivel: "INFO",
      clave: "SALE_EMISSION_SUCCEEDED",
      mensaje: "Sale emitted as document BS01-0002. Order 01002, PEN 80.00.",
      value: JSON.stringify({ orderNumber: "01002", amount: "80.00", currency: "PEN" }),
    }),
    // Pedido 1003 (Tienda A): fallida caso 1 — SALE_EMISSION_INCONCLUSIVE (ERROR)
    mkLog({
      oid: "7",
      instancia: "Tienda A",
      nivel: "ERROR",
      clave: "SALE_EMISSION_INCONCLUSIVE",
      mensaje:
        "Sale emission inconclusive (the backend answered HTTP 500); the document may or may not exist. Order 01003, PEN 340.45.",
      value: JSON.stringify({
        orderNumber: "01003",
        amount: "340.45",
        currency: "PEN",
        elapsedMs: 420,
      }),
    }),
    // Pedido 1004 (Tienda B): fallida caso 2 — cobro aprobado en tarjeta NUNCA emitió comprobante
    mkLog({
      oid: "8",
      instancia: "Tienda B",
      nivel: "INFO",
      clave: "SALE_GATEWAY_CHARGE_APPROVED",
      mensaje: "Gateway charge approved by NIUBIZ. Order 01004, PEN 59.90.",
      value: JSON.stringify({
        orderNumber: "01004",
        amount: "59.90",
        currency: "PEN",
      }),
    }),
    // Incidentes de Caja (Card 4) + Errores NUC (Card 5)
    mkLog({
      oid: "9",
      instancia: "Tienda A",
      nivel: "ERROR",
      clave: "BALANCE_OPEN_FAILED",
      mensaje:
        "Balance open failed (no response before the timeout); new sales are blocked until it succeeds.",
      value: JSON.stringify({
        balanceNumber: "00960",
        balanceId: "bal-960",
        elapsedMs: 15001,
      }),
    }),
    mkLog({
      oid: "10",
      instancia: "Tienda C",
      nivel: "ERROR",
      clave: "BALANCE_CLOSE_FAILED",
      mensaje:
        "Balance close failed (the connection failed mid-request); new sales are blocked.",
      value: JSON.stringify({
        balanceId: "bal-777",
        elapsedMs: 4200,
      }),
    }),
  ];

  it("calcula exactamente las 5 tarjetas operativas y sus desgloses", () => {
    const model = analyzePosLogs(SAMPLE_LOGS);

    // Card 1: 01001@TiendaA y 01001@TiendaB -> 2 ventas 100% exitosas (01004 NO entra aunque sea INFO porque no emitió!)
    expect(model.cards.ventasExitosas.count).toBe(2);

    // Card 2: 01002@TiendaA -> 1 venta con incidencia resuelta
    expect(model.cards.ventasResueltas.count).toBe(1);

    // Card 3: 01003@TiendaA (inconclusa) + 01004@TiendaB (cobro sin emisión) -> 2 ventas fallidas/inconclusas
    expect(model.cards.ventasFallidas.count).toBe(2);
    expect(model.cards.ventasFallidas.montoRiesgo).toBe("400.35");

    // Card 4: oid 9 y oid 10 -> 2 incidentes de caja agrupados por balanceNumber/balanceId
    expect(model.cards.incidentesCaja.count).toBe(2);
    expect(model.cards.incidentesCaja.grupos.map((g) => g.label)).toEqual([
      "Caja 00960",
      "Caja bal-777",
    ]);

    // Card 5: oid 5 (SocketTimeoutException en value), oid 7 (HTTP 500), oid 9 (timeout), oid 10 (connection failed mid-request) -> 4 eventos
    expect(model.cards.erroresInstancia.count).toBe(4);
    expect(model.cards.erroresInstancia.grupos).toEqual([
      { key: "Tienda A", label: "Tienda A", count: 3 },
      { key: "Tienda C", label: "Tienda C", count: 1 },
    ]);
  });

  it("filtra los eventos por cada una de las 5 tarjetas y restaura al limpiar", () => {
    const model = analyzePosLogs(SAMPLE_LOGS);

    expect(filterPosLogs(model, { card: null })).toHaveLength(10);

    const c1 = filterPosLogs(model, { card: "ventas_exitosas" });
    expect(c1.map((item) => item.oid)).toEqual(["1", "2", "3"]);

    const c2 = filterPosLogs(model, { card: "ventas_resueltas" });
    expect(c2.map((item) => item.oid)).toEqual(["4", "5", "6"]);

    const c3 = filterPosLogs(model, { card: "ventas_fallidas" });
    expect(c3.map((item) => item.oid)).toEqual(["7", "8"]);

    const c4 = filterPosLogs(model, { card: "incidentes_caja" });
    expect(c4.map((item) => item.oid)).toEqual(["9", "10"]);

    const c4Sub = filterPosLogs(model, {
      card: "incidentes_caja",
      subGrupo: "00960",
    });
    expect(c4Sub.map((item) => item.oid)).toEqual(["9"]);

    const c5 = filterPosLogs(model, { card: "errores_instancia" });
    expect(c5.map((item) => item.oid)).toEqual(["5", "7", "9", "10"]);

    const c5Sub = filterPosLogs(model, {
      card: "errores_instancia",
      instancia: "Tienda C",
    });
    expect(c5Sub.map((item) => item.oid)).toEqual(["10"]);
  });
});
