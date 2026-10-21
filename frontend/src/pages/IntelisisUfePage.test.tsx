// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntelisisUfeRow } from "../api/types";

const mocks = vi.hoisted(() => ({
  ufe: {
    rows: [] as IntelisisUfeRow[],
    kpis: null as unknown,
    loading: false,
    error: null as string | null,
    searched: true,
    intelisisEnabled: true,
    desde: "2026-10-15",
    hasta: "2026-10-21",
    truncado: false,
    maxFilas: 5000,
    filtradosTotal: 0,
    run: vi.fn(),
    detalle: null as unknown,
    detalleLoading: false,
    validando: null as number | null,
    aviso: null as string | null,
    errorValidacion: null as string | null,
    abrirDetalle: vi.fn(),
    cerrarDetalle: vi.fn(),
    validar: vi.fn(),
  },
}));

vi.mock("../hooks/useIntelisisUfe", () => ({
  useIntelisisUfe: () => mocks.ufe,
}));

import IntelisisUfePage from "./IntelisisUfePage";

afterEach(cleanup);

function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function fila(overrides: Partial<IntelisisUfeRow> = {}): IntelisisUfeRow {
  return {
    id_venta: 7466462,
    tipo: "BO",
    tipo_documento_pu: "03",
    documento: "602-00142702",
    documento_estimado: false,
    documento_teorico: "602-00142702",
    comprobante: "B602-00142702",
    mov: "E-Boleta",
    mov_id: "602-142702",
    fecha_emision: "2026-10-21",
    sucursal: 602,
    sucursal_nombre: "Tienda Central",
    cliente: "CLIENTE DE PRUEBA",
    cliente_codigo: "1000000082",
    ruc: "20101031773",
    importe: 129.5,
    impuestos: 19.7542,
    total: 149.25,
    estatus_erp: "CONCLUIDO",
    referencia: "",
    estado_generacion: "generado",
    generador: "OK REGISTRADO",
    incidencias: [],
    resultado: "CONFORME",
    detalle_incidencia: null,
    en_espera: false,
    exento_generador: false,
    fuera_de_bitacora: false,
    etapa: "FINALIZADO",
    intentos: 2,
    ok_registrados: 2,
    ultimo_intento: "2026-10-21 12:41:07",
    hash: "",
    archivo_out: "BO-602-00142702.txt",
    procedimiento: "SPPUFE_UBL21",
    tipo_sunat: "BOLETA",
    sunat: { estado: "ACEPTADO", consultado: "2026-10-21 12:45:00" },
    estado_sunat: "ACEPTADO",
    reenvio: null,
    ...overrides,
  };
}

function kpis(overrides: Record<string, unknown> = {}) {
  return {
    total: 2,
    conformes: 1,
    con_incidencia: 1,
    sin_traza: 1,
    en_espera: 0,
    no_aplica: 0,
    sin_cobertura_sunat: 2,
    por_generador: [{ key: "OK REGISTRADO", count: 1 }],
    por_incidencia: [{ key: "SIN TRAZA", count: 1 }],
    por_sucursal: [{ sucursal: 602, nombre: "Tienda Central", ventas: 2, incidencias: 1 }],
    por_dia: [
      { dia: "2026-10-21", documentos: 2, sin_traza: 1, con_incidencia: 1 },
      { dia: "2026-10-20", documentos: 5, sin_traza: 0, con_incidencia: 0 },
    ],
    ...overrides,
  };
}

