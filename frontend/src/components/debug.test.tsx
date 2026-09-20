// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DataTable } from "./DataTable";
import { voucherColumns } from "./columns";
import type { Voucher } from "../api/types";

function makeRows(count: number): Voucher[] {
  return Array.from({ length: count }, (_, index) => ({
    oid: `OID-${index}`,
    number: `F001-${String(index).padStart(5, "0")}`,
    date: "2026-09-20",
    tipo: "FACTURA" as const,
    crossTotal: index,
    in_sql: true,
  }));
}

describe("debug pagination", () => {
  it("advances page", async () => {
    const user = userEvent.setup();
    const columns = voucherColumns();
    const rows = makeRows(49);
    const { container } = render(
      <DataTable.Root data={rows} columns={columns} onRowClick={() => {}}>
        <DataTable.Toolbar />
        <DataTable.View<Voucher> />
        <DataTable.Pagination />
      </DataTable.Root>,
    );
    const firstRow = () =>
      container.querySelector("tbody tr td .docnum")?.textContent;
    const next = screen.getByRole("button", { name: "Siguiente" });
    expect((next as HTMLButtonElement).disabled).toBe(false);
    expect(firstRow()).toBe("F001-00000");
    await user.click(next);
    expect(firstRow()).toBe("F001-00025");
  });
});
