// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUNAT_LOTE_MAX } from "../api/client";
import type { IntelisisReenvioFila, IntelisisUfeRow } from "../api/types";

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
    busqueda: null as { documento: string; rows: IntelisisUfeRow[] } | null,
    buscar: vi.fn(),
    abrirDetalle: vi.fn(),
    cerrarDetalle: vi.fn(),
    validar: vi.fn(),
  },
  sunat: {
    busy: false,
    progress: null as unknown,
    notice: null as string | null,
    warning: null as string | null,
    error: null as string | null,
    runBatch: vi.fn(
      async (
        _rows: unknown,
        refresh: () => Promise<void> | void,
        _scope?: string,
      ) => {
        await refresh();
      },
    ),
  },
  reenvio: {
    panel: null as unknown,
    panelLoading: false,
    panelError: null as string | null,
    filtro: "",
    enviando: false,
    resolviendo: null as number | null,
    resultado: null as unknown,
    aviso: null as string | null,
    errorEnvio: null as string | null,
    errorResolucion: null as string | null,
    recargar: vi.fn(),
    cambiarFiltro: vi.fn(),
    reenviar: vi.fn(
      async (
        _ids: number[],
        _motivo: string,
        _token: string,
        _forzar?: boolean,
      ) => true,
    ),
    resolver: vi.fn(async (_queueId: number, _nota: string) => true),
    limpiarMensajes: vi.fn(),
    limpiarErrorResolucion: vi.fn(),
  },
}));

vi.mock("../hooks/useIntelisisUfe", () => ({
  useIntelisisUfe: () => mocks.ufe,
}));

vi.mock("../hooks/useSunat", () => ({
  useSunat: () => mocks.sunat,
}));

