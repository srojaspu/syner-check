// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MovSynerPosResponse, Voucher } from "../api/types";

const sendMock = vi.hoisted(() => vi.fn());

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, sendMovSynerPos: sendMock };
});

import { AuthError } from "../api/client";
import { useMovSynerPos } from "./useMovSynerPos";

function row(index: number): Voucher {
  return {
    oid: `oid-${index}`,
    tipo: "BOLETA",
    number: `B004-${index}`,
    date: "2026-10-20",
    crossTotal: 10,
    in_sql: false,
  };
}

function response(
  overrides: Partial<MovSynerPosResponse> = {},
): MovSynerPosResponse {
  return {
    solicitud_id: "s-1",
    total: 1,
    insertados: 1,
    reparados: 0,
    sin_cambios: 0,
    conflictos: 0,
    errores: 0,
    detalle: [],
    ...overrides,
  };
}

afterEach(() => {
  sendMock.mockReset();
});

describe("useMovSynerPos", () => {
  it("sends 23 documents in batches of 10/10/3", async () => {
    sendMock.mockImplementation((documentos: unknown[]) =>
      Promise.resolve(
        response({ total: documentos.length, insertados: documentos.length }),
      ),
    );
    const refresh = vi.fn();
    const { result } = renderHook(() => useMovSynerPos(vi.fn()));

    await act(async () => {
      await result.current.run(
        Array.from({ length: 23 }, (_, index) => row(index)),
        refresh,
      );
    });

    expect(sendMock).toHaveBeenCalledTimes(3);
    const sizes = sendMock.mock.calls.map((call) => call[0].length);
    expect(sizes).toEqual([10, 10, 3]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.current.progress).toMatchObject({
      enviados: 23,
      total: 23,
      insertados: 23,
      errores: 0,
    });
    expect(result.current.notice).toContain("23 insertados");
    expect(result.current.busy).toBe(false);
    expect(result.current.failed).toEqual([]);
  });

  it("retries only the failed documents", async () => {
    sendMock.mockResolvedValueOnce(
      response({
        total: 2,
        insertados: 1,
        errores: 1,
        detalle: [
          {
            tipo: "BOLETA",
            oid: "oid-1",
            number: "B004-1",
            estado: "error",
            lineas_insertadas: 0,
            lineas_existentes: 0,
            lineas_faltantes: 1,
            error: "Documento no encontrado en SynerCom.",
          },
        ],
      }),
    );
    sendMock.mockResolvedValueOnce(response({ total: 1, insertados: 1 }));

    const refresh = vi.fn();
    const { result } = renderHook(() => useMovSynerPos(vi.fn()));

    await act(async () => {
      await result.current.run([row(0), row(1)], refresh);
    });
    expect(result.current.failed).toHaveLength(1);
    expect(result.current.failed[0].oid).toBe("oid-1");
    expect(result.current.warning).toContain("SynerCom");

    await act(async () => {
      await result.current.retry(refresh);
    });
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[1][0]).toEqual([
      {
        tipo: "BOLETA",
        oid: "oid-1",
        number: "B004-1",
        date: "2026-10-20",
      },
    ]);
  });

  it("keeps every unconfirmed document available for retry on error", async () => {
    sendMock.mockRejectedValueOnce(new Error("No se pudo reenviar a SynerPOS."));
    const { result } = renderHook(() => useMovSynerPos(vi.fn()));

    await act(async () => {
      await result.current.run([row(0), row(1)], vi.fn());
    });

    expect(result.current.error).toContain("SynerPOS");
    expect(result.current.failed).toHaveLength(2);
    expect(result.current.busy).toBe(false);
  });

  it("routes 401 to the auth handler", async () => {
    sendMock.mockRejectedValueOnce(new AuthError());
    const onAuthFailure = vi.fn();
    const { result } = renderHook(() => useMovSynerPos(onAuthFailure));

    await act(async () => {
      await result.current.run([row(0)], vi.fn());
    });

    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it("sends the reparar flag on every batch", async () => {
    sendMock.mockResolvedValue(response());
    const { result } = renderHook(() => useMovSynerPos(vi.fn()));

    await act(async () => {
      await result.current.run([row(0), row(1)], vi.fn(), true);
    });

    expect(sendMock.mock.calls[0][1]).toBe(true);
  });

  it("ignores an empty selection", async () => {
    const { result } = renderHook(() => useMovSynerPos(vi.fn()));

    await act(async () => {
      await result.current.run([], vi.fn());
    });

    expect(sendMock).not.toHaveBeenCalled();
    expect(result.current.progress).toBeNull();
  });

  it("reset clears progress and failed documents", async () => {
    sendMock.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useMovSynerPos(vi.fn()));

    await act(async () => {
      await result.current.run([row(0)], vi.fn());
    });
    act(() => result.current.reset());

    expect(result.current.progress).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.failed).toEqual([]);
  });
});
