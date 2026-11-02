// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntelisisUfeDetalle, IntelisisUfeRow } from "../api/types";

const getMock = vi.hoisted(() => vi.fn());
const detalleMock = vi.hoisted(() => vi.fn());
const validarMock = vi.hoisted(() => vi.fn());
const buscarMock = vi.hoisted(() => vi.fn());

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    getIntelisisUfe: getMock,
    getIntelisisUfeDetalle: detalleMock,
    validarIntelisisUfe: validarMock,
    buscarIntelisisUfe: buscarMock,
  };
});

import { AuthError } from "../api/client";
import { useIntelisisUfe } from "./useIntelisisUfe";

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
    cliente: "CLIENTE",
    cliente_codigo: "1000000082",
    ruc: "20101031773",
    importe: 100,
    impuestos: 18,
    total: 118,
    importe_sunat: 118,
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
    intentos: 1,
    ok_registrados: 1,
    ultimo_intento: "2026-10-21 12:41:07",
    hash: "",
    archivo_out: "",
    procedimiento: "SPPUFE_UBL21",
    tipo_sunat: "BOLETA",
    sunat: null,
    estado_sunat: "SUNAT SIN CONSULTA",
    reenvio: null,
    ...overrides,
  };
}

function respuesta(overrides: Record<string, unknown> = {}) {
  return {
    desde: "2026-10-15",
    hasta: "2026-10-21",
    bitacora_desde: "2026-09-24",
    intelisis_enabled: true,
    kpis: {
      total: 1,
      conformes: 1,
      con_incidencia: 0,
      sin_traza: 0,
      en_espera: 0,
      no_aplica: 0,
      sin_cobertura_sunat: 1,
      por_generador: [],
      por_incidencia: [],
      por_sucursal: [],
    },
    filtrados: 1,
    truncado: false,
    max_filas: 5000,
    rows: [fila()],
    ...overrides,
  };
}

afterEach(() => {
  getMock.mockReset();
  detalleMock.mockReset();
  validarMock.mockReset();
});

