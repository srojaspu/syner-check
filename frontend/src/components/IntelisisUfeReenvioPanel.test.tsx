// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntelisisUfeReenvioPanel } from "./IntelisisUfeReenvioPanel";
import type {
  IntelisisReenvioCola,
  IntelisisReenvioFila,
} from "../api/types";

afterEach(cleanup);

function fila(
  overrides: Partial<IntelisisReenvioFila> = {},
): IntelisisReenvioFila {
  return {
    ID: 249,
    IDVenta: 7473657,
    Tipo: "03",
    Procedimiento: "SPPUFE_UBL21",
    Usuario: "dev@perfumeriasunidas.com.pe",
    Motivo: "",
    Estado: "FINALIZADO_REVISAR",
    Creado: "2026-10-26T17:49:45.320",
    Inicio: "2026-10-26T17:50:00",
    Fin: "2026-10-26T17:50:33.640",
    SPID: null,
    LogDesde: null,
    LogHasta: null,
    Retorno: null,
    Detalle: null,
    RevisadoPor: null,
    Revision: null,
    LoteID: null,
    ...overrides,
  };
}

function panel(historial: IntelisisReenvioFila[]): IntelisisReenvioCola {
  return {
    ocupado: false,
    worker: null,
    pendientes: 0,
    sin_confirmar: 0,
    activos: [],
    historial,
    resumen: {},
    total: historial.length,
    habilitado: true,
  };
}

function ver(historial: IntelisisReenvioFila[]) {
  render(
    <IntelisisUfeReenvioPanel
      panel={panel(historial)}
      loading={false}
      error={null}
      resolviendo={null}
      onRecargar={vi.fn()}
      onResolver={vi.fn()}
    />,
  );
}

function filtroHistorial(): HTMLElement {
  // Dos tablas (En curso e Historial) comparten cabecera: el historial es la
  // ultima fila de filtros del documento.
  const filtros = screen.getAllByLabelText("Filtrar por venta");
  return filtros[filtros.length - 1] as HTMLElement;
}

describe("IntelisisUfeReenvioPanel · filtro por venta", () => {
  it("encuentra la venta buscada por su id completo", () => {
    ver([fila(), fila({ ID: 248, IDVenta: 7473656 })]);

    fireEvent.change(filtroHistorial(), { target: { value: "7473657" } });

    expect(screen.getByText("7473657")).toBeTruthy();
    expect(screen.queryByText("7473656")).toBeNull();
  });

  it("encuentra la venta por una parte del id", () => {
    ver([fila(), fila({ ID: 248, IDVenta: 7473656 })]);

    fireEvent.change(filtroHistorial(), { target: { value: "73657" } });

    expect(screen.getByText("7473657")).toBeTruthy();
    expect(screen.queryByText("7473656")).toBeNull();
  });
});
