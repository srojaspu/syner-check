// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);
import type { Voucher } from "../api/types";
import { voucherColumns } from "./columns";
import { DataTable } from "./DataTable";

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

describe("DataTable interactions", () => {
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
