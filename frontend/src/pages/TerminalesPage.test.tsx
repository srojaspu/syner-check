// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../api/client";
import type {
  PosAnalysis,
  PosClientLog,
  PosEvento,
  PosEventoDetalle,
  PosPedidoResponse,
} from "../api/types";
import TerminalesPage from "./TerminalesPage";

const mockAnalysis = vi.hoisted(() => vi.fn());
const mockEvent = vi.hoisted(() => vi.fn());
const mockOrder = vi.hoisted(() => vi.fn());

vi.mock("../api/posLogs", () => ({
  getPosAnalysis: mockAnalysis,
  getPosEvent: mockEvent,
  searchPosOrder: mockOrder,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const CLIENT_LOGS: PosClientLog[] = [
  // Pedido 01001: Venta 100% exitosa
  {
    oid: "80957.10",
    fecha: "2026-11-24T13:55:00-05:00",
    nivel: "INFO",
    clave: "SALE_EMISSION_SUCCEEDED",
    instancia: "Salaverry",
    mensaje: "Sale emitted as document BS01-0001. Order 01001, PEN 120.00.",
    value: JSON.stringify({
      orderNumber: "01001",
      amount: "120.00",
      currency: "PEN",
      documentNumber: "BS01-0001",
      serial: "S2",
    }),
  },
  // Pedido 02002: Venta con incidencia resuelta (WARN + SUCCEEDED)
  {
    oid: "80957.20",
    fecha: "2026-11-24T13:56:00-05:00",
    nivel: "WARN",
    clave: "SALE_GATEWAY_REGISTER_FAILED",
    instancia: "Salaverry",
    mensaje:
      "Register of the IZIPAY charge failed; the payment goes on. Order 02002, PEN 80.00.",
    value: JSON.stringify({
      orderNumber: "02002",
      amount: "80.00",
      currency: "PEN",
      gateway: "IZIPAY",
      serial: "S2",
    }),
  },
  {
    oid: "80957.21",
    fecha: "2026-11-24T13:57:00-05:00",
    nivel: "INFO",
    clave: "SALE_EMISSION_SUCCEEDED",
    instancia: "Salaverry",
    mensaje: "Sale emitted as document BS01-0002. Order 02002, PEN 80.00.",
    value: JSON.stringify({
      orderNumber: "02002",
      amount: "80.00",
      currency: "PEN",
      documentNumber: "BS01-0002",
      serial: "S2",
    }),
  },
  // Pedido 03902: Venta fallida / inconclusa (S/ 53.47 en riesgo) + error NUC timeout
  {
    oid: "80957.30",
    fecha: "2026-11-24T13:59:00-05:00",
    nivel: "ERROR",
    clave: "SALE_EMISSION_INCONCLUSIVE",
    instancia: "La Rambla",
    mensaje:
      "Sale emission inconclusive (no response before the timeout); the document may or may not exist. Order 03902, PEN 53.47.",
    value: JSON.stringify({
      orderNumber: "03902",
      amount: "53.47",
      currency: "PEN",
      elapsedMs: 15002,
      serial: "S1",
    }),
  },
  // Incidente de caja + error NUC timeout
  {
    oid: "80957.1",
    fecha: "2026-11-24T14:00:00-05:00",
    nivel: "ERROR",
    clave: "BALANCE_OPEN_FAILED",
    instancia: "La Rambla",
    mensaje:
      "Balance open failed (no response before the timeout); new sales are blocked until it succeeds.",
    value: JSON.stringify({
      balanceNumber: "00960",
      balanceId: "bal-960",
      elapsedMs: 15001,
      serial: "S1",
      version: "3.2.3",
    }),
  },
];

const EVENTO: PosEvento = {
  oid: "80957.1",
  fecha: "2026-11-24T14:00:00-05:00",
  nivel: "ERROR",
  clave: "BALANCE_OPEN_FAILED",
  instancia: "La Rambla",
  mensaje:
    "Balance open failed (no response before the timeout); new sales are blocked until it succeeds.",
  pedido: null,
  importe: null,
  moneda: null,
  serial: "S1",
  version: "3.2.3",
};

const DETALLE: PosEventoDetalle = {
  ...EVENTO,
  pedido: "03902",
  importe: "53.47",
  moneda: "PEN",
  valor: {
    version: "3.2.3",
    serial: "S1",
    pedido: "03902",
    importe: "53.47",
    moneda: "PEN",
    elapsedMs: 1200,
    tipoDocumento: "Boleta",
    documento: "BS02-00003270",
    pasarela: "IZIPAY",
    panEnmascarado: "491257**6574",
    balanceNumber: "00960",
  },
};

const ANALYSIS: PosAnalysis = {
  ventana: {
    desde: "2026-11-23T14:00:00-05:00",
    hasta: "2026-11-24T14:00:00-05:00",
    tz: "America/Lima",
    dias: 1,
  },
  generadoEn: "2026-11-24T14:00:00-05:00",
  fuente: {
    cache: "miss",
    latenciaMs: 1200,
    upstreamMs: 1180,
    parcial: false,
  },
  kpis: {
    eventos: 5,
    info: 2,
    warn: 1,
    error: 2,
    desconocidos: 0,
    terminales: 2,
    terminalesSinSerial: 0,
    instancias: 2,
    cobrosTarjeta: 1,
    emisionesOk: 2,
    emisionesInconclusas: 1,
    montoEnRiesgo: "53.47",
    cajasConFalla: 1,
    ultimoEvento: "2026-11-24T14:00:00-05:00",
  },
  series: [
    {
      bucket: "2026-11-24T13:00:00-05:00",
      info: 2,
      warn: 1,
      error: 2,
      unknown: 0,
    },
  ],
  terminales: [
    {
      instancia: "La Rambla",
      serial: "S1",
      salud: "CRITICAL",
      eventos: 2,
      errores: 2,
      advertencias: 0,
      ultimaActividad: "2026-11-24T14:00:00-05:00",
      version: "3.2.3",
      ultimaClave: "BALANCE_OPEN_FAILED",
      ultimaFalla: "BALANCE_OPEN_FAILED",
      ultimaFallaFecha: "2026-11-24T14:00:00-05:00",
    },
    {
      instancia: "Salaverry",
      serial: "S2",
      salud: "DEGRADED",
      eventos: 3,
      errores: 0,
      advertencias: 1,
      ultimaActividad: "2026-11-24T13:57:00-05:00",
      version: "3.2.2",
      ultimaClave: "SALE_EMISSION_SUCCEEDED",
      ultimaFalla: "SALE_GATEWAY_REGISTER_FAILED",
      ultimaFallaFecha: "2026-11-24T13:56:00-05:00",
    },
  ],
  fallas: [
    {
      clave: "BALANCE_OPEN_FAILED",
      instancia: "La Rambla",
      nivel: "ERROR",
      conteo: 1,
      primera: "2026-11-24T14:00:00-05:00",
      ultima: "2026-11-24T14:00:00-05:00",
      oidMuestra: "80957.1",
    },
  ],
  claves: [
    {
      clave: "SALE_EMISSION_SUCCEEDED",
      nivel: "INFO",
      conteo: 2,
      ultima: "2026-11-24T13:57:00-05:00",
    },
    {
      clave: "BALANCE_OPEN_FAILED",
      nivel: "ERROR",
      conteo: 1,
      ultima: "2026-11-24T14:00:00-05:00",
    },
  ],
  versiones: [{ version: "3.2.3", conteo: 2 }],
  eventos: {
    items: [EVENTO],
    total: 5,
    page: 1,
    limit: 50,
    hayMas: false,
  },
  logs: CLIENT_LOGS,
  aviso: "La ausencia de un evento no prueba que la operación no ocurrió.",
};

const PEDIDO: PosPedidoResponse = {
  numero: "03902",
  ventana: {
    desde: "2026-11-17T14:00:00-05:00",
    hasta: "2026-11-24T14:00:00-05:00",
    tz: "America/Lima",
    dias: 7,
  },
  eventos: [EVENTO],
  total: 1,
  fuente: { cache: "miss", latenciaMs: 600, upstreamMs: 590, parcial: false },
  aviso: "aviso",
};

describe("TerminalesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalysis.mockResolvedValue(ANALYSIS);
    mockEvent.mockResolvedValue({
      evento: DETALLE,
      fuente: { cache: "miss", latenciaMs: 300, parcial: false },
    });
    mockOrder.mockResolvedValue(PEDIDO);
  });

  afterEach(cleanup);

  it("muestra las 5 tarjetas KPI operativas, traducciones y consulta con offset -05:00", async () => {
    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "Terminales" }),
    ).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Ventas 100% Exitosas")).toBeTruthy();
      expect(screen.getByText("Ventas con Incidencias Resueltas")).toBeTruthy();
      expect(screen.getByText("Ventas Fallidas o Inconclusas")).toBeTruthy();
      expect(screen.getByText("Incidentes de Caja")).toBeTruthy();
      expect(screen.getByText("Errores de Instancia / NUC")).toBeTruthy();
      expect(screen.getByText(/S\/ 53\.47 en riesgo/)).toBeTruthy();
      expect(
        screen.getAllByText(
          "Error al abrir la caja registradora. Se han bloqueado las ventas en el terminal.",
        ).length,
      ).toBeGreaterThan(0);
    });

    const firstCallArgs = mockAnalysis.mock.calls[0][0];
    expect(firstCallArgs.desde).toMatch(/-05:00$/);
    expect(firstCallArgs.hasta).toMatch(/-05:00$/);
  });

  it("filtra la tabla interactivamente al hacer clic en una tarjeta y restaura al segundo clic o Limpiar filtro", async () => {
    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("5 de 5 eventos · página 1 de 1")).toBeTruthy(),
    );

    // Clic en Card 1: Ventas 100% Exitosas -> solo pedido 01001 (1 evento)
    const cardExitosas = screen
      .getByText("Ventas 100% Exitosas")
      .closest("button") as HTMLElement;
    fireEvent.click(cardExitosas);

    await waitFor(() => {
      expect(screen.getByText("1 de 5 eventos · página 1 de 1")).toBeTruthy();
      expect(screen.getByText("01001")).toBeTruthy();
      expect(screen.queryByText("03902")).toBeNull();
    });

    // Clic en Card 3: Ventas Fallidas o Inconclusas -> solo pedido 03902 (1 evento)
    const cardFallidas = screen
      .getByText("Ventas Fallidas o Inconclusas")
      .closest("button") as HTMLElement;
    fireEvent.click(cardFallidas);

    await waitFor(() => {
      expect(screen.getByText("1 de 5 eventos · página 1 de 1")).toBeTruthy();
      expect(screen.getByText("03902")).toBeTruthy();
      expect(screen.queryByText("01001")).toBeNull();
    });

    // Clic en Card 4: Incidentes de Caja -> muestra BALANCE_OPEN_FAILED y agrupación Caja 00960
    const cardCaja = screen
      .getByText("Incidentes de Caja")
      .closest("button") as HTMLElement;
    fireEvent.click(cardCaja);

    await waitFor(() => {
      expect(screen.getByText("1 de 5 eventos · página 1 de 1")).toBeTruthy();
      expect(screen.getAllByText(/Caja 00960/).length).toBeGreaterThan(0);
    });

    // Segundo clic en la tarjeta activa restaura todos los registros
    fireEvent.click(cardCaja);
    await waitFor(() => {
      expect(screen.getByText("5 de 5 eventos · página 1 de 1")).toBeTruthy();
    });
  });

  it("abre el modal de eventos sincronizado y el detalle en un sheet", async () => {
    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("5 de 5 eventos · página 1 de 1")).toBeTruthy(),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Ver eventos" })[0]);

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Eventos" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("combobox", {
        name: "Filtrar eventos por instancia",
      }),
    ).toBeTruthy();

    const row = within(dialog)
      .getByText("BALANCE_OPEN_FAILED")
      .closest("tr");
    expect(row).toBeTruthy();
    fireEvent.click(row as HTMLElement);

    await waitFor(() => {
      const sheet = screen.getByLabelText("Detalle del evento");
      expect(
        within(sheet).getByRole("heading", { name: "Evento 80957.1" }),
      ).toBeTruthy();
      expect(within(sheet).getByText("IZIPAY")).toBeTruthy();
      expect(within(sheet).getByText("Pan enmascarado")).toBeTruthy();
      expect(within(sheet).getByText("Fecha exacta")).toBeTruthy();
      expect(within(sheet).getByText("00960")).toBeTruthy();
    });
  });

  it("muestra el estado vacío cuando no hay eventos", async () => {
    mockAnalysis.mockResolvedValue({
      ...ANALYSIS,
      kpis: { ...ANALYSIS.kpis, eventos: 0 },
      series: [],
      eventos: { ...ANALYSIS.eventos, items: [], total: 0 },
      logs: [],
    });

    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByText("Sin eventos").length).toBeGreaterThan(0);
    });
  });

  it("muestra el error y permite reintentar", async () => {
    mockAnalysis.mockRejectedValueOnce(new Error("fallo de red"));

    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText("No se pudo cargar el monitoreo"),
      ).toBeTruthy();
      expect(screen.getByText("fallo de red")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(mockAnalysis).toHaveBeenCalledTimes(2));
  });

  it("avisa cuando la ventana es larga y oculta montos", async () => {
    mockAnalysis.mockResolvedValue({
      ...ANALYSIS,
      fuente: { ...ANALYSIS.fuente, parcial: true },
      kpis: {
        ...ANALYSIS.kpis,
        montoEnRiesgo: null,
        terminalesSinSerial: null,
      },
      logs: CLIENT_LOGS.map((item) => ({ ...item, value: null })),
    });

    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText("Ventana larga: detalle técnico no descargado"),
      ).toBeTruthy();
      expect(screen.getByText(/monto no disponible/)).toBeTruthy();
    });
  });

  it("actualizar vuelve a consultar el backend", async () => {
    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText("5 de 5 eventos · página 1 de 1")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));

    await waitFor(() => expect(mockAnalysis).toHaveBeenCalledTimes(2));
  });

  it("busca un pedido y muestra sus eventos traducidos", async () => {
    render(<TerminalesPage onAuthFailure={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText("5 de 5 eventos · página 1 de 1")).toBeTruthy(),
    );

    fireEvent.change(screen.getByLabelText("Número de pedido"), {
      target: { value: "03902" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

    await waitFor(() => {
      expect(mockOrder).toHaveBeenCalledWith("03902", expect.any(Object));
      expect(screen.getByRole("heading", { name: "Pedido 03902" })).toBeTruthy();
    });
  });

  it("notifica a la app cuando la sesión expira", async () => {
    const onAuthFailure = vi.fn();
    mockAnalysis.mockRejectedValue(new AuthError());

    render(<TerminalesPage onAuthFailure={onAuthFailure} />);

    await waitFor(() => expect(onAuthFailure).toHaveBeenCalled());
  });
});
