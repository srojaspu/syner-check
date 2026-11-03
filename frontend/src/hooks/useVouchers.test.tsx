// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResponse } from "../api/types";

const searchNumberMock = vi.hoisted(() => vi.fn());
const summaryMock = vi.hoisted(() => vi.fn());

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    getSummary: summaryMock,
    searchByNumber: searchNumberMock,
  };
});

import { useVouchers } from "./useVouchers";

function response(overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    results: [],
    source: "sql_index",
    intelisis_enabled: false,
    intelisis_warning: null,
    sunat_enabled: false,
    ...overrides,
  };
}

describe("useVouchers · aviso de notas de crédito", () => {
  beforeEach(() => {
    searchNumberMock.mockReset();
    summaryMock.mockReset();
  });

  it("expone nc_warning cuando el fallback de NC quedó incompleto", async () => {
    searchNumberMock.mockResolvedValue(
      response({ nc_warning: "credit_notes_unavailable" }),
    );
    const { result } = renderHook(() => useVouchers(vi.fn()));

    await act(async () => {
      await result.current.runNumber("BS20-00000116");
    });

    expect(result.current.ncWarning).toBe("credit_notes_unavailable");
    expect(result.current.error).toBeNull();
    expect(result.current.subtitle).toContain("índice local");
  });

  it("limpia nc_warning en la siguiente búsqueda sin aviso", async () => {
    searchNumberMock
      .mockResolvedValueOnce(
        response({ nc_warning: "credit_notes_unavailable" }),
      )
      .mockResolvedValueOnce(response());
    const { result } = renderHook(() => useVouchers(vi.fn()));

    await act(async () => {
      await result.current.runNumber("BS20-00000116");
    });
    expect(result.current.ncWarning).toBe("credit_notes_unavailable");

    await act(async () => {
      await result.current.runNumber("BS20-00000117");
    });
    expect(result.current.ncWarning).toBeNull();
  });

  it("el resumen por rango no arrastra el aviso de una búsqueda por número", async () => {
    searchNumberMock.mockResolvedValue(
      response({ nc_warning: "credit_notes_unavailable" }),
    );
    summaryMock.mockResolvedValue({
      documents: {},
      sql_count: 0,
      graphql_count: 0,
      intelisis_enabled: false,
      intelisis_count: 0,
      sunat_enabled: false,
      range: { start: "2026-11-01", end: "2026-11-02" },
    });
    const { result } = renderHook(() => useVouchers(vi.fn()));

    await act(async () => {
      await result.current.runNumber("BS20-00000116");
    });
    expect(result.current.ncWarning).not.toBeNull();

    await act(async () => {
      await result.current.runRange("2026-11-01", "2026-11-02", "BOLETA");
    });
    expect(result.current.ncWarning).toBeNull();
  });
});
