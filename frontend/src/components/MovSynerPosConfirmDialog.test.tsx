// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Voucher } from "../api/types";
import {
  MovSynerPosConfirmDialog,
  movSynerPosSelectionCounts,
} from "./MovSynerPosConfirmDialog";

afterEach(cleanup);

function voucher(oid: string, inSql: boolean): Voucher {
  return {
    oid,
    tipo: "BOLETA",
    number: `B004-${oid}`,
    date: "2026-10-20",
    crossTotal: 100,
    in_sql: inSql,
  };
}

describe("MovSynerPosConfirmDialog", () => {
  it("counts missing and existing documents", () => {
    const rows = [
      voucher("1", false),
      voucher("2", true),
      voucher("3", true),
    ];
    expect(movSynerPosSelectionCounts(rows)).toEqual({
      total: 3,
      missing: 1,
      existing: 2,
    });
  });

  it("sends only the missing documents by default", () => {
    const onConfirm = vi.fn();
    render(
      <MovSynerPosConfirmDialog
        open
        onOpenChange={() => {}}
        rows={[voucher("1", false), voucher("2", true)]}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Enviar 1 documento" }),
    );
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it("repairs existing documents when the checkbox is checked", () => {
    const onConfirm = vi.fn();
    render(
      <MovSynerPosConfirmDialog
        open
        onOpenChange={() => {}}
        rows={[voucher("1", false), voucher("2", true)]}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: /Reintentar existentes/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Enviar 2 documentos" }),
    );
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it("cannot repair when every document is already missing", () => {
    render(
      <MovSynerPosConfirmDialog
        open
        onOpenChange={() => {}}
        rows={[voucher("1", false)]}
        onConfirm={() => {}}
      />,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: /Reintentar existentes/,
    });
    fireEvent.click(checkbox);
    // Clicking a disabled checkbox must not turn the confirm into 2 docs.
    expect(
      screen.getByRole("button", { name: "Enviar 1 documento" }),
    ).toBeTruthy();
  });

  it("does nothing when every document already exists", () => {
    const onConfirm = vi.fn();
    render(
      <MovSynerPosConfirmDialog
        open
        onOpenChange={() => {}}
        rows={[voucher("1", true)]}
        onConfirm={onConfirm}
      />,
    );

    const button = screen.getByRole("button", { name: "Nada para enviar" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onOpenChange = vi.fn();
    render(
      <MovSynerPosConfirmDialog
        open
        onOpenChange={onOpenChange}
        rows={[voucher("1", false)]}
        onConfirm={() => {}}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange.mock.calls[0][0]).toBe(false);
  });
});
