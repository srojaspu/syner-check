// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthError,
  RequestAbortedError,
  sendMovSynerPos,
} from "./client";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("sendMovSynerPos", () => {
  it("posts only document identity and the reparar flag", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      jsonResponse({
        solicitud_id: "s-1",
        total: 1,
        insertados: 1,
        reparados: 0,
        sin_cambios: 0,
        conflictos: 0,
        errores: 0,
        detalle: [],
      }),
    );

    const documentos = [
      {
        tipo: "BOLETA" as const,
        oid: "oid-1",
        number: "B004-1",
        date: "2026-10-20",
      },
    ];
    const result = await sendMovSynerPos(documentos, true);

    expect(result.insertados).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/movsynerpos/enviar");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(init.body)).toEqual({ documentos, reparar: true });
  });

  it("surfaces the backend detail as ApiError", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "El reenvío a SynerPOS está deshabilitado." }, 503),
    );

    await expect(sendMovSynerPos([], false)).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      message: "El reenvío a SynerPOS está deshabilitado.",
    });
  });

  it("maps 401 to AuthError", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(jsonResponse({ detail: "auth" }, 401));

    await expect(sendMovSynerPos([], false)).rejects.toBeInstanceOf(AuthError);
  });

  it("keeps abort semantics for a cancelled batch", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValue(
      Object.assign(new DOMException("aborted", "AbortError")),
    );

    await expect(
      sendMovSynerPos([], false, controller.signal),
    ).rejects.toBeInstanceOf(RequestAbortedError);
  });

  it("reports an invalid server response clearly", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    await expect(sendMovSynerPos([], false)).rejects.toThrow(
      "Respuesta inválida del servidor.",
    );
  });
});
