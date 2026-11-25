// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../api/client";
import type {
  PosAnalysis,
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

const EVENTO: PosEvento = {
  oid: "80957.1",
  fecha: "2026-11-24T14:00:00-05:00",
  nivel: "ERROR",
  clave: "BALANCE_OPEN_FAILED",
  instancia: "La Rambla",
  mensaje: "Balance open failed; new sales are blocked until it succeeds.",
  pedido: "03902",
  importe: "53.47",
  moneda: "PEN",
  serial: "S1",
  version: "3.2.3",
};

const DETALLE: PosEventoDetalle = {
  ...EVENTO,
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
    eventos: 120,
    info: 100,
    warn: 10,
    error: 10,
    desconocidos: 0,
    terminales: 3,
    terminalesSinSerial: 0,
    instancias: 2,
    cobrosTarjeta: 40,
    emisionesOk: 60,
    emisionesInconclusas: 1,
    montoEnRiesgo: "53.47",
    cajasConFalla: 1,
    ultimoEvento: "2026-11-24T13:59:00-05:00",
  },
  series: [
    {
      bucket: "2026-11-24T13:00:00-05:00",
      info: 90,
      warn: 8,
      error: 9,
      unknown: 0,
    },
    {
      bucket: "2026-11-24T14:00:00-05:00",
      info: 10,
      warn: 2,
      error: 1,
      unknown: 0,
    },
  ],
  terminales: [
    {
      instancia: "La Rambla",
      serial: "S1",
      salud: "CRITICAL",
      eventos: 60,
      errores: 9,
      advertencias: 4,
      ultimaActividad: "2026-11-24T13:58:00-05:00",
      version: "3.2.3",
      ultimaClave: "BALANCE_OPEN_FAILED",
      ultimaFalla: "BALANCE_OPEN_FAILED",
      ultimaFallaFecha: "2026-11-24T13:58:00-05:00",
    },
    {
      instancia: "Salaverry",
      serial: null,
      salud: "OK",
      eventos: 60,
      errores: 1,
      advertencias: 6,
      ultimaActividad: "2026-11-24T13:50:00-05:00",
      version: "3.2.2",
      ultimaClave: "SALE_EMISSION_SUCCEEDED",
      ultimaFalla: null,
      ultimaFallaFecha: null,
    },
  ],
  fallas: [
    {
      clave: "BALANCE_OPEN_FAILED",
      instancia: "La Rambla",
      nivel: "ERROR",
      conteo: 9,
      primera: "2026-11-24T12:00:00-05:00",
      ultima: "2026-11-24T13:58:00-05:00",
      oidMuestra: "80957.1",
    },
  ],
  claves: [
    {
      clave: "SALE_EMISSION_SUCCEEDED",
      nivel: "INFO",
      conteo: 100,
      ultima: "2026-11-24T13:59:00-05:00",
    },
    {
      clave: "BALANCE_OPEN_FAILED",
      nivel: "ERROR",
      conteo: 9,
      ultima: "2026-11-24T13:58:00-05:00",
    },
  ],
  versiones: [
    { version: "3.2.3", conteo: 80 },
    { version: "3.2.2", conteo: 40 },
  ],
  eventos: {
    items: [EVENTO],
    total: 1,
    page: 1,
    limit: 50,
    hayMas: false,
  },
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

  it("muestra KPIs, terminales y eventos", async () => {
    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "Terminales" }),
    ).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("120")).toBeTruthy();
      expect(screen.getByText("S/ 53.47 en riesgo")).toBeTruthy();
        expect(screen.getAllByText("La Rambla").length).toBeGreaterThan(0);
      expect(
        screen.getAllByText("BALANCE_OPEN_FAILED").length,
      ).toBeGreaterThan(0);
    });
  });

  it("abre el modal de eventos y el detalle en un sheet", async () => {
    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("120")).toBeTruthy());
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
      expect(
        screen.getByRole("heading", { name: "Evento 80957.1" }),
      ).toBeTruthy();
      expect(screen.getByText("IZIPAY")).toBeTruthy();
      expect(screen.getByText("Pan enmascarado")).toBeTruthy();
      expect(screen.getByText("Fecha exacta")).toBeTruthy();
    });
  });

  it("muestra el estado vacío cuando no hay eventos", async () => {
    mockAnalysis.mockResolvedValue({
      ...ANALYSIS,
      kpis: { ...ANALYSIS.kpis, eventos: 0 },
      series: [],
      eventos: { ...ANALYSIS.eventos, items: [], total: 0 },
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
    });

    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText("Ventana larga: detalle técnico no descargado"),
      ).toBeTruthy();
      expect(screen.getByText("monto no disponible")).toBeTruthy();
    });
  });

  it("actualizar vuelve a consultar y usa caché del backend", async () => {
    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("120")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));

    await waitFor(() => expect(mockAnalysis).toHaveBeenCalledTimes(2));
  });

  it("busca un pedido y muestra sus eventos", async () => {
    render(<TerminalesPage onAuthFailure={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("120")).toBeTruthy());

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
