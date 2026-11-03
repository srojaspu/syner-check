// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailDrawer } from "./DetailDrawer";
import type { Voucher } from "../api/types";

afterEach(cleanup);

function buildVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    oid: "oid-101",
    number: "B602-00012345",
    date: "2026-10-26",
    createdDate: "2026-10-26T14:20:00",
    tipo: "BOLETA",
    contactName: "Cliente Demo",
    crossTotal: 150.5,
    netTotal: 127.54,
    in_sql: false,
    sunat: { estado: "ACEPTADO", fecha_consulta: "2026-10-26T15:00:00" },
    ...overrides,
  };
}

describe("DetailDrawer · acciones de SUNAT y MovSynerPos", () => {
  it("renderiza los botones Validar en SUNAT y Reenviar a MovSynerPos junto a Imprimir", () => {
    const doc = buildVoucher();
    const onValidateSunat = vi.fn();
    const onSendMovSynerPos = vi.fn();

    render(
      <DetailDrawer
        open={true}
        document={doc}
        loading={false}
        error={null}
        copied={false}
        onCopy={vi.fn()}
        onValidateSunat={onValidateSunat}
        onSendMovSynerPos={onSendMovSynerPos}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Imprimir/ })).toBeTruthy();
    const btnSunat = screen.getByRole("button", { name: /Validar en SUNAT/ });
    const btnMov = screen.getByRole("button", {
      name: /Reenviar a MovSynerPos/,
    });

    fireEvent.click(btnSunat);
    expect(onValidateSunat).toHaveBeenCalledWith(doc);

    fireEvent.click(btnMov);
    expect(onSendMovSynerPos).toHaveBeenCalledWith(doc);
  });

  it("muestra los badges de estado de MovSynerPos y SUNAT y el aviso de acción", () => {
    const doc = buildVoucher({
      in_sql: true,
      sunat: { estado: "ACEPTADO" },
    });

    render(
      <DetailDrawer
        open={true}
        document={doc}
        loading={false}
        error={null}
        copied={false}
        actionNotice="Validación completada (ACEPTADO)."
        onCopy={vi.fn()}
        onValidateSunat={vi.fn()}
        onSendMovSynerPos={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("En MovSynerPos")).toBeTruthy();
    expect(screen.getByText("SUNAT: Aceptado")).toBeTruthy();
    expect(
      screen.getByText("Validación completada (ACEPTADO)."),
    ).toBeTruthy();
  });
});