vi.mock("../hooks/useIntelisisReenvio", () => ({
  useIntelisisReenvio: () => mocks.reenvio,
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

function filaReenvio(
  overrides: Partial<IntelisisReenvioFila> = {},
): IntelisisReenvioFila {
  return {
    ID: 31,
    IDVenta: 7466462,
    Tipo: "03",
    Procedimiento: "SPPUFE_UBL21",
    Usuario: "dev@perfumeriasunidas.com.pe",
    Motivo: "no se genero",
    Estado: "NO_CONFIRMADO",
    Creado: "2026-10-21T12:41:07",
    Inicio: "2026-10-21T12:41:08",
    Fin: null,
    SPID: 71,
    LogDesde: null,
    LogHasta: null,
    Retorno: null,
    Detalle: "Conexion perdida a mitad del generador.",
    RevisadoPor: null,
    Revision: null,
    LoteID: null,
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
    mocks.ufe.buscar.mockReset();
    mocks.ufe.busqueda = null;
    mocks.ufe.abrirDetalle.mockReset();
    mocks.ufe.validar.mockReset();
    mocks.sunat.busy = false;
    mocks.sunat.progress = null;
    mocks.sunat.notice = null;
    mocks.sunat.warning = null;
    mocks.sunat.error = null;
    mocks.sunat.runBatch.mockClear();
    mocks.reenvio.panel = null;
    mocks.reenvio.panelError = null;
    mocks.reenvio.enviando = false;
    mocks.reenvio.resolviendo = null;
    mocks.reenvio.resultado = null;
    mocks.reenvio.aviso = null;
    mocks.reenvio.errorEnvio = null;
    mocks.reenvio.errorResolucion = null;
    mocks.reenvio.reenviar.mockClear();
    mocks.reenvio.resolver.mockClear();
    mocks.reenvio.recargar.mockClear();
    mocks.reenvio.cambiarFiltro.mockClear();
    mocks.reenvio.limpiarMensajes.mockClear();
    mocks.reenvio.limpiarErrorResolucion.mockClear();
  });

  it("muestra el resumen del periodo", () => {
    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    expect(screen.getByText("Emitidos")).toBeTruthy();
    expect(screen.getByText("Sin cobertura SUNAT")).toBeTruthy();
  });

  it("lista los comprobantes con su generador y su estado SUNAT", () => {
    mocks.ufe.rows = [fila()];

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Consultar/ }));

    expect(screen.getByText("B602-00142702")).toBeTruthy();
    expect(screen.getAllByText("OK REGISTRADO").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Aceptado").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CONFORME").length).toBeGreaterThan(0);
  });

  it("abre la trazabilidad al hacer clic en un comprobante", () => {
    mocks.ufe.rows = [fila()];
    const { unmount } = render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /^Consultar/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /^Consultar/ }));

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

    // El filtro queda en borrador: todavia no se consulta.
    expect(mocks.ufe.run).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: /^Consultar/ }),
    );

    const llamadas = mocks.ufe.run.mock.calls;
    const ultima = llamadas[llamadas.length - 1];
    // El filtro del KPI viaja en la consulta; los tipos van aparte como
    // parametro de la consulta (por defecto, los cuatro).
    expect(ultima?.[2]).toMatchObject({ resultado: "REVISAR" });
  });

  it("no consulta nada al entrar en la seccion", () => {
    mocks.ufe.searched = false;

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    expect(mocks.ufe.run).not.toHaveBeenCalled();
    expect(screen.getByText("Aun no hay consulta")).toBeTruthy();
  });

  it("consulta el periodo al pulsar Consultar", () => {
    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", { name: /^Consultar/ }),
    );

    expect(mocks.ufe.run).toHaveBeenCalledTimes(1);
    const llamadas = mocks.ufe.run.mock.calls;
    const ultima = llamadas[llamadas.length - 1];
    expect(ultima?.[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ultima?.[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("filtra las filas al instante sin volver a consultar", async () => {
    const user = userEvent.setup();
    mocks.ufe.rows = [
      fila({ id_venta: 1, comprobante: "B602-00000001" }),
      fila({
        id_venta: 2,
        comprobante: "B602-00000002",
        resultado: "REVISAR",
        estado_generacion: "sin_registro",
        generador: "SIN TRAZA",
        incidencias: ["SIN TRAZA"],
      }),
    ];
    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Consultar/ }));

    expect(screen.getByText("B602-00000001")).toBeTruthy();
    expect(screen.getByText("B602-00000002")).toBeTruthy();

    // El filtro "Resultado = Revisar" oculta la fila conforme, al instante.
    await user.click(screen.getByRole("combobox", { name: "Resultado" }));
    await user.click(screen.getByRole("option", { name: "Revisar" }));

    expect(screen.queryByText("B602-00000001")).toBeNull();
    expect(screen.getByText("B602-00000002")).toBeTruthy();
    // No se vuelve a consultar el ERP.
    expect(mocks.ufe.run).toHaveBeenCalledTimes(1);
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

  it("ofrece los cuatro tipos de documento como parametro de consulta", async () => {
    const user = userEvent.setup();
    mocks.ufe.rows = [
      fila({ id_venta: 1, tipo: "BO", comprobante: "B602-00000001" }),
      fila({ id_venta: 2, tipo: "FA", comprobante: "F602-00000002" }),
    ];
    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Consultar/ }));

    expect(screen.getByRole("checkbox", { name: "Factura" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Boleta" })).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: "Nota de crédito" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: "Nota de débito" }),
    ).toBeTruthy();

    // Desmarcar Factura NO filtra la tabla: es un parametro de la consulta.
    await user.click(screen.getByRole("checkbox", { name: "Factura" }));
    expect(screen.getByText("B602-00000001")).toBeTruthy();
    expect(screen.getByText("F602-00000002")).toBeTruthy();
    expect(mocks.ufe.run).toHaveBeenCalledTimes(1);

    // Al consultar, el tipo viaja al servidor sin la factura (FA).
    fireEvent.click(screen.getByRole("button", { name: /^Consultar/ }));
    const llamadas = mocks.ufe.run.mock.calls;
    const ultima = llamadas[llamadas.length - 1];
    expect(ultima?.[2]?.tipos).toEqual(["BO", "NC", "ND"]);
  });

  it("cambia entre rango de fechas y numero de comprobante", () => {
    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    // Arranca en el modo rango, con la pestaña marcada.
    expect(
      screen.getByRole("tab", { name: "Rango de fechas" }).getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
    expect(screen.getByLabelText("Elegir rango de fechas")).toBeTruthy();
    expect(screen.queryByLabelText("Numero de comprobante")).toBeNull();

    fireEvent.click(
      screen.getByRole("tab", { name: "Número de comprobante" }),
    );
    expect(screen.getByLabelText("Numero de comprobante")).toBeTruthy();
    expect(screen.queryByLabelText("Elegir rango de fechas")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Rango de fechas" }));
    expect(screen.getByLabelText("Elegir rango de fechas")).toBeTruthy();
    expect(screen.queryByLabelText("Numero de comprobante")).toBeNull();
  });

  it("permite buscar por numero de comprobante", () => {
    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("tab", { name: "Número de comprobante" }),
    );
    fireEvent.change(
      screen.getByLabelText("Numero de comprobante"),
      { target: { value: "B710-00004539" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Buscar/ }));

    expect(mocks.ufe.buscar).toHaveBeenCalledWith("B710-00004539");
  });

  it("repite la busqueda por numero despues de validar en lote", async () => {
    mocks.ufe.busqueda = { documento: "B710-00004539", rows: [fila()] };
    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("tab", { name: "Número de comprobante" }),
    );
    fireEvent.change(
      screen.getByLabelText("Numero de comprobante"),
      { target: { value: "B710-00004539" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Buscar/ }));
    expect(mocks.ufe.buscar).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: /^Validar en SUNAT/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Consultar 1 documento",
      }),
    );

    // Sin periodo que reconsultar, la grilla solo se actualiza repitiendo
    // la busqueda (era el caso en que el lote no se veia refrescado).
    await waitFor(() => expect(mocks.ufe.buscar).toHaveBeenCalledTimes(2));
    expect(mocks.ufe.buscar).toHaveBeenLastCalledWith("B710-00004539");
  });

  it("no ofrece validar mas documentos de los que admite una solicitud", () => {
    mocks.ufe.rows = Array.from({ length: SUNAT_LOTE_MAX + 1 }, (_, index) =>
      fila({
        id_venta: 5000 + index,
        comprobante: `B602-${String(index).padStart(8, "0")}`,
      }),
    );
    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Consultar/ }));

    const boton = screen.getByRole("button", {
      name: /Validar en SUNAT/,
    }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(
      screen.getByText(/documentos por solicitud/),
    ).toBeTruthy();
  });

  it("ofrece la validacion en SUNAT de los documentos mostrados", () => {
    mocks.ufe.rows = [fila()];
    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Consultar/ }));

    const boton = screen.getByRole("button", { name: /Validar en SUNAT/ });
    expect(boton.textContent).toContain("(1)");
  });

  it("no ofrece reenviar si la cola del ERP esta deshabilitada", () => {
    mocks.reenvio.panel = { habilitado: false, max_batch: 10 };
    mocks.ufe.rows = [fila()];

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Consultar/ }));

    expect(screen.queryByRole("button", { name: /Reenviar selección/ })).toBeNull();
  });

  it("encola la seleccion con motivo y token de idempotencia", async () => {
    const user = userEvent.setup();
    mocks.reenvio.panel = { habilitado: true, max_batch: 10 };
    mocks.ufe.rows = [fila()];

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Consultar/ }));

    const boton = screen.getByRole("button", {
      name: /^Reenviar selección/,
    }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);

    await user.click(
      screen.getByRole("checkbox", { name: "Seleccionar B602-00142702" }),
    );
    expect(boton.disabled).toBe(false);
    expect(boton.textContent).toContain("(1)");

    await user.click(boton);
    expect(screen.getByText("Reenviar al generador UFE")).toBeTruthy();

    await user.type(
      screen.getByLabelText("Motivo del reenvío"),
      "El cliente lo reclama",
    );
    await user.click(
      screen.getByRole("button", { name: "Encolar 1 documento" }),
    );

    expect(mocks.reenvio.reenviar).toHaveBeenCalledTimes(1);
    const [ids, motivo, token, forzar] = mocks.reenvio.reenviar.mock.calls[0];
    expect(ids).toEqual([7466462]);
    expect(motivo).toBe("El cliente lo reclama");
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(forzar).toBe(false);
  });

  it("pide confirmar antes de regenerar un documento ya generado", async () => {
    const user = userEvent.setup();
    mocks.reenvio.panel = { habilitado: true, max_batch: 10 };
    mocks.ufe.rows = [fila()];

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Consultar/ }));
    await user.click(
      screen.getByRole("checkbox", { name: "Seleccionar B602-00142702" }),
    );
    await user.click(screen.getByRole("button", { name: /^Reenviar selección/ }));

    await user.type(
      screen.getByLabelText("Motivo del reenvío"),
      "regenerar",
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "Regenerar documentos ya generados",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Encolar 1 documento" }),
    );

    expect(mocks.reenvio.reenviar.mock.calls[0][3]).toBe(true);
  });

  it("resuelve un NO_CONFIRMADO del panel con nota obligatoria", async () => {
    const user = userEvent.setup();
    mocks.reenvio.panel = {
      habilitado: true,
      max_batch: 10,
      ocupado: true,
      worker: { ID: 1, UltimoContacto: null, Estado: "PAUSADO_REVISION", TrabajoID: null, SPID: null },
      pendientes: 0,
      sin_confirmar: 1,
      activos: [filaReenvio()],
      historial: [],
      resumen: { NO_CONFIRMADO: 1 },
      total: 1,
    };

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    expect(screen.getByText(/PAUSADO_REVISION/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Resolver" }));

    // Un error de otra fila no debe sobrevivir al abrir esta revision.
    expect(mocks.reenvio.limpiarErrorResolucion).toHaveBeenCalledTimes(1);

    const confirmar = screen.getByRole("button", {
      name: "Registrar revisión",
    }) as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);

    await user.type(
      screen.getByLabelText("Nota de revisión"),
      "Se genero; se valido en SUNAT.",
    );
    await user.click(confirmar);

    expect(mocks.reenvio.resolver).toHaveBeenCalledWith(
      31,
      "Se genero; se valido en SUNAT.",
    );
  });

  it("desmarca el documento que un filtro oculta de la tabla", async () => {
    const user = userEvent.setup();
    mocks.reenvio.panel = { habilitado: true, max_batch: 10 };
    mocks.ufe.rows = [
      fila({ id_venta: 1, comprobante: "B602-00000001" }),
      fila({
        id_venta: 2,
        comprobante: "B602-00000002",
        resultado: "REVISAR",
        estado_generacion: "sin_registro",
        generador: "SIN TRAZA",
        incidencias: ["SIN TRAZA"],
      }),
    ];

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Consultar/ }));

    await user.click(
      screen.getByRole("checkbox", { name: "Seleccionar B602-00000002" }),
    );
    expect(screen.getByText(/1 seleccionado/)).toBeTruthy();

    // Al filtrar por Conforme la fila marcada desaparece: no se encola algo
    // que el usuario ya no ve en la tabla.
    await user.click(screen.getByRole("combobox", { name: "Resultado" }));
    await user.click(await screen.findByRole("option", { name: "Conforme" }));

    expect(screen.queryByText(/seleccionado/)).toBeNull();
    const boton = screen.getByRole("button", {
      name: /^Reenviar selección/,
    }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
  });

  it("mantiene la fila de filtros cuando ningun documento coincide", async () => {
    const user = userEvent.setup();
    mocks.ufe.rows = [fila({ id_venta: 1, comprobante: "B602-00000001" })];

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Consultar/ }));

    // La fila es CONFORME: filtrar por REVISAR deja la tabla sin resultados.
    await user.click(screen.getByRole("combobox", { name: "Resultado" }));
    await user.click(await screen.findByRole("option", { name: "Revisar" }));

    expect(screen.getByText("No encontramos comprobantes")).toBeTruthy();
    // La cabecera se queda: los filtros siguen accesibles para deshacerlo.
    const filtro = screen.getByRole("combobox", { name: "Resultado" });
    expect(filtro).toBeTruthy();

    await user.click(filtro);
    // Volver a elegir el mismo valor quita el filtro (toggle del panel).
    await user.click(await screen.findByRole("option", { name: "Revisar" }));

    expect(screen.getByText("B602-00000001")).toBeTruthy();
  });

  it("valida en SUNAT solo los documentos seleccionados", async () => {
    const user = userEvent.setup();
    mocks.ufe.rows = [
      fila({ id_venta: 1, comprobante: "B602-00000001" }),
      fila({ id_venta: 2, comprobante: "B602-00000002" }),
    ];

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Consultar/ }));

    const boton = screen.getByRole("button", { name: /Validar en SUNAT/ });
    expect(boton.textContent).toContain("(2)");

    await user.click(
      screen.getByRole("checkbox", { name: "Seleccionar B602-00000002" }),
    );

    expect(boton.textContent).toContain("(1)");
  });

  it("muestra el error de la cola sin romper la pantalla", () => {
    mocks.reenvio.panelError = "No fue posible consultar la cola de reenvíos.";

    render(<IntelisisUfePage onAuthFailure={vi.fn()} />);

    expect(
      screen.getByText("No fue posible consultar la cola de reenvíos."),
    ).toBeTruthy();
  });
});
