// @vitest-environment jsdom
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { toISODate } from "../api/format";
import { RangePanel, NumberPanel } from "./SearchPanels";
import { Tabs } from "./Tabs";

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

  it("shows a notification error when no document type is selected", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    const { container } = render(
      <RangePanel disabled={false} onSearch={onSearch} />,
    );
    for (const label of ["Factura", "Boleta", "Nota de crédito"]) {
      await user.click(screen.getByRole("checkbox", { name: label }));
    }
    await user.click(screen.getByRole("button", { name: "Consultar" }));
    const tray = screen.getByRole("region", { name: "Notificaciones" });
    expect(within(tray).getByText("Revisa los filtros")).toBeTruthy();
    expect(
      within(tray).getByText("Selecciona al menos un tipo de documento."),
    ).toBeTruthy();
    expect(container.querySelector('[data-slot="alert"]')).toBeNull();
    expect(onSearch).not.toHaveBeenCalled();
  });
});

describe("NumberPanel", () => {
  it("indica que esta buscando y bloquea el boton", () => {
    render(<NumberPanel loading onSearch={() => {}} />);

    expect(
      screen.getByText("Buscando el comprobante en Intelisis…"),
    ).toBeTruthy();
    const boton = screen.getByRole("button", { name: /Buscando/ });
    expect((boton as HTMLButtonElement).disabled).toBe(true);
    expect(boton.getAttribute("aria-busy")).toBe("true");
  });

  it("muestra el error en el sistema de notificaciones cuando falta el numero y no lo incrusta en el cuerpo", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    const { container } = render(<NumberPanel onSearch={onSearch} />);

    await user.click(screen.getByRole("button", { name: "Buscar" }));

    const tray = screen.getByRole("region", { name: "Notificaciones" });
    expect(within(tray).getByText("Revisa los filtros")).toBeTruthy();
    expect(within(tray).getByText("Ingresa un número.")).toBeTruthy();
    expect(container.querySelector('[data-slot="alert"]')).toBeNull();
    expect(onSearch).not.toHaveBeenCalled();

    // Escribir limpia la notificación de filtro inválido
    await user.type(screen.getByLabelText("Número"), "F001-1");
    expect(screen.queryByText("Ingresa un número.")).toBeNull();
  });

  it("sin carga el boton dice Buscar y envia el numero", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<NumberPanel onSearch={onSearch} />);

    await user.type(
      screen.getByLabelText("Número"),
      "B710-00004539",
    );
    await user.click(screen.getByRole("button", { name: "Buscar" }));

    expect(onSearch).toHaveBeenCalledWith("B710-00004539");
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

