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
    sunat: null,
    ...overrides,
  };
}

describe("DetailDrawer · acciones condicionales de SUNAT y MovSynerPos", () => {
  it("muestra Validar en SUNAT y Reenviar a MovSynerPos cuando no esta aceptado en SUNAT ni en MovSynerPos", () => {
    const doc = buildVoucher({ in_sql: false, sunat: null });
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

  it("oculta Validar en SUNAT cuando ya esta ACEPTADO y oculta Reenviar cuando ya esta en MovSynerPos", () => {
    const doc = buildVoucher({
      in_sql: true,
      sunat: { estado: "ACEPTADO", fecha_consulta: "2026-10-26T15:00:00" },
    });

    render(
      <DetailDrawer
        open={true}
        document={doc}
        loading={false}
        error={null}
        copied={false}
        onCopy={vi.fn()}
        onValidateSunat={vi.fn()}
        onSendMovSynerPos={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Validar en SUNAT/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Reenviar a MovSynerPos/ }),
    ).toBeNull();
    expect(screen.getByText("En MovSynerPos")).toBeTruthy();
    expect(screen.getByText("SUNAT: Aceptado")).toBeTruthy();
  });

  it("muestra solo Validar en SUNAT cuando ya esta en MovSynerPos pero aun no esta aceptado en SUNAT", () => {
    const doc = buildVoucher({
      in_sql: true,
      sunat: { estado: "PENDIENTE" },
    });

    render(
      <DetailDrawer
        open={true}
        document={doc}
        loading={false}
        error={null}
        copied={false}
        onCopy={vi.fn()}
        onValidateSunat={vi.fn()}
        onSendMovSynerPos={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Validar en SUNAT/ })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Reenviar a MovSynerPos/ }),
    ).toBeNull();
  });

  it("muestra Eliminar de MovSynerPos solo cuando el documento esta en MovSynerPos", () => {
    const onDeleteMovSynerPos = vi.fn();
    const doc = buildVoucher({ in_sql: true });

    const { unmount } = render(
      <DetailDrawer
        open={true}
        document={doc}
        loading={false}
        error={null}
        copied={false}
        onCopy={vi.fn()}
        onDeleteMovSynerPos={onDeleteMovSynerPos}
        onClose={vi.fn()}
      />,
    );

    const btnDelete = screen.getByRole("button", {
      name: /Eliminar de MovSynerPos/,
    });
    fireEvent.click(btnDelete);
    expect(onDeleteMovSynerPos).toHaveBeenCalledWith(doc);
    unmount();

    render(
      <DetailDrawer
        open={true}
        document={buildVoucher({ in_sql: false })}
        loading={false}
        error={null}
        copied={false}
        onCopy={vi.fn()}
        onDeleteMovSynerPos={onDeleteMovSynerPos}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Eliminar de MovSynerPos/ }),
    ).toBeNull();
  });
});
