// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SunatSubmissionResponse } from "../api/types";

const submitMock = vi.hoisted(() => vi.fn());
const statusMock = vi.hoisted(() => vi.fn());

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
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
    total: 1,
    alcance: "no_aceptados",
    por_enviar: 0,
    chunks_total: 0,
    chunks_done: 0,
    enviados: 0,
    omitidos: { aceptados: 1, en_proceso: 0, sin_confirmar: 0, invalidos: [] },
    trabajos: [],
    errores: [],
    porcentaje: 100,
    iniciado_en: "",
    actualizado_en: "",
  };
}

describe("useSunat · lote", () => {
  it("manda el importe declarado por el generador", async () => {
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
  });
});
