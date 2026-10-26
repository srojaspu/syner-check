// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IntelisisUfeRow } from "../api/types";
import {
  intelisisUfeColumns,
  type IntelisisUfeSelection,
} from "./IntelisisUfeColumns";

afterEach(cleanup);

function fila(overrides: Partial<IntelisisUfeRow> = {}): IntelisisUfeRow {
  return {
    id_venta: 7466462,
    tipo: "BO",
    tipo_documento_pu: "03",
    documento: "602-00142702",
    documento_estimado: false,
    documento_teorico: "602-00142702",
    comprobante: "B602-00142702",
    mov: "E-Boleta",
    mov_id: "602-142702",
    fecha_emision: "2026-10-21",
    sucursal: 602,
    sucursal_nombre: "Tienda Central",
    cliente: "CLIENTE DE PRUEBA",
    cliente_codigo: "1000000082",
    ruc: "20101031773",
    importe: 129.5,
    impuestos: 19.75,
    total: 149.25,
    importe_sunat: 149.25,
    estatus_erp: "CONCLUIDO",
    referencia: "",
    estado_generacion: "generado",
    generador: "OK REGISTRADO",
    incidencias: [],
    resultado: "CONFORME",
    detalle_incidencia: null,
    en_espera: false,
    exento_generador: false,
    fuera_de_bitacora: false,
    etapa: "FINALIZADO",
    intentos: 1,
    ok_registrados: 1,
    ultimo_intento: "2026-10-21T12:41:07",
    hash: "abc123",
    archivo_out: "BO-602-00142702.txt",
    procedimiento: "SPPUFE_UBL21",
    tipo_sunat: "03",
    sunat: null,
    estado_sunat: "SUNAT SIN CONSULTA",
    reenvio: null,
    ...overrides,
  };
}

type Celda = (contexto: { row: { original: IntelisisUfeRow } }) => ReactNode;

function columna(id: string, selection?: IntelisisUfeSelection) {
  const encontrada = intelisisUfeColumns(selection).find(
    (columna) => columna.id === id,
  );
  if (!encontrada) throw new Error(`No existe la columna ${id}`);
  return encontrada;
}

function renderCelda(id: string, doc: IntelisisUfeRow, selection?: IntelisisUfeSelection) {
  const celda = columna(id, selection).cell as Celda;
  return render(<>{celda({ row: { original: doc } })}</>);
}

describe("IntelisisUfeColumns · badge ERP", () => {
  it("traduce el estatus del ERP en vez de mostrar la clave cruda", () => {
    renderCelda("estatus", fila({ estatus_erp: "CONCLUIDO" }));

    expect(screen.getByText("Concluida")).toBeTruthy();
    expect(screen.queryByText("CONCLUIDO")).toBeNull();
  });

  it("explica el estatus en el title", () => {
    renderCelda("estatus", fila({ estatus_erp: "PENDIENTE" }));

    const badge = screen.getByText("Pendiente");
    expect(badge.getAttribute("title")).toBe(
      "Registrada, sin conclusión en el ERP.",
    );
  });

  it("conserva un estatus desconocido sin inventar una etiqueta", () => {
    renderCelda("estatus", fila({ estatus_erp: "EN_PROCESO" }));

    expect(screen.getByText("EN_PROCESO")).toBeTruthy();
  });
});

describe("IntelisisUfeColumns · selección para reenvío", () => {
  const selection = (): IntelisisUfeSelection => ({
    seleccionados: new Set<number>(),
    onToggle: vi.fn(),
    onTogglePagina: vi.fn(),
  });

  it("deshabilita el checkbox de un comprobante no concluido", () => {
    renderCelda(
      "seleccion",
      fila({ estatus_erp: "PENDIENTE" }),
      selection(),
    );

    const checkbox = screen.getByRole("checkbox", {
      name: "Seleccionar B602-00142702",
    });
    // Base UI expone el estado como aria-disabled, no con el atributo nativo.
    expect(checkbox.getAttribute("aria-disabled")).toBe("true");
    expect(checkbox.getAttribute("title")).toBe(
      "Solo se pueden reenviar comprobantes concluidos",
    );
  });

  it("solo el concluido se puede marcar", () => {
    const seleccion = selection();
    renderCelda("seleccion", fila({ estatus_erp: "CONCLUIDO" }), seleccion);

    const checkbox = screen.getByRole("checkbox", {
      name: "Seleccionar B602-00142702",
    });
    expect(checkbox.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(checkbox);
    expect(seleccion.onToggle).toHaveBeenCalledWith(7466462, true);
  });

  it("la cabecera marca solo los concluidos de la página", () => {
    const seleccion = selection();
    const columnaSeleccion = columna("seleccion", seleccion);
    const header = columnaSeleccion.header as (contexto: {
      table: { getRowModel: () => { rows: { original: IntelisisUfeRow }[] } };
    }) => ReactNode;
    const pendiente = fila({ id_venta: 2, estatus_erp: "PENDIENTE" });
    const concluido = fila({ id_venta: 1, estatus_erp: "CONCLUIDO" });

    render(
      <>
        {header({
          table: {
            getRowModel: () => ({
              rows: [{ original: pendiente }, { original: concluido }],
            }),
          },
        })}
      </>,
    );

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Seleccionar los documentos de esta página",
      }),
    );

    expect(seleccion.onTogglePagina).toHaveBeenCalledWith([concluido], true);
  });

  it("la cabecera se deshabilita si no hay ningún concluido", () => {
    const columnaSeleccion = columna("seleccion", selection());
    const header = columnaSeleccion.header as (contexto: {
      table: { getRowModel: () => { rows: { original: IntelisisUfeRow }[] } };
    }) => ReactNode;

    render(
      <>
        {header({
          table: {
            getRowModel: () => ({
              rows: [{ original: fila({ estatus_erp: "PENDIENTE" }) }],
            }),
          },
        })}
      </>,
    );

    expect(
      screen
        .getByRole("checkbox", {
          name: "Seleccionar los documentos de esta página",
        })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });
});