describe("IntelisisUfePage", () => {
  beforeEach(() => {
    stubMatchMedia();
    mocks.ufe.rows = [];
    mocks.ufe.kpis = kpis();
    mocks.ufe.loading = false;
    mocks.ufe.error = null;
    mocks.ufe.searched = true;
    mocks.ufe.intelisisEnabled = true;
    mocks.ufe.desde = "2026-10-15";
    mocks.ufe.hasta = "2026-10-21";
    mocks.ufe.detalle = null;
    mocks.ufe.detalleLoading = false;
    mocks.ufe.validando = null;
    mocks.ufe.aviso = null;
    mocks.ufe.errorValidacion = null;
    mocks.ufe.truncado = false;
    mocks.ufe.maxFilas = 5000;
    mocks.ufe.filtradosTotal = 0;
    mocks.ufe.run.mockReset();
    mocks.ufe.abrirDetalle.mockReset();
    mocks.ufe.validar.mockReset();
  });

  it("muestra el encabezado y el resumen del periodo", () => {
    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    expect(screen.getByText("Intelisis · UFE")).toBeTruthy();
    expect(screen.getByText("Emitidos")).toBeTruthy();
    expect(screen.getByText("Sin cobertura SUNAT")).toBeTruthy();
  });

  it("lista los comprobantes con su generador y su estado SUNAT", () => {
    mocks.ufe.rows = [fila()];

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    expect(screen.getByText("B602-00142702")).toBeTruthy();
    expect(screen.getAllByText("OK REGISTRADO").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Aceptado").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CONFORME").length).toBeGreaterThan(0);
  });

  it("abre la trazabilidad al hacer clic en un comprobante", () => {
    mocks.ufe.rows = [fila()];
    const { unmount } = render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    fireEvent.click(screen.getByText("B602-00142702"));

    expect(mocks.ufe.abrirDetalle).toHaveBeenCalledWith(7466462);
    unmount();
  });

  it("muestra el drawer con los intentos del generador", () => {
    mocks.ufe.detalle = {
      id_venta: 7466462,
      venta: fila(),
      intentos: [
        {
          log_id: 22224,
          estado: "OK",
          etapa: "FINALIZADO",
          documento: "602-00142702",
          detalle: "",
          error_mensaje: "",
          fecha_inicio: "2026-10-21T12:41:07",
          fecha_fin: "2026-10-21T12:41:09",
          archivo_out: "BO-602-00142702.txt",
          procedimiento: "SPPUFE_UBL21",
          duracion_ms: 2100,
          hash: "",
          tipo_movimiento: "BO",
        },
      ],
      sunat: { estado: "ACEPTADO", consultado: "2026-10-21T12:45:00" },
      estado_sunat: "ACEPTADO",
    };

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    expect(
      screen.getByText("Intentos del generador (1)"),
    ).toBeTruthy();
    expect(screen.getByText("22224")).toBeTruthy();
  });

  it("valida el comprobante contra SUNAT desde el drawer", () => {
    mocks.ufe.detalle = {
      id_venta: 7466462,
      venta: fila(),
      intentos: [],
      sunat: null,
      estado_sunat: "SUNAT SIN CONSULTA",
    };

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Validar en SUNAT" }),
    );

    expect(mocks.ufe.validar).toHaveBeenCalledWith(7466462);
  });

  it("marca como estimado el documento sin bitacora", () => {
    mocks.ufe.rows = [
      fila({
        documento: "120-00004210",
        documento_estimado: true,
        estado_generacion: "sin_registro",
        generador: "SIN TRAZA",
        resultado: "REVISAR",
        incidencias: ["SIN TRAZA"],
        estado_sunat: "SUNAT SIN CONSULTA",
        sunat: null,
      }),
    ];

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    expect(screen.getByText("estimado")).toBeTruthy();
    expect(screen.getAllByText("SIN TRAZA").length).toBeGreaterThan(0);
    expect(screen.getAllByText("REVISAR").length).toBeGreaterThan(0);
  });

  it("avisa cuando Intelisis no esta disponible", () => {
    mocks.ufe.intelisisEnabled = false;

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    expect(screen.getByText("Intelisis no disponible")).toBeTruthy();
  });

  it("muestra el error de consulta sin romper la pantalla", () => {
    mocks.ufe.error = "No fue posible consultar los comprobantes.";

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    expect(
      screen.getByText("No fue posible consultar los comprobantes."),
    ).toBeTruthy();
  });

  it("filtra en el servidor al pulsar un KPI", () => {
    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Con incidencia/ }));

    const llamadas = mocks.ufe.run.mock.calls;
    const ultima = llamadas[llamadas.length - 1];
    expect(ultima?.[2]).toEqual({ resultado: "REVISAR" });
  });

  it("avisa cuando el listado viene recortado", () => {
    mocks.ufe.truncado = true;
    mocks.ufe.maxFilas = 5000;
    mocks.ufe.filtradosTotal = 17976;

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    expect(screen.getByText("Listado recortado")).toBeTruthy();
    expect(screen.getByText(/17,976/)).toBeTruthy();
  });

  it("ofrece la cobertura por dia", () => {
    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", { name: /Ver cobertura/ }),
    );

    expect(screen.getByText("Cobertura por dia")).toBeTruthy();
    expect(screen.getAllByText("21/10/2026").length).toBeGreaterThan(0);
  });
});
