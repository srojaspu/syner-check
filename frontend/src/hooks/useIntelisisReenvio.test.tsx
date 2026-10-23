// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntelisisReenvioCola } from "../api/types";

const panelMock = vi.hoisted(() => vi.fn());
const reenviarMock = vi.hoisted(() => vi.fn());
const resolverMock = vi.hoisted(() => vi.fn());

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    getIntelisisReenvios: panelMock,
    reenviarIntelisisUfe: reenviarMock,
    resolverIntelisisReenvio: resolverMock,
  };
});

import { ApiError, AuthError } from "../api/client";
import {
  REENVIO_POLL_MS,
  hayTrabajo,
  resumenReenvio,
  useIntelisisReenvio,
} from "./useIntelisisReenvio";

const TOKEN = "d".repeat(32);

function panel(
  overrides: Partial<IntelisisReenvioCola> = {},
): IntelisisReenvioCola {
  return {
    ocupado: false,
    worker: null,
    pendientes: 0,
    sin_confirmar: 0,
    activos: [],
    historial: [],
    resumen: {},
    total: 0,
    habilitado: true,
    max_batch: 10,
    ...overrides,
  };
}

function resultado(overrides: Record<string, unknown> = {}) {
  return {
    total: 1,
    encolados: 1,
    duplicados: 0,
    rechazados: 0,
    detalle: [
      {
        id_venta: 1,
        documento: "602-00142702",
        tipo: "03",
        procedimiento: "SPPUFE_UBL21",
        estado: "encolado",
        motivo: "",
        queue_id: 9,
      },
    ],
    ...overrides,
  };
}

async function montar(onAuthFailure = vi.fn()) {
  const vista = renderHook(() => useIntelisisReenvio(onAuthFailure));
  await act(async () => {
    await Promise.resolve();
  });
  return vista;
}

beforeEach(() => {
  panelMock.mockReset();
  reenviarMock.mockReset();
  resolverMock.mockReset();
  panelMock.mockResolvedValue(panel());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useIntelisisReenvio", () => {
  it("carga el panel al montar y expone el flag y el tope", async () => {
    const { result } = await montar();

    expect(panelMock).toHaveBeenCalledWith({ limit: 20, estado: undefined });
    expect(result.current.panel?.habilitado).toBe(true);
    expect(result.current.panel?.max_batch).toBe(10);
    expect(result.current.panelLoading).toBe(false);
  });

  it("cambia el filtro del historial y reconsulta", async () => {
    const { result } = await montar();
    panelMock.mockClear();

    await act(async () => {
      result.current.cambiarFiltro("NO_CONFIRMADO");
    });

    expect(panelMock).toHaveBeenCalledWith({
      limit: 20,
      estado: "NO_CONFIRMADO",
    });
    expect(result.current.filtro).toBe("NO_CONFIRMADO");
  });

  it("encola con el token recibido y refresca la cola", async () => {
    reenviarMock.mockResolvedValue(resultado());
    const { result } = await montar();
    panelMock.mockClear();

    let ok = false;
    await act(async () => {
      ok = await result.current.reenviar([1], "no se genero", TOKEN, false);
    });

    expect(ok).toBe(true);
    expect(reenviarMock).toHaveBeenCalledWith(
      [1],
      "no se genero",
      TOKEN,
      { forzar: false },
    );
    expect(result.current.resultado?.encolados).toBe(1);
    expect(result.current.aviso).toContain("1 documento en cola");
    expect(result.current.enviando).toBe(false);
    expect(panelMock).toHaveBeenCalled(); // refresco de la cola
  });

  it("deja el error en el dialogo sin cerrar el encolado", async () => {
    reenviarMock.mockRejectedValue(
      new ApiError(409, "Solo se puede reenviar un comprobante concluido."),
    );
    const { result } = await montar();

    let ok = true;
    await act(async () => {
      ok = await result.current.reenviar([1], "x", TOKEN);
    });

    expect(ok).toBe(false);
    expect(result.current.enviando).toBe(false);
    expect(result.current.errorEnvio).toContain("concluido");
    expect(result.current.resultado).toBeNull();
  });

  it("cierra la sesion cuando la cola responde 401", async () => {
    panelMock.mockRejectedValue(new AuthError());
    const onAuthFailure = vi.fn();

    await montar(onAuthFailure);

    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it("resuelve un NO_CONFIRMADO y refresca", async () => {
    resolverMock.mockResolvedValue({
      queue_id: 31,
      estado: "REVISADO_MANUAL",
      mensaje: "Revision registrada.",
    });
    const { result } = await montar();
    panelMock.mockClear();

    let ok = false;
    await act(async () => {
      ok = await result.current.resolver(31, "se genero");
    });

    expect(ok).toBe(true);
    expect(resolverMock).toHaveBeenCalledWith(31, "se genero");
    expect(result.current.resolviendo).toBeNull();
    expect(result.current.aviso).toBe("Revision registrada.");
    expect(panelMock).toHaveBeenCalled();
  });

  it("deja el error de la resolucion en el dialogo", async () => {
    resolverMock.mockRejectedValue(
      new ApiError(409, "El procesador sigue activo."),
    );
    const { result } = await montar();

    await act(async () => {
      await result.current.resolver(31, "se genero");
    });

    expect(result.current.errorResolucion).toContain("procesador");
    expect(result.current.resolviendo).toBeNull();
  });

  it("sondea la cola mientras hay trabajo y para cuando queda vacia", async () => {
    vi.useFakeTimers();
    panelMock.mockResolvedValue(panel({ pendientes: 2 }));
    const { result } = renderHook(() => useIntelisisReenvio(vi.fn()));
    await act(async () => {
      await Promise.resolve();
    });
    expect(panelMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(REENVIO_POLL_MS);
    });
    expect(panelMock).toHaveBeenCalledTimes(2);

    panelMock.mockResolvedValue(panel({ pendientes: 0 }));
    await act(async () => {
      vi.advanceTimersByTime(REENVIO_POLL_MS);
    });
    expect(hayTrabajo(result.current.panel)).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(REENVIO_POLL_MS);
    });
    expect(panelMock).toHaveBeenCalledTimes(3);
  });
});

describe("resumenReenvio", () => {
  it("resume encolados, duplicados y rechazados", () => {
    const texto = resumenReenvio(
      resultado({ encolados: 2, duplicados: 1, rechazados: 3 }) as never,
    );

    expect(texto).toContain("2 documentos en cola");
    expect(texto).toContain("1 ya registrado");
    expect(texto).toContain("3 rechazados");
  });
});
