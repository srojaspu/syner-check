// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SunatSubmissionResponse } from "../api/types";

const submitMock = vi.hoisted(() => vi.fn());
const statusMock = vi.hoisted(() => vi.fn());
const revalidateMock = vi.hoisted(() => vi.fn());

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    revalidateSunatDoc: revalidateMock,
    submitSunatLote: submitMock,
    sunatSubmissionStatus: statusMock,
  };
});

import { useSunat } from "./useSunat";

function cola(): SunatSubmissionResponse {
  return {
    solicitud_id: "s1",
    estado: "COMPLETADO",
    fase: "listo",
    mensaje: "",
    total: 2,
    alcance: "no_aceptados",
    por_enviar: 0,
    chunks_total: 0,
    chunks_done: 0,
    enviados: 0,
    omitidos: { aceptados: 2, en_proceso: 0, sin_confirmar: 0, invalidos: [] },
    trabajos: [],
    errores: [],
    porcentaje: 100,
    iniciado_en: "",
    actualizado_en: "",
  };
}

describe("useSunat · lote y fast-path unitario", () => {
  it("valida 1 solo documento por via sincrona sin encolar un lote", async () => {
    submitMock.mockClear();
    revalidateMock.mockReset();
    revalidateMock.mockResolvedValue({
      estado: "ACEPTADO",
      resultado: { estado: "ACEPTADO" },
    });
    const refresh = vi.fn();
    const { result } = renderHook(() => useSunat(vi.fn()));

    await act(async () => {
      await result.current.runBatch(
        [
          {
            tipo: "FACTURA",
            number: "F710-00213172",
            date: "2026-10-26",
            crossTotal: 1679.59,
            importe_sunat: 1679.57,
          },
        ],
        refresh,
      );
    });

    expect(submitMock).not.toHaveBeenCalled();
    expect(revalidateMock).toHaveBeenCalledTimes(1);
    const [doc, forzar] = revalidateMock.mock.calls[0];
    expect(doc).toMatchObject({
      tipo: "FACTURA",
      number: "F710-00213172",
      crossTotal: 1679.59,
      importe_sunat: 1679.57,
    });
    expect(forzar).toBe(false);
    expect(result.current.progress?.estado).toBe("COMPLETADO");
    expect(result.current.progress?.porcentaje).toBe(100);
    expect(result.current.status).toBe("completed");
    expect(refresh).toHaveBeenCalled();
  });

  it("manda el importe declarado por el generador en lotes de varios documentos", async () => {
    submitMock.mockClear();
    revalidateMock.mockReset();
    submitMock.mockResolvedValue(cola());
    statusMock.mockResolvedValue(cola());
    const refresh = vi.fn();
    const { result } = renderHook(() => useSunat(vi.fn()));

    await act(async () => {
      await result.current.runBatch(
        [
          {
            tipo: "01",
            number: "F710-00213172",
            date: "2026-10-26",
            crossTotal: 1679.59,
            importe_sunat: 1679.57,
          },
          {
            tipo: "01",
            number: "F710-00213173",
            date: "2026-10-26",
            crossTotal: 100.0,
            importe_sunat: 100.0,
          },
        ],
        refresh,
      );
    });

    const [documentos] = submitMock.mock.calls[0];
    expect(documentos[0]).toMatchObject({
      tipo: "01",
      number: "F710-00213172",
      crossTotal: 1679.59,
      importe_sunat: 1679.57,
    });
    expect(refresh).toHaveBeenCalled();
    expect(result.current.status).toBe("completed");
  });

  it("marca failed y no deja el modal en curso cuando el lote se rechaza", async () => {
    submitMock.mockClear();
    revalidateMock.mockReset();
    const rechazo = {
      ...cola(),
      estado: "ERROR",
      mensaje: "SUNAT no disponible.",
    };
    submitMock.mockResolvedValue(rechazo);
    statusMock.mockResolvedValue(rechazo);
    const { result } = renderHook(() => useSunat(vi.fn()));

    await act(async () => {
      await result.current.runBatch(
        [
          {
            tipo: "01",
            number: "F710-00213172",
            date: "2026-10-26",
            crossTotal: 10,
          },
          {
            tipo: "01",
            number: "F710-00213173",
            date: "2026-10-26",
            crossTotal: 10,
          },
        ],
        vi.fn(),
      );
    });

    expect(result.current.error).toContain("SUNAT no disponible");
    expect(result.current.status).toBe("failed");
    expect(result.current.busy).toBe(false);
  });

  it("no inventa una cancelacion cuando no hay validacion en curso", async () => {
    const { result } = renderHook(() => useSunat(vi.fn()));

    await act(async () => {
      await result.current.cancel();
    });

    expect(result.current.warning).toBeNull();
    expect(result.current.status).toBe("idle");
  });
});
