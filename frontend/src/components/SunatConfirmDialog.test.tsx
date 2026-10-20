// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Voucher } from "../api/types";
import {
  SunatConfirmDialog,
  sunatSelectionCounts,
} from "./SunatConfirmDialog";

afterEach(cleanup);

function voucher(estado: string): Voucher {
  return {
    oid: estado,
    tipo: "BOLETA",
    number: "BS05-00000105",
    date: "2026-10-18",
    crossTotal: 100,
    in_sql: true,
    sunat: { estado },
  };
}

describe("SunatConfirmDialog", () => {
  it("defaults to non-accepted documents and reports the filtered count", () => {
    const rows = [voucher("ACEPTADO"), voucher("NO_EXISTE")];
    const onConfirm = vi.fn();

    render(
      <SunatConfirmDialog
        open
        onOpenChange={() => {}}
        rows={rows}
        onConfirm={onConfirm}
      />,
    );

    expect(sunatSelectionCounts(rows)).toEqual({
      total: 2,
      accepted: 1,
      pending: 1,
      unconfirmed: 0,
      all: 2,
    });
    const recommended = screen.getByRole("radio", {
      name: /Solo no aceptados/,
    }) as HTMLInputElement;
    expect(recommended.checked).toBe(true);
    expect(screen.getByText(/Se omite 1 aceptado\./)).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Consultar 1 documento" }),
    );
    expect(onConfirm).toHaveBeenCalledWith("no_aceptados");
  });

  it("forces all documents when the user selects Todos", () => {
    const rows = [voucher("ACEPTADO"), voucher("NO_EXISTE")];
    const onConfirm = vi.fn();

    render(
      <SunatConfirmDialog
        open
        onOpenChange={() => {}}
        rows={rows}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /^Todos/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Consultar 2 documentos" }),
    );
    expect(onConfirm).toHaveBeenCalledWith("todos");
  });

  it("never counts unconfirmed submissions as consultable", () => {
    const rows = [voucher("ACEPTADO"), voucher("SIN_CONFIRMAR")];
    expect(sunatSelectionCounts(rows)).toEqual({
      total: 2,
      accepted: 1,
      pending: 0,
      unconfirmed: 1,
      all: 1,
    });
  });

  it("hides zero-count omissions in the default description", () => {
    const rows = [
      voucher("ACEPTADO"),
      voucher("ACEPTADO"),
      voucher("ACEPTADO"),
      voucher("NO_EXISTE"),
    ];

    render(
      <SunatConfirmDialog
        open
        onOpenChange={() => {}}
        rows={rows}
        onConfirm={() => {}}
      />,
    );

    expect(screen.getByText(/Se omiten 3 aceptados\./)).toBeTruthy();
    expect(screen.queryByText(/0 sin confirmar/)).toBeNull();
  });

  it("reports only unconfirmed omissions when there are no accepted rows", () => {
    const rows = [
      voucher("SIN_CONFIRMAR"),
      voucher("SIN_CONFIRMAR"),
      voucher("NO_EXISTE"),
    ];

    render(
      <SunatConfirmDialog
        open
        onOpenChange={() => {}}
        rows={rows}
        onConfirm={() => {}}
      />,
    );

    expect(
      screen.getByText(
        /1 documento para consultar\. Se omiten 2 sin confirmar\./,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/0 aceptados/)).toBeNull();
  });

  it("does not mention zero accepted rows in the Todos description", () => {
    render(
      <SunatConfirmDialog
        open
        onOpenChange={() => {}}
        rows={[voucher("NO_EXISTE")]}
        onConfirm={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /^Todos/ }));

    expect(
      screen.getByText(/1 documento con consulta nueva\./),
    ).toBeTruthy();
    expect(screen.queryByText(/Incluye 0/)).toBeNull();
  });
});
