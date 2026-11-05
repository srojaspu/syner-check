// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MovSynerPosConflicto } from "../hooks/useMovSynerPos";
import { MovSynerPosConflictDialog } from "./MovSynerPosConflictDialog";

afterEach(cleanup);

const CONFLICTS: MovSynerPosConflicto[] = [
  {
    documento: { tipo: "BOLETA", oid: "14257.639095", number: "B004-1" },
    existentes: [
      {
        oid: "14257.000042",
        number: "BS99-00000001",
        lineas: 2,
        total: "130.50",
        fecha: "2026-10-20",
      },
    ],
  },
];

function renderDialog(
  overrides: Partial<Parameters<typeof MovSynerPosConflictDialog>[0]> = {},
) {
  const onConfirm = vi.fn();
  render(
    <MovSynerPosConflictDialog
      open
      onOpenChange={() => {}}
      conflicts={CONFLICTS}
      busy={false}
      error={null}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return onConfirm;
}

describe("MovSynerPosConflictDialog", () => {
  it("muestra el número y el oid del documento actual y del registro existente", () => {
    renderDialog();

    expect(screen.getByText("B004-1")).toBeTruthy();
    expect(screen.getByText(/oid 14257\.639095/)).toBeTruthy();
    // El registro que se eliminaría se identifica con su propia serie y oid.
    expect(screen.getByText("BS99-00000001")).toBeTruthy();
    expect(screen.getByText(/oid 14257\.000042/)).toBeTruthy();
    expect(screen.getByText(/2 líneas/)).toBeTruthy();
    expect(screen.getByText(/Total registrado: 130\.50/)).toBeTruthy();
  });

  it("exige un motivo de al menos 5 caracteres", () => {
    const onConfirm = renderDialog();
    const submit = screen.getByRole("button", {
      name: /Eliminar existente y reenviar/,
    }) as HTMLButtonElement;

    // El motivo por defecto ya es válido, así que se puede confirmar.
    expect(submit.disabled).toBe(false);

    fireEvent.change(screen.getByLabelText(/Motivo de la eliminación/), {
      target: { value: "cort" },
    });
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Motivo de la eliminación/), {
      target: { value: "anulado en SynerCom" },
    });
    expect(submit.disabled).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirma con el motivo recortado", () => {
    const onConfirm = renderDialog();
    fireEvent.change(screen.getByLabelText(/Motivo de la eliminación/), {
      target: { value: "  duplicado en SynerCom  " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Eliminar existente y reenviar/ }),
    );
    expect(onConfirm).toHaveBeenCalledWith("duplicado en SynerCom");
  });

  it("no permite confirmar mientras la resolución está en curso", () => {
    renderDialog({ busy: true });

    const submit = screen.getByRole("button", {
      name: /Resolviendo/,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("muestra el error de la resolución", () => {
    renderDialog({ error: "El usuario no tiene permiso DELETE." });
    expect(
      screen.getByText("El usuario no tiene permiso DELETE."),
    ).toBeTruthy();
  });
});
