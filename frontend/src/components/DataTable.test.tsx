// @vitest-environment jsdom
import { useState } from "react";
import { act, render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Voucher } from "../api/types";
import { voucherColumns } from "./columns";
import { DataTable } from "./DataTable";

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1024,
  });
});

function setViewport(width: number, notify = true) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  if (notify) {
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
  }
}

function makeRows(count: number): Voucher[] {
  return Array.from({ length: count }, (_, index) => ({
    oid: `OID-${index}`,
    number: `F001-${String(index).padStart(5, "0")}`,
    date: "2026-09-20",
    tipo: index % 2 === 0 ? "FACTURA" : ("BOLETA" as const),
    crossTotal: index,
    in_sql: index % 3 === 0,
  }));
}

function Harness({ rows }: { rows: Voucher[] }) {
  return (
    <DataTable.Root data={rows} columns={voucherColumns()} onRowClick={() => {}}>
      <DataTable.Toolbar />
      <DataTable.View<Voucher> />
      <DataTable.Pagination />
    </DataTable.Root>
  );
}

/**
 * Regression: the parent stores `onFilteredRowsChange` in state. Before the
 * fix, Root mapped a fresh array on every render, so the effect re-fired and
 * the parent re-rendered forever (this test never finished).
 */
function FilterTrackingHarness({ rows }: { rows: Voucher[] }) {
  const [filtered, setFiltered] = useState<Voucher[] | null>(null);
  return (
    <>
      <span data-testid="filtered-count">{filtered?.length ?? -1}</span>
      <DataTable.Root
        data={rows}
        columns={voucherColumns()}
        onFilteredRowsChange={setFiltered}
      >
        <DataTable.View<Voucher> />
      </DataTable.Root>
    </>
  );
}

describe("DataTable interactions", () => {
  it("reports filtered rows once, without a render loop", async () => {
    render(<FilterTrackingHarness rows={makeRows(5)} />);
    await waitFor(() =>
      expect(screen.getByTestId("filtered-count").textContent).toBe("5"),
    );
  });

  it("advances to the next page", async () => {
    const user = userEvent.setup();
    render(<Harness rows={makeRows(49)} />);
    expect(screen.queryByText("F001-00025")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByText("F001-00025")).toBeTruthy();
  });

  it("filters per column", async () => {
    const user = userEvent.setup();
    render(<Harness rows={makeRows(49)} />);
    await user.type(
      screen.getByLabelText("Filtrar por documento"),
      "00030",
    );
    expect(screen.getByText("F001-00030")).toBeTruthy();
    expect(screen.queryByText("F001-00000")).toBeNull();
  });

  it("opens a row with the keyboard", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <DataTable.Root
        data={makeRows(3)}
        columns={voucherColumns()}
        onRowClick={onRowClick}
      >
        <DataTable.View<Voucher> />
      </DataTable.Root>,
    );

    const row = screen.getByRole("row", {
      name: "Ver detalle del comprobante F001-00000",
    });
    row.focus();

    await user.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledWith(
      expect.objectContaining({ number: "F001-00000" }),
    );

    onRowClick.mockClear();
    await user.keyboard(" ");
    expect(onRowClick).toHaveBeenCalledWith(
      expect.objectContaining({ number: "F001-00000" }),
    );
  });

  it("shows only the mandatory columns on mobile", () => {
    setViewport(390, false);
    render(<Harness rows={makeRows(3)} />);

    expect(screen.getByText("Documento")).toBeTruthy();
    expect(screen.getByText("Flujo")).toBeTruthy();
    expect(screen.getByText("SUNAT")).toBeTruthy();

    expect(screen.queryByText("Fecha / hora")).toBeNull();
    expect(screen.queryByText("Tipo")).toBeNull();
    expect(screen.queryByText("Total")).toBeNull();
    expect(screen.queryByText("Cliente")).toBeNull();
    expect(screen.queryByText("OID")).toBeNull();
  });

  it("reveals columns progressively as the viewport grows", () => {
    setViewport(390, false);
    render(<Harness rows={makeRows(3)} />);

    setViewport(640);
    expect(screen.queryByText("Fecha / hora")).toBeNull();
    expect(screen.queryByText("Total")).toBeNull();

    setViewport(768);
    expect(screen.getByText("Fecha / hora")).toBeTruthy();
    expect(screen.queryByText("Total")).toBeNull();
    expect(screen.queryByText("Tipo")).toBeNull();

    setViewport(1024);
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getByText("Tipo")).toBeTruthy();
    expect(screen.queryByText("Cliente")).toBeNull();

    setViewport(1280);
    expect(screen.getByText("Cliente")).toBeTruthy();
    expect(screen.queryByText("OID")).toBeNull();

    setViewport(1536);
    expect(screen.getByText("OID")).toBeTruthy();
  });

  it("lets Cliente absorb the remaining width while other columns size to content", () => {
    setViewport(1280, false);
    const longName =
      "EMPRESA DE TELECOMUNICACIONES MULTIMEDIA ALFA SOCIEDAD ANONIMA CERRADA";
    const [row] = makeRows(1);
    render(<Harness rows={[{ ...row, contactName: longName }]} />);

    const name = screen.getByTitle(longName);
    expect(name.textContent).toBe(longName);
    expect(name.className).toContain("w-full");
    expect(name.className).toContain("[contain:inline-size]");
    expect(name.className).toContain("truncate");

    const clienteHeader = screen.getByText("Cliente").closest("th");
    const tipoHeader = screen.getByText("Tipo").closest("th");
    expect(clienteHeader?.className).toContain("w-full");
    expect(tipoHeader?.className).toContain("w-[1%]");
  });

  it("clears filters for columns hidden by a smaller viewport", async () => {
    const user = userEvent.setup();
    setViewport(1024, false);
    render(<FilterTrackingHarness rows={makeRows(5)} />);

    await waitFor(() =>
      expect(screen.getByTestId("filtered-count").textContent).toBe("5"),
    );

    await user.click(
      screen.getByRole("combobox", { name: "Filtrar por tipo" }),
    );
    await user.click(screen.getByRole("option", { name: "Factura" }));
    await waitFor(() =>
      expect(screen.getByTestId("filtered-count").textContent).toBe("3"),
    );

    setViewport(390);
    await waitFor(() =>
      expect(screen.getByTestId("filtered-count").textContent).toBe("5"),
    );
  });

  it("sorts by column header", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness rows={makeRows(49)} />);
    const totalHeader = screen.getByText("Total");
    // "Total" is numeric, and TanStack sorts numeric columns descending first.
    await user.click(totalHeader);
    const firstCell = () =>
      container.querySelector("tbody tr td .docnum")?.textContent;
    expect(firstCell()).toBe("F001-00048");
    await user.click(totalHeader);
    expect(firstCell()).toBe("F001-00000");
  });

  it("changes page size", async () => {
    const user = userEvent.setup();
    render(<Harness rows={makeRows(49)} />);
    await user.click(screen.getByRole("combobox", { name: /filas/i }));
    await user.click(screen.getByRole("option", { name: "50" }));
    expect(screen.getByText("F001-00048")).toBeTruthy();
  });
});
