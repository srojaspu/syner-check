// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../api/client";
import type {
  PosAnalysis,
  PosClientLog,
  PosEvento,
  PosEventoDetalle,
} from "../api/types";
import TerminalesPage from "./TerminalesPage";

const mockAnalysis = vi.hoisted(() => vi.fn());
const mockEvent = vi.hoisted(() => vi.fn());

vi.mock("../api/posLogs", () => ({
  getPosAnalysis: mockAnalysis,
  getPosEvent: mockEvent,
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

function primerDiaDelCalendario(): HTMLElement {
  const botones = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[data-slot="popover-content"] button[data-day]',
    ),
  );
  const boton = botones.find(
    (item) =>
      item.textContent?.trim() === "1" &&
      !item.closest("td")?.className.includes("outside"),
  );
  if (!boton) throw new Error("No se encontró el día 1 en el calendario.");
  return boton;
}

async function elegirHora(
  user: ReturnType<typeof userEvent.setup>,
  parte: "inicio" | "fin",
  hora: string,
  minuto: string,
) {
  await user.click(
    screen.getByRole("button", { name: `Editar hora de ${parte}` }),
  );
  const horas = screen.getByRole("listbox", { name: `Hora de ${parte}` });
  await user.click(within(horas).getByRole("option", { name: hora }));

  const minutos = screen.getByRole("listbox", {
    name: `Minutos de ${parte}`,
  });
  await user.click(within(minutos).getByRole("option", { name: minuto }));
}

describe("TerminalesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalysis.mockResolvedValue(ANALYSIS);
    mockEvent.mockResolvedValue({
      evento: DETALLE,
      fuente: { cache: "miss", latenciaMs: 300, parcial: false },
    });
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
      expect(
        screen.getAllByText(/S\/ 53\.47 en riesgo/).length,
      ).toBeGreaterThan(0);
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

  it("permite autocompletar y seleccionar una instancia", async () => {
    const user = userEvent.setup();
    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/Mostrando 1–5 de 5/)).toBeTruthy(),
    );

    const combo = screen.getByRole("combobox", {
      name: "Filtrar eventos por instancia",
    });
    await user.click(
      screen.getByRole("button", {
        name: "Abrir Filtrar eventos por instancia",
      }),
    );
    expect(await screen.findByRole("listbox")).toBeTruthy();

    await user.type(combo, "Sala");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Salaverry" })).toBeTruthy();
      expect(screen.queryByRole("option", { name: "La Rambla" })).toBeNull();
    });

    await user.click(screen.getByRole("option", { name: "Salaverry" }));
    await waitFor(() =>
      expect(screen.getByText(/Mostrando 1–3 de 3/)).toBeTruthy(),
    );
  });

  it("filtra la tabla interactivamente al hacer clic en una tarjeta y restaura al segundo clic o Limpiar filtro", async () => {
    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/Mostrando 1–5 de 5/)).toBeTruthy(),
    );

    // Clic en Card 1: Ventas 100% Exitosas -> solo pedido 01001 (1 evento)
    const cardExitosas = screen
      .getByText("Ventas 100% Exitosas")
      .closest("button") as HTMLElement;
    fireEvent.click(cardExitosas);

    await waitFor(() => {
      expect(screen.getByText(/Mostrando 1–1 de 1/)).toBeTruthy();
      expect(screen.getByText("01001")).toBeTruthy();
      expect(screen.queryByText("03902")).toBeNull();
    });

    // Clic en Card 3: Ventas Fallidas o Inconclusas -> solo pedido 03902 (1 evento)
    const cardFallidas = screen
      .getByText("Ventas Fallidas o Inconclusas")
      .closest("button") as HTMLElement;
    fireEvent.click(cardFallidas);

    await waitFor(() => {
      expect(screen.getByText(/Mostrando 1–1 de 1/)).toBeTruthy();
      expect(screen.getByText("03902")).toBeTruthy();
      expect(screen.queryByText("01001")).toBeNull();
    });

    // Clic en Card 4: Incidentes de Caja -> muestra BALANCE_OPEN_FAILED y agrupación Caja 00960
    const cardCaja = screen
      .getByText("Incidentes de Caja")
      .closest("button") as HTMLElement;
    fireEvent.click(cardCaja);

    await waitFor(() => {
      expect(screen.getByText(/Mostrando 1–1 de 1/)).toBeTruthy();
      expect(screen.getAllByText(/Caja 00960/).length).toBeGreaterThan(0);
    });

    // Segundo clic en la tarjeta activa restaura todos los registros
    fireEvent.click(cardCaja);
    await waitFor(() => {
      expect(screen.getByText(/Mostrando 1–5 de 5/)).toBeTruthy();
    });
  });

  it("abre el detalle del evento en un sheet desde la tabla inline", async () => {
    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByText(/Mostrando 1–5 de 5/)).toBeTruthy(),
    );

    expect(
      screen.getByRole("combobox", {
        name: "Filtrar eventos por instancia",
      }),
    ).toBeTruthy();

    const table = screen.getByRole("table", { name: "Eventos" });
    expect(within(table).getByText("24/11, 14:00:00")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Ordenar por Fecha" }),
    ).toBeTruthy();

    // Orden ascendente por Fecha: el primer registro pasa a ser el más antiguo.
    fireEvent.click(screen.getByRole("button", { name: "Ordenar por Fecha" }));
    await waitFor(() => {
      const rows = within(table).getAllByRole("row").slice(1);
      expect(within(rows[0]).getByText("24/11, 13:55:00")).toBeTruthy();
    });

    const row = within(table).getByText("BALANCE_OPEN_FAILED").closest("tr");
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
      expect(screen.getByText(/Mostrando 1–5 de 5/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));

    await waitFor(() => expect(mockAnalysis).toHaveBeenCalledTimes(2));
  });

  it("aplica un rango personalizado y lo conserva al actualizar", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    await waitFor(() => expect(mockAnalysis).toHaveBeenCalledTimes(1));

    const inicial = mockAnalysis.mock.calls[0][0] as {
      desde: string;
      hasta: string;
    };
    const prefijoMes = inicial.desde.slice(0, 7);

    await user.click(
      screen.getByRole("button", { name: "Personalizado" }),
    );
    expect(
      document.querySelector('[data-slot="popover-content"] [role="grid"]'),
    ).toBeTruthy();

    // Limpiar + un clic deja inicio y fin en el mismo día.
    await user.click(screen.getByRole("button", { name: "Limpiar" }));
    fireEvent.click(primerDiaDelCalendario());
    await elegirHora(user, "inicio", "08", "15");
    await elegirHora(user, "fin", "11", "45");

    // Editar el borrador no debe consultar: solo se aplica al enviar.
    expect(mockAnalysis).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    await waitFor(() => expect(mockAnalysis).toHaveBeenCalledTimes(2));
    expect(mockAnalysis.mock.calls[1][0]).toMatchObject({
      desde: `${prefijoMes}-01T08:15:00-05:00`,
      hasta: `${prefijoMes}-01T11:45:00-05:00`,
    });
    expect(screen.getByText(/08:15 → .*11:45/)).toBeTruthy();

    const actualizar = screen.getByRole("button", { name: "Actualizar" });
    await waitFor(() => expect(actualizar.hasAttribute("disabled")).toBe(false));
    await user.click(actualizar);

    await waitFor(() => expect(mockAnalysis).toHaveBeenCalledTimes(3));
    expect(mockAnalysis.mock.calls[2][0]).toMatchObject({
      desde: `${prefijoMes}-01T08:15:00-05:00`,
      hasta: `${prefijoMes}-01T11:45:00-05:00`,
    });
  }, 20_000);

  it("no consulta si el rango personalizado es inválido", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    await waitFor(() => expect(mockAnalysis).toHaveBeenCalledTimes(1));

    await user.click(
      screen.getByRole("button", { name: "Personalizado" }),
    );
    await user.click(screen.getByRole("button", { name: "Limpiar" }));
    fireEvent.click(primerDiaDelCalendario());
    await elegirHora(user, "inicio", "12", "00");
    await elegirHora(user, "fin", "10", "00");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    expect(screen.getByRole("alert").textContent).toContain(
      "La fecha final debe ser posterior a la inicial.",
    );
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeTruthy();
    expect(mockAnalysis).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("vuelve al preset y recalcula la ventana", async () => {
    const user = userEvent.setup({ delay: null });
    render(<TerminalesPage onAuthFailure={vi.fn()} />);

    await waitFor(() => expect(mockAnalysis).toHaveBeenCalledTimes(1));

    await user.click(
      screen.getByRole("button", { name: "Personalizado" }),
    );
    fireEvent.click(primerDiaDelCalendario());
    await user.click(screen.getByRole("button", { name: "Aplicar" }));
    await waitFor(() => expect(mockAnalysis).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole("button", { name: "7 días" }));

    await waitFor(() => expect(mockAnalysis).toHaveBeenCalledTimes(3));
    expect(
      screen.getByRole("button", { name: "7 días" }).getAttribute("aria-pressed"),
    ).toBe("true");
    const presetArgs = mockAnalysis.mock.calls[2][0];
    expect(Date.parse(presetArgs.hasta) - Date.parse(presetArgs.desde)).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
  }, 15_000);

  it("notifica a la app cuando la sesión expira", async () => {
    const onAuthFailure = vi.fn();
    mockAnalysis.mockRejectedValue(new AuthError());

    render(<TerminalesPage onAuthFailure={onAuthFailure} />);

    await waitFor(() => expect(onAuthFailure).toHaveBeenCalled());
  });
});
