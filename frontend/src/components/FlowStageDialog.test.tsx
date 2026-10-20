// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowDocumentsResponse, FlowStageSummary } from "../api/types";

const { getFlowDocuments } = vi.hoisted(() => ({
  getFlowDocuments: vi.fn(),
}));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, getFlowDocuments };
});

import { FlowStageDialog } from "./FlowStageDialog";

afterEach(cleanup);

const summary: FlowStageSummary = {
  key: "sunat",
  enabled: true,
  total: 4,
  consulted: 3,
  states: [
    { key: "aceptado", label: "Aceptado", count: 2 },
    { key: "no_existe", label: "No encontrado", count: 0 },
    { key: "en_proceso", label: "En proceso", count: 1 },
    { key: "sin_consultar", label: "Sin consultar", count: 1 },
  ],
};

const response: FlowDocumentsResponse = {
  stage: "sunat",
  estado: "aceptado",
  label: "Aceptado",
  enabled: true,
  total: 1,
  states: summary.states,
  range: { start: "2026-10-15", end: "2026-10-15" },
  documents: [
    {
      oid: "A1",
      tipo: "FACTURA",
      number: "F001-00000001",
      date: "2026-10-15",
      contactName: "Cliente Uno",
      crossTotal: 118,
      currency: { isoCode: "PEN" },
      estado: "aceptado",
      estado_detalle: "ACEPTADO",
      fecha_consulta: "2026-10-15 14:00:00",
    },
  ],
};

const range = {
  start: "2026-10-15",
  end: "2026-10-15",
  types: "FACTURA",
};

beforeEach(() => {
  getFlowDocuments.mockReset();
});

describe("FlowStageDialog", () => {
  it("queries the documents of the clicked state", async () => {
    getFlowDocuments.mockResolvedValue(response);
    const user = userEvent.setup();

    render(
      <FlowStageDialog
        open
        stage="sunat"
        summary={summary}
        range={range}
        onOpenChange={() => {}}
        onAuthFailure={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Aceptado/ }));

    await waitFor(() => {
      expect(getFlowDocuments).toHaveBeenCalledWith(
        "sunat",
        {
          estado: "aceptado",
          start_date: "2026-10-15",
          end_date: "2026-10-15",
          types: "FACTURA",
        },
        expect.any(AbortSignal),
      );
    });
    expect(await screen.findByText("F001-00000001")).toBeTruthy();
    expect(screen.getByText(/Cliente Uno/)).toBeTruthy();
  });

  it("hides states with zero documents", () => {
    render(
      <FlowStageDialog
        open
        stage="sunat"
        summary={summary}
        range={range}
        onOpenChange={() => {}}
        onAuthFailure={() => {}}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /No encontrado/ }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /Aceptado/ })).toBeTruthy();
  });

  it("warns when the stage is not available", () => {
    render(
      <FlowStageDialog
        open
        stage="intelisis"
        summary={{
          key: "intelisis",
          enabled: false,
          total: 4,
          consulted: 4,
          states: [{ key: "ausente", label: "No encontrado", count: 4 }],
        }}
        range={range}
        onOpenChange={() => {}}
        onAuthFailure={() => {}}
      />,
    );

    expect(screen.getByText("Clasificación no disponible")).toBeTruthy();
  });
});
