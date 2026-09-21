// @vitest-environment jsdom
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { toISODate } from "../api/format";
import { RangePanel } from "./SearchPanels";
import { Tabs } from "./AppShell";

afterEach(cleanup);

describe("RangePanel", () => {
  it("opens the calendar popover without ref warnings", async () => {
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args);
    });
    try {
      const user = userEvent.setup();
      render(<RangePanel disabled={false} onSearch={() => {}} />);
      await user.click(
        screen.getByRole("button", { name: "Elegir rango de fechas" }),
      );
      // Popover content renders in a portal on document.body, outside the
      // render container, so query the whole document.
      const popover = document.querySelector(
        '[data-slot="popover-content"] [role="gridcell"]',
      );
      expect(popover).not.toBeNull();
      const refWarnings = errors.filter((args) =>
        args.some(
          (arg) =>
            typeof arg === "string" &&
            arg.includes("Function components cannot be given refs"),
        ),
      );
      expect(refWarnings).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("submits today-to-today with all types by default", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<RangePanel disabled={false} onSearch={onSearch} />);
    await user.click(screen.getByRole("button", { name: "Consultar" }));
    const today = toISODate(new Date());
    expect(onSearch).toHaveBeenCalledWith(
      today,
      today,
      "FACTURA,BOLETA,NOTA DE CREDITO",
    );
  });

  it("shows an inline error when no document type is selected", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<RangePanel disabled={false} onSearch={onSearch} />);
    for (const label of ["Factura", "Boleta", "Nota de crédito"]) {
      await user.click(screen.getByRole("checkbox", { name: label }));
    }
    await user.click(screen.getByRole("button", { name: "Consultar" }));
    expect(
      screen.getByText("Selecciona al menos un tipo de documento."),
    ).toBeTruthy();
    expect(onSearch).not.toHaveBeenCalled();
  });
});

describe("mode Tabs", () => {
  function Harness() {
    const [mode, setMode] = useState<"range" | "number">("range");
    return (
      <div>
        <Tabs mode={mode} onChange={setMode} />
        <span data-testid="mode">{mode}</span>
      </div>
    );
  }

  it("switches search mode on click", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByTestId("mode").textContent).toBe("range");
    await user.click(
      within(screen.getByRole("tablist")).getByRole("tab", {
        name: "Número de comprobante",
      }),
    );
    expect(screen.getByTestId("mode").textContent).toBe("number");
  });
});
