// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowBreakdown, FlowStageKey } from "../api/types";
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
    cancelled_in_intelisis: 0,
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
        { key: "completo", label: "Completo", count: 2 },
        { key: "pendiente", label: "Pendiente", count: 1 },
        { key: "cancelado", label: "Cancelado", count: 0 },
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
        { key: "no_existe", label: "No encontrado", count: 0 },
        { key: "en_proceso", label: "En proceso", count: 1 },
        { key: "sin_consultar", label: "Sin consultar", count: 1 },
      ],
    },
  },
};

function renderFlow({
  intelisisEnabled = true,
  sunatEnabled = true,
  selectedStage = null,
  selectedState = null,
}: {
  intelisisEnabled?: boolean;
  sunatEnabled?: boolean;
  selectedStage?: FlowStageKey | null;
  selectedState?: string | null;
} = {}) {
  const onSelectState = vi.fn();
  const onClearSelection = vi.fn();
  render(
    <FlowBar
      flow={flow}
      intelisisEnabled={intelisisEnabled}
      intelisisCount={3}
      sunatEnabled={sunatEnabled}
      selectedStage={selectedStage}
      selectedState={selectedState}
      onSelectState={onSelectState}
      onClearSelection={onClearSelection}
    />,
  );
  return { onSelectState, onClearSelection };
}

describe("FlowBar", () => {
  it("shows the SUNAT card outside the flow, without an arrow", () => {
    const { container } = render(
      <FlowBar
        flow={flow}
        intelisisEnabled
        intelisisCount={3}
        sunatEnabled
        onSelectState={() => {}}
      />,
    );
    const sunat = screen.getByRole("button", { name: /SUNAT/ });
    expect(sunat.textContent).toContain("2");
    expect(screen.queryByText("En paralelo · Factus")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(2);
  });

  it("opens the Intelisis state popover and hides zero-count states", async () => {
    const user = userEvent.setup();
    const { onSelectState } = renderFlow();

    await user.click(screen.getByRole("button", { name: /Intelisis/ }));

    expect(await screen.findByText("Intelisis · estados")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Completo/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pendiente/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /No encontrado/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Cancelado/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: /Completo/ }));
    expect(onSelectState).toHaveBeenCalledWith("intelisis", "completo");
  });

  it("opens the SUNAT state popover and selects a state for the table", async () => {
    const user = userEvent.setup();
    const { onSelectState } = renderFlow();

    await user.click(screen.getByRole("button", { name: /SUNAT/ }));

    expect(await screen.findByText("SUNAT · estados")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /No encontrado/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: /Aceptado/ }));
    expect(onSelectState).toHaveBeenCalledWith("sunat", "aceptado");
  });

  it("highlights the selected state and clears the filter", async () => {
    const user = userEvent.setup();
    const { onClearSelection } = renderFlow({
      selectedStage: "sunat",
      selectedState: "aceptado",
    });

    await user.click(screen.getByRole("button", { name: /SUNAT/ }));

    expect(await screen.findByText("Filtro aplicado en la tabla.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Quitar filtro/ }));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("explains when SUNAT is not available", async () => {
    const user = userEvent.setup();
    renderFlow({ sunatEnabled: false });

    await user.click(screen.getByRole("button", { name: /SUNAT/ }));

    expect(
      await screen.findByText(
        "La validación SUNAT no está configurada en esta instancia.",
      ),
    ).toBeTruthy();
  });
});
