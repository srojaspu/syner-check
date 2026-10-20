import { describe, expect, it } from "vitest";

describe("xlsx mini build", () => {
  it("exposes the utils and writer used by exportExcel", async () => {
    // Same specifier and access pattern as exportExcel: guards CJS/UMD interop.
    const XLSX = await import("xlsx/dist/xlsx.mini.min.js");
    expect(typeof XLSX.utils?.json_to_sheet).toBe("function");
    expect(typeof XLSX.utils?.book_new).toBe("function");
    expect(typeof XLSX.utils?.book_append_sheet).toBe("function");
    expect(typeof XLSX.writeFile).toBe("function");
  });
});
