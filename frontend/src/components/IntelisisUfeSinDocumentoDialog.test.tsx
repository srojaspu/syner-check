// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntelisisUfeSinDocumentoRow } from "../api/types";
import { IntelisisUfeSinDocumentoDialog } from "./IntelisisUfeSinDocumentoDialog";

afterEach(cleanup);

function fila(
  overrides: Partial<IntelisisUfeSinDocumentoRow> = {},
): IntelisisUfeSinDocumentoRow {
  return {
    id_venta: 900,
    mov: "E-Boleta",
    mov_id: null,
    documento: null,
    documento_invalido: null,
    situacion: "sin_documento",
    fecha_emision: "2026-10-20",
    sucursal: 175,
    sucursal_nombre: "Tienda Norte",
    cliente: "CLIENTE UNO",
    total: 118,
    ...overrides,
  };
}

function view(
  overrides: Partial<Parameters<typeof IntelisisUfeSinDocumentoDialog>[0]> = {},
) {
  const onOpenChange = vi.fn();
  const onReintentar = vi.fn();
  render(
    <IntelisisUfeSinDocumentoDialog
      open
      onOpenChange={onOpenChange}
      desde="2026-09-25"
      hasta="2026-10-25"
      rows={[]}
      loading={false}
      error={null}
      truncado={false}
      maxFilas={1000}
      onReintentar={onReintentar}
      {...overrides}
    />,
  );
  return { onOpenChange, onReintentar };
}

/** La fila de la tabla, identificada por su ID de ERP. */
function filaDe(idVenta: number): HTMLElement {
  return screen.getByText(String(idVenta)).closest("tr") as HTMLElement;
}

describe("IntelisisUfeSinDocumentoDialog", () => {
  it("declara que son ventas que no se pueden validar ni reenviar", () => {
    view();

    expect(
      screen.getByRole("heading", { name: "Ventas sin documentar" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /no tienen comprobante electrónico emitido\. No se pueden validar en SUNAT ni reenviar\./,
      ),
    ).toBeTruthy();
    expect(screen.getByText("25/09/2026 — 25/10/2026")).toBeTruthy();
  });

  it("muestra el skeleton mientras carga", () => {
    view({ loading: true });

    expect(
      screen.getByLabelText("Cargando ventas sin documentar"),
    ).toBeTruthy();
    expect(screen.getByText("Consultando…")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("ante un error ofrece reintentar", () => {
    const { onReintentar } = view({
      error: "No fue posible consultar las ventas sin documentar.",
    });

    expect(
      screen.getByText("No fue posible consultar las ventas sin documentar."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onReintentar).toHaveBeenCalledTimes(1);
  });

  it("sin ventas lo dice sin dejar la tabla vacía", () => {
    view();

    expect(screen.getByText("No hay ventas sin documentar")).toBeTruthy();
    expect(screen.getByText("0 ventas · no incluye canceladas")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("separa 'Sin documento' de 'Documento inválido'", () => {
    view({
      rows: [
        fila(),
        fila({
          id_venta: 901,
          situacion: "documento_invalido",
          documento_invalido: "175-00000000",
        }),
      ],
    });

    const sinDocumento = filaDe(900);
    expect(within(sinDocumento).getByText("Sin documento")).toBeTruthy();
    expect(
      within(sinDocumento).queryByText(/Documento inválido/),
    ).toBeNull();

    const invalido = filaDe(901);
    expect(
      within(invalido).getByText("Documento inválido · 175-00000000"),
    ).toBeTruthy();
  });

  it("no inventa folio ni comprobante: muestra —", () => {
    view({ rows: [fila({ mov_id: null, documento_invalido: null })] });

    const row = filaDe(900);
    expect(within(row).getByText("—")).toBeTruthy();
    expect(within(row).queryByText(/00000000/)).toBeNull();
  });

  it("muestra el total real, incluido S/ 0.00", () => {
    view({
      rows: [
        fila({ total: 118 }),
        fila({ id_venta: 901, total: 0 }),
      ],
    });

    const row = filaDe(900);
    // formatMoney usa un espacio duro: se compara el contenido, no el nodo.
    expect(row.textContent).toContain("118.00");
    expect(within(row).getByText("20/10/2026")).toBeTruthy();
    expect(within(row).getByText("Tienda Norte")).toBeTruthy();
    expect(filaDe(901).textContent).toContain("0.00");
  });

  it("resume el total y avisa cuando el servidor recortó la lista", () => {
    view({
      rows: [fila(), fila({ id_venta: 901 })],
      truncado: true,
      maxFilas: 1000,
    });

    expect(screen.getByText("2 ventas · no incluye canceladas")).toBeTruthy();
    expect(
      screen.getByText(/Se muestran las primeras 1[.,]000 ventas\./),
    ).toBeTruthy();
  });

  it("singulariza una sola venta", () => {
    view({ rows: [fila()] });

    expect(screen.getByText("1 venta · no incluye canceladas")).toBeTruthy();
  });
});
