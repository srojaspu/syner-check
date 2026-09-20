// @vitest-environment jsdom
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
} from "@tanstack/react-table";
import { describe, expect, it } from "vitest";

const DATA = Array.from({ length: 49 }, (_, i) => ({ n: i }));

function Minimal() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const table = useReactTable({
    data: DATA,
    columns: [{ accessorKey: "n", header: "N" }],
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  return (
    <div>
      <button onClick={() => table.nextPage()}>Next</button>
      <span data-testid="first">
        {table.getRowModel().rows[0].original.n as number}
      </span>
    </div>
  );
}

describe("minimal table", () => {
  it("advances page", async () => {
    const user = userEvent.setup();
    render(<Minimal />);
    expect(screen.getByTestId("first").textContent).toBe("0");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("first").textContent).toBe("25");
  });
});
