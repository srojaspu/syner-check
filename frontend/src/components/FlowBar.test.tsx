// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowBreakdown } from "../api/types";
import { FlowBar } from "./FlowBar";

afterEach(cleanup);

const flow: FlowBreakdown = {
  per_tipo: {},
  totals: {
    graphql: 4,
    in_mov: 4,
    in_intelisis: 3,
    full: 1,
    pending_in_intelisis: 1,
    cancelled_in_intelisis: 1,
    missing_in_mov: 0,
    missing_in_intelisis: 1,
  },
  stages: {
    intelisis: {
      key: "intelisis",
      enabled: true,
      total: 4,
      consulted: 4,
      states: [
        { key: "completo", label: "Completo", count: 1 },
        { key: "pendiente", label: "Pendiente", count: 1 },
        { key: "cancelado", label: "Cancelado", count: 1 },
        { key: "ausente", label: "No encontrado", count: 1 },
      ],
    },
    sunat: {
      key: "sunat",
      enabled: true,
      total: 4,
      consulted: 3,
      states: [
        { key: "aceptado", label: "Aceptado", count: 2 },
        { key: "en_proceso", label: "En proceso", count: 1 },
        { key: "sin_consultar", label: "Sin consultar", count: 1 },
      ],
    },
  },
};

function renderFlow(onOpenStage = vi.fn()) {
  render(
    <FlowBar
      flow={flow}
      intelisisEnabled
      intelisisCount={3}
      sunatEnabled
      onOpenStage={onOpenStage}
    />,
  );
  return onOpenStage;
}

describe("FlowBar", () => {
  it("shows the SUNAT card outside the flow, without an arrow", () => {
    const { container } = render(
      <FlowBar
        flow={flow}
        intelisisEnabled
        intelisisCount={3}
        sunatEnabled
        onOpenStage={() => {}}
      />,
    );
    const sunat = screen.getByRole("button", { name: /SUNAT/ });
    expect(sunat.textContent).toContain("2");
    expect(screen.getByText("En paralelo · Factus")).toBeTruthy();
    expect(container.querySelectorAll("button")).toHaveLength(2);
  });

  it("opens the Intelisis detail when its card is clicked", async () => {
    const user = userEvent.setup();
    const onOpenStage = renderFlow();
    await user.click(screen.getByRole("button", { name: /Intelisis/ }));
    expect(onOpenStage).toHaveBeenCalledWith("intelisis");
  });

  it("opens the SUNAT detail when its card is clicked", async () => {
    const user = userEvent.setup();
    const onOpenStage = renderFlow();
    await user.click(screen.getByRole("button", { name: /SUNAT/ }));
    expect(onOpenStage).toHaveBeenCalledWith("sunat");
  });
});