describe("useIntelisisUfe", () => {
  it("consulta el periodo con los filtros del servidor", async () => {
    getMock.mockResolvedValue(respuesta());
    const { result } = renderHook(() => useIntelisisUfe(vi.fn()));

    await act(async () => {
      await result.current.run("2026-10-15", "2026-10-21", {
        generador: "SIN TRAZA",
      });
    });

    expect(getMock).toHaveBeenCalledWith(
      { desde: "2026-10-15", hasta: "2026-10-21", generador: "SIN TRAZA" },
      expect.anything(),
    );
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.kpis?.total).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it("la busqueda por numero no arrastra los kpis del periodo", async () => {
    getMock.mockResolvedValue(respuesta());
    buscarMock.mockResolvedValue({
      documento_buscado: "B602-00142702",
      intelisis_enabled: true,
      encontrados: 1,
      rows: [fila()],
    });
    const { result } = renderHook(() => useIntelisisUfe(vi.fn()));

    await act(async () => {
      await result.current.run("2026-10-15", "2026-10-21", {});
    });
    expect(result.current.kpis).not.toBeNull();

    await act(async () => {
      await result.current.buscar("B602-00142702");
    });

    expect(result.current.kpis).toBeNull();
    expect(result.current.busqueda?.rows).toHaveLength(1);
  });

  it("avisa el error sin romper", async () => {
    getMock.mockRejectedValue(new Error("No fue posible consultar."));
    const { result } = renderHook(() => useIntelisisUfe(vi.fn()));

    await act(async () => {
      await result.current.run("2026-10-15", "2026-10-21");
    });

    expect(result.current.error).toBe("No fue posible consultar.");
    expect(result.current.loading).toBe(false);
  });

  it("cierra la sesion cuando la API responde 401", async () => {
    getMock.mockRejectedValue(new AuthError());
    const onAuthFailure = vi.fn();
    const { result } = renderHook(() => useIntelisisUfe(onAuthFailure));

    await act(async () => {
      await result.current.run("2026-10-15", "2026-10-21");
    });

    expect(onAuthFailure).toHaveBeenCalled();
  });

  it("abre la trazabilidad de un documento", async () => {
    const detalle: IntelisisUfeDetalle = {
      id_venta: 7466462,
      venta: fila(),
      intentos: [],
      sunat: null,
      estado_sunat: "SUNAT SIN CONSULTA",
    };
    detalleMock.mockResolvedValue(detalle);
    const { result } = renderHook(() => useIntelisisUfe(vi.fn()));

    await act(async () => {
      await result.current.abrirDetalle(7466462);
    });

    expect(detalleMock).toHaveBeenCalledWith(7466462);
    expect(result.current.detalle?.id_venta).toBe(7466462);
    expect(result.current.detalleLoading).toBe(false);
  });

  it("cerrar el detalle no borra los resultados de la busqueda", async () => {
    buscarMock.mockResolvedValue({
      documento_buscado: "B602-00142702",
      intelisis_enabled: true,
      encontrados: 1,
      rows: [fila()],
    });
    detalleMock.mockResolvedValue({
      id_venta: 7466462,
      venta: fila(),
      intentos: [],
      sunat: null,
      estado_sunat: "SUNAT SIN CONSULTA",
    });
    const { result } = renderHook(() => useIntelisisUfe(vi.fn()));

    await act(async () => {
      await result.current.buscar("B602-00142702");
    });
    await act(async () => {
      await result.current.abrirDetalle(7466462);
    });
    act(() => result.current.cerrarDetalle());

    expect(result.current.detalle).toBeNull();
    // En modo numero la tabla se alimenta de la busqueda.
    expect(result.current.busqueda?.rows).toHaveLength(1);
  });

  it("actualiza la fila al validar en SUNAT", async () => {
    getMock.mockResolvedValue(respuesta());
    validarMock.mockResolvedValue({
      id_venta: 7466462,
      documento: "602-00142702",
      comprobante: "B602-00142702",
      estado: "ACEPTADO",
      resultado: { estado: "ACEPTADO" },
    });
    const { result } = renderHook(() => useIntelisisUfe(vi.fn()));

    await act(async () => {
      await result.current.run("2026-10-15", "2026-10-21");
    });
    await act(async () => {
      await result.current.validar(7466462);
    });

    expect(validarMock).toHaveBeenCalledWith(7466462);
    expect(result.current.rows[0].estado_sunat).toBe("ACEPTADO");
    expect(result.current.rows[0].resultado).toBe("CONFORME");
    expect(result.current.rows[0].incidencias).toEqual([]);
    expect(result.current.validando).toBeNull();
  });

  it("recalcula incidencias y resultado al validar un comprobante en SUNAT", async () => {
    getMock.mockResolvedValue(
      respuesta({
        rows: [
          fila({
            estado_sunat: "SUNAT NO ENCONTRADO",
            incidencias: ["SUNAT NO ENCONTRADO"],
            resultado: "REVISAR",
          }),
        ],
      }),
    );
    validarMock.mockResolvedValue({
      id_venta: 7466462,
      documento: "602-00142702",
      comprobante: "B602-00142702",
      estado: "ACEPTADO",
      resultado: { estado: "ACEPTADO" },
    });
    const { result } = renderHook(() => useIntelisisUfe(vi.fn()));

    await act(async () => {
      await result.current.run("2026-10-15", "2026-10-21");
    });
    expect(result.current.rows[0].resultado).toBe("REVISAR");

    await act(async () => {
      await result.current.validar(7466462);
    });

    expect(result.current.rows[0].estado_sunat).toBe("ACEPTADO");
    expect(result.current.rows[0].incidencias).toEqual([]);
    expect(result.current.rows[0].resultado).toBe("CONFORME");
  });

  it("actualiza el detalle abierto al validar en SUNAT", async () => {
    detalleMock.mockResolvedValue({
      id_venta: 7466462,
      venta: fila(),
      intentos: [],
      sunat: null,
      estado_sunat: "SUNAT SIN CONSULTA",
    });
    validarMock.mockResolvedValue({
      id_venta: 7466462,
      documento: "602-00142702",
      comprobante: "B602-00142702",
      estado: "ACEPTADO",
      resultado: { estado: "ACEPTADO" },
    });
    const { result } = renderHook(() => useIntelisisUfe(vi.fn()));

    await act(async () => {
      await result.current.abrirDetalle(7466462);
    });
    await act(async () => {
      await result.current.validar(7466462);
    });

    // El drawer pinta `detalle.venta.estado_sunat`, no solo el envoltorio.
    expect(result.current.detalle?.venta.estado_sunat).toBe("ACEPTADO");
    expect(result.current.detalle?.estado_sunat).toBe("ACEPTADO");
  });

  it("deja el error de validacion a la vista", async () => {
    validarMock.mockRejectedValue(new Error("SUNAT no responde."));
    const { result } = renderHook(() => useIntelisisUfe(vi.fn()));

    await act(async () => {
      await result.current.validar(7466462);
    });

    expect(result.current.errorValidacion).toBe("SUNAT no responde.");
    expect(result.current.validando).toBeNull();
  });
});
