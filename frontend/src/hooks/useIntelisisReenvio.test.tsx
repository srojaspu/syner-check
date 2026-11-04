// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IntelisisReenvioCola,
  IntelisisReenvioFila,
} from "../api/types";

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
  loteTerminado,
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

function filaCola(
  overrides: Partial<IntelisisReenvioFila> = {},
): IntelisisReenvioFila {
  return {
    ID: 9,
    IDVenta: 1,
    Tipo: "03",
    Procedimiento: "SPPUFE_UBL21",
    Usuario: "dev@perfumeriasunidas.com.pe",
    Motivo: "no se genero",
    Estado: "EN_COLA",
    Creado: "2026-11-04T09:00:00",
    Inicio: null,
    Fin: null,
    SPID: null,
    LogDesde: null,
    LogHasta: null,
    Retorno: null,
    Detalle: null,
    RevisadoPor: null,
    Revision: null,
    LoteID: null,
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

    expect(panelMock).toHaveBeenCalledWith({ limit: 100 });
    expect(result.current.panel?.habilitado).toBe(true);
    expect(result.current.panel?.max_batch).toBe(10);
    expect(result.current.panelLoading).toBe(false);
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

  it("sigue el lote encolado y avisa una sola vez cuando termina", async () => {
    vi.useFakeTimers();
    panelMock.mockResolvedValue(
      panel({ pendientes: 1, activos: [filaCola()] }),
    );
    reenviarMock.mockResolvedValue(resultado());
    const { result } = renderHook(() => useIntelisisReenvio(vi.fn()));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      expect(
        await result.current.reenviar([1], "no se genero", TOKEN),
      ).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.siguiendo).toBe(true);
    expect(result.current.finalizaciones).toBe(0);

    panelMock.mockResolvedValue(
      panel({
        historial: [
          filaCola({ Estado: "FINALIZADO_OK", Fin: "2026-11-04T09:00:05" }),
        ],
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(REENVIO_POLL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.finalizaciones).toBe(1);
    expect(result.current.finalizadoSinConfirmar).toBe(false);
    expect(result.current.siguiendo).toBe(false);

    // El lote cerro: no queda trabajo ni seguimiento, el intervalo se detiene.
    const llamadas = panelMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(REENVIO_POLL_MS);
    });
    expect(panelMock.mock.calls.length).toBe(llamadas);
  });

  it("cierra el seguimiento cuando el lote queda sin confirmar", async () => {
    vi.useFakeTimers();
    panelMock.mockResolvedValue(
      panel({ pendientes: 1, activos: [filaCola()] }),
    );
    reenviarMock.mockResolvedValue(resultado());
    const { result } = renderHook(() => useIntelisisReenvio(vi.fn()));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.reenviar([1], "no se genero", TOKEN);
      await Promise.resolve();
      await Promise.resolve();
    });

    panelMock.mockResolvedValue(
      panel({
        sin_confirmar: 1,
        activos: [filaCola({ Estado: "NO_CONFIRMADO" })],
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(REENVIO_POLL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.finalizaciones).toBe(1);
    expect(result.current.finalizadoSinConfirmar).toBe(true);
    expect(result.current.siguiendo).toBe(false);
  });

  it("no sigue nada cuando ningun documento entro a la cola", async () => {
    vi.useFakeTimers();
    panelMock.mockResolvedValue(panel());
    reenviarMock.mockResolvedValue(
      resultado({
        total: 1,
        encolados: 0,
        duplicados: 0,
        rechazados: 1,
        detalle: [
          {
            id_venta: 1,
            documento: "602-00142702",
            tipo: "",
            procedimiento: "",
            estado: "rechazado",
            motivo: "El documento ya esta generado.",
            queue_id: null,
          },
        ],
      }),
    );
    const { result } = renderHook(() => useIntelisisReenvio(vi.fn()));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.reenviar([1], "no se genero", TOKEN);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.siguiendo).toBe(false);
    expect(result.current.finalizaciones).toBe(0);
  });

  it("sigue sondeando aunque el primer panel tras encolar falle", async () => {
    vi.useFakeTimers();
    panelMock.mockResolvedValue(panel());
    reenviarMock.mockResolvedValue(resultado());
    const { result } = renderHook(() => useIntelisisReenvio(vi.fn()));
    await act(async () => {
      await Promise.resolve();
    });

    panelMock.mockRejectedValueOnce(new Error("cola no disponible"));
    await act(async () => {
      await result.current.reenviar([1], "no se genero", TOKEN);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.siguiendo).toBe(true);

    panelMock.mockResolvedValue(
      panel({
        historial: [filaCola({ Estado: "FINALIZADO_OK" })],
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(REENVIO_POLL_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.finalizaciones).toBe(1);
  });
});

describe("loteTerminado", () => {
  it("no cierra mientras el job siga encolado o ejecutandose", () => {
    expect(
      loteTerminado(panel({ activos: [filaCola()] }), new Set([9])),
    ).toBe(false);
    expect(
      loteTerminado(
        panel({ activos: [filaCola({ Estado: "EJECUTANDO" })] }),
        new Set([9]),
      ),
    ).toBe(false);
  });

  it("cierra cuando el job aparece en el historial con estado final", () => {
    expect(
      loteTerminado(
        panel({ historial: [filaCola({ Estado: "FINALIZADO_OK" })] }),
        new Set([9]),
      ),
    ).toBe(true);
  });

  it("cierra cuando el job queda sin confirmar (requiere una persona)", () => {
    expect(
      loteTerminado(
        panel({
          sin_confirmar: 1,
          activos: [filaCola({ Estado: "NO_CONFIRMADO" })],
        }),
        new Set([9]),
      ),
    ).toBe(true);
  });

  it("cierra con la cola vacia y sin rastro del job", () => {
    expect(loteTerminado(panel(), new Set([9]))).toBe(true);
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

  it("no dice '0 documentos en cola' cuando todo fue duplicado", () => {
    const texto = resumenReenvio(
      resultado({ encolados: 0, duplicados: 1, rechazados: 0 }) as never,
    );

    expect(texto).toBe("1 ya registrado.");
  });
});
