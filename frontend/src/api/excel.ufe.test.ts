import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IntelisisUfeRow } from "./types";

const mocks = vi.hoisted(() => ({
  json_to_sheet: vi.fn((_rows: Record<string, unknown>[]) => ({}) as Record<string, unknown>),
  sheet_add_aoa: vi.fn(),
  book_new: vi.fn(() => ({})),
  book_append_sheet: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("xlsx/dist/xlsx.mini.min.js", () => ({
  utils: {
    json_to_sheet: mocks.json_to_sheet,
    sheet_add_aoa: mocks.sheet_add_aoa,
    book_new: mocks.book_new,
    book_append_sheet: mocks.book_append_sheet,
  },
  writeFile: mocks.writeFile,
}));

import { exportIntelisisUfeExcel } from "./excel";

function fila(overrides: Partial<IntelisisUfeRow> = {}): IntelisisUfeRow {
  return {
    id_venta: 7466462,
    tipo: "BO",
    documento: "602-00142702",
    documento_estimado: false,
    comprobante: "B602-00142702",
    fecha_emision: "2026-10-21",
    sucursal: 602,
    sucursal_nombre: "Tienda Central",
    cliente: "CLIENTE DE PRUEBA",
    total: 149.25,
    estatus_erp: "CONCLUIDO",
    generador: "OK REGISTRADO",
    estado_generacion: "generado",
    intentos: 1,
    ultimo_intento: "2026-10-21T12:41:07",
    estado_sunat: "SUNAT SIN CONSULTA",
    sunat: null,
    resultado: "CONFORME",
    incidencias: [],
    detalle_incidencia: null,
    referencia: "",
    ...overrides,
  } as IntelisisUfeRow;
}

/** La fila exportada (el primer argumento de json_to_sheet). */
function exportadas(): Record<string, unknown>[] {
  return mocks.json_to_sheet.mock.calls[0][0] as Record<string, unknown>[];
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockClear();
});

describe("exportIntelisisUfeExcel", () => {
  it("traduce el estatus del ERP y marca si el registro es un documento", async () => {
    await exportIntelisisUfeExcel([fila()]);

    const [row] = exportadas();
    expect(row["Estatus ERP"]).toBe("CONCLUIDO");
    expect(row["Estatus ERP (texto)"]).toBe("Concluida");
    expect(row["¿Es documento?"]).toBe("Sí");
    // Las columnas que ya existían no se pierden.
    expect(row.Comprobante).toBe("B602-00142702");
    expect(row["ID ERP"]).toBe(7466462);
  });

  it("no inventa una etiqueta para un estatus desconocido", async () => {
    await exportIntelisisUfeExcel([fila({ estatus_erp: "EN_PROCESO" })]);

    expect(exportadas()[0]["Estatus ERP (texto)"]).toBe("EN_PROCESO");
  });

  it("distingue una venta sin documento emitido", async () => {
    await exportIntelisisUfeExcel([
      fila({ comprobante: "", documento: "", estatus_erp: "SINAFECTAR" }),
    ]);

    const [row] = exportadas();
    expect(row["¿Es documento?"]).toBe("No");
    expect(row["Estatus ERP (texto)"]).toBe("Sin afectar");
  });

  it("deja constancia cuando el listado vino recortado", async () => {
    await exportIntelisisUfeExcel([fila()], {
      truncado: true,
      filtradosTotal: 25_000,
    });

    expect(mocks.sheet_add_aoa).toHaveBeenCalledWith(
      expect.anything(),
      [["LISTADO RECORTADO: 1 de 25000 documentos que pasan el filtro"]],
    );
  });
});
