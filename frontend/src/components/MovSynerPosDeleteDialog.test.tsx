// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Voucher } from "../api/types";
import { MovSynerPosDeleteDialog } from "./MovSynerPosDeleteDialog";

afterEach(cleanup);

const DOC: Voucher = {
  oid: "14257.639095",
  tipo: "BOLETA",
  number: "BS05-00011252",
  date: "2026-11-04",
  crossTotal: 95,
  in_sql: true,
};

function renderDialog(overrides: Partial<Parameters<typeof MovSynerPosDeleteDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  render(
    <MovSynerPosDeleteDialog
      open
      onOpenChange={() => {}}
      document={DOC}
      busy={false}
      error={null}
      blocked={false}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return onConfirm;
}

describe("MovSynerPosDeleteDialog", () => {
  it("muestra la identidad completa del comprobante", () => {
    renderDialog();
    expect(screen.getByText("BS05-00011252")).toBeTruthy();
    expect(screen.getByText("14257.639095")).toBeTruthy();
    expect(screen.getByText("BOLETA")).toBeTruthy();
  });

  it("exige un motivo de al menos 5 caracteres", () => {
    const onConfirm = renderDialog();
    const submit = screen.getByRole("button", {
      name: /Eliminar de MovSynerPos/,
    }) as HTMLButtonElement;

    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Motivo de la eliminación/), {
      target: { value: "corto" },
    });
    expect(submit.disabled).toBe(false);

    fireEvent.change(screen.getByLabelText(/Motivo de la eliminación/), {
      target: { value: "cort" },
    });
    expect(submit.disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirma con el motivo recortado y sin forzar", () => {
    const onConfirm = renderDialog();
    fireEvent.change(screen.getByLabelText(/Motivo de la eliminación/), {
      target: { value: "  duplicado en SynerCom  " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Eliminar de MovSynerPos/ }),
    );
    expect(onConfirm).toHaveBeenCalledWith("duplicado en SynerCom", false);
  });

  it("solo permite forzar despues de un 409", () => {
    const onConfirm = renderDialog({
      blocked: true,
      error: "El comprobante ya fue concluido en Intelisis.",
    });
    fireEvent.change(screen.getByLabelText(/Motivo de la eliminación/), {
      target: { value: "anulado en el ERP" },
    });

    const submit = screen.getByRole("button", {
      name: /Eliminar de MovSynerPos/,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(
      screen.getByText(/El comprobante ya fue concluido en Intelisis/),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("checkbox", { name: /Forzar aunque Intelisis/ }),
    );
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledWith("anulado en el ERP", true);
  });

  it("no permite confirmar mientras la peticion esta en curso", () => {
    renderDialog({ busy: true });
    fireEvent.change(screen.getByLabelText(/Motivo de la eliminación/), {
      target: { value: "duplicado en SynerCom" },
    });

    const submit = screen.getByRole("button", { name: /Eliminando/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("muestra el error del backend", () => {
    renderDialog({ error: "El usuario no tiene permiso DELETE." });
    expect(
      screen.getByText("El usuario no tiene permiso DELETE."),
    ).toBeTruthy();
  });

  it("solo se cierra desde Cancelar o el botón de cierre, no con Escape ni clic fuera", () => {
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });

    fireEvent.keyDown(document.body, { key: "Escape" });
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    if (overlay) {
      fireEvent.pointerDown(overlay);
      fireEvent.click(overlay);
    }
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
