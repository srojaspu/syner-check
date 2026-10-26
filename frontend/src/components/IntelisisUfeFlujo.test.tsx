// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntelisisUfeFlujo } from "./IntelisisUfeFlujo";
import type { IntelisisUfeKpis } from "../api/types";

function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/** Números reales del 25-10-2026 (PUnidas). */
function kpis(overrides: Partial<IntelisisUfeKpis> = {}): IntelisisUfeKpis {
  return {
    total: 417,
    total_ventas: 433,
    conformes: 417,
    con_incidencia: 0,
    sin_traza: 0,
    pendientes_conclusion: 8,
    en_espera: 0,
    no_aplica: 0,
    sin_cobertura_sunat: 417,
    sunat_consultables: 417,
    por_estatus: [
      { key: "CONCLUIDO", count: 409 },
      { key: "PENDIENTE", count: 8 },
      { key: "SINAFECTAR", count: 16 },
      { key: "CANCELADO", count: 0 },
    ],
    por_estatus_listado: [
      { key: "CONCLUIDO", count: 409 },
      { key: "PENDIENTE", count: 8 },
    ],
    por_estado_generacion: [{ key: "generado", count: 409 }],
    por_estado_sunat: [{ key: "SUNAT SIN CONSULTA", count: 417 }],
    por_generador: [],
    por_incidencia: [],
    por_sucursal: [],
    ...overrides,
  };
}

function panel(): HTMLElement {
  const nodo = document.querySelector<HTMLElement>(
    '[data-slot="popover-content"]',
  );
  if (!nodo) throw new Error("El popover no está abierto.");
  return nodo;
}

function renderFlujo(overrides: Partial<IntelisisUfeKpis> = {}) {
  const onAlternar = vi.fn();
  const onLimpiar = vi.fn();
  const onSinDocumento = vi.fn();
  render(
    <IntelisisUfeFlujo
      kpis={kpis(overrides)}
      filtros={{}}
      onAlternar={onAlternar}
      onLimpiar={onLimpiar}
      onSinDocumento={onSinDocumento}
    />,
  );
  return { onAlternar, onLimpiar, onSinDocumento };
}

beforeEach(stubMatchMedia);
afterEach(cleanup);

describe("IntelisisUfeFlujo · tarjeta ERP", () => {
  it("muestra el total del eje y no solo los concluidos", () => {
    renderFlujo();

    const tarjeta = screen.getByRole("button", {
      name: "Intelisis: ver desglose",
    });

    // 433 es el total de ventas del ERP; 417, los que tienen documento.
    expect(within(tarjeta).getByText("433")).toBeTruthy();
    expect(within(tarjeta).getByText("417 documentos electrónicos")).toBeTruthy();
    expect(within(tarjeta).getByText("Concluida")).toBeTruthy();
    expect(within(tarjeta).getByText("Pendiente")).toBeTruthy();
    expect(within(tarjeta).getByText("Sin afectar")).toBeTruthy();
    // El desglose es completo, pero un estado en 0 no ensucia la leyenda.
    expect(within(tarjeta).queryByText("Cancelada")).toBeNull();
  });

  it("explica los cuatro estados, con conteo y porcentaje", async () => {
    renderFlujo();

    fireEvent.click(
      screen.getByRole("button", { name: "Intelisis: ver desglose" }),
    );
    await screen.findByText("Intelisis · desglose");

    const contenido = panel();
    expect(within(contenido).getByText("433 ventas")).toBeTruthy();
    expect(
      within(contenido).getByText("Afectada y concluida en el ERP."),
    ).toBeTruthy();
    expect(
      within(contenido).getByText(
        "No llegó a afectarse: no tiene comprobante electrónico emitido.",
      ),
    ).toBeTruthy();
    expect(within(contenido).getByText("Cancelada")).toBeTruthy();
    // La descripción de CANCELADO ya aclara que no está en el listado.
    expect(
      within(contenido).getByText(
        "Cancelada en el ERP; no forma parte del listado.",
      ),
    ).toBeTruthy();

    // 409/433 = 94%, 8/433 = 2%, 16/433 = 4%, 0/433 = 0%.
    expect(within(contenido).getByText("94%")).toBeTruthy();
    expect(within(contenido).getByText("2%")).toBeTruthy();
    expect(within(contenido).getByText("4%")).toBeTruthy();
    expect(within(contenido).getByText("0%")).toBeTruthy();

    // El pie explica el puente entre los dos universos.
    expect(
      within(contenido).getByText(
        "417 de 433 ventas tienen comprobante electrónico",
      ),
    ).toBeTruthy();
  });

  it("CONCLUIDO filtra la tabla y cierra el popover", async () => {
    const { onAlternar } = renderFlujo();

    fireEvent.click(
      screen.getByRole("button", { name: "Intelisis: ver desglose" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /^Concluida/ }),
    );

    expect(onAlternar).toHaveBeenCalledWith("estatus", "CONCLUIDO");
    expect(screen.queryByText("Intelisis · desglose")).toBeNull();
  });

  it("SINAFECTAR abre el diálogo y no aplica un filtro", async () => {
    const { onAlternar, onSinDocumento } = renderFlujo();

    fireEvent.click(
      screen.getByRole("button", { name: "Intelisis: ver desglose" }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Ver ventas sin documentar",
      }),
    );

    expect(onSinDocumento).toHaveBeenCalledTimes(1);
    expect(onAlternar).not.toHaveBeenCalled();
    // El diálogo lo abre la página; el popover se cierra para no taparlo.
    expect(screen.queryByText("Intelisis · desglose")).toBeNull();
  });

  it("CANCELADO informa pero no es un botón de filtro", async () => {
    renderFlujo();

    fireEvent.click(
      screen.getByRole("button", { name: "Intelisis: ver desglose" }),
    );
    await screen.findByText("Intelisis · desglose");

    expect(screen.queryByRole("button", { name: /^Cancelada/ })).toBeNull();
  });

  it("marca el filtro activo y lo puede quitar", async () => {
    const onLimpiar = vi.fn();
    render(
      <IntelisisUfeFlujo
        kpis={kpis()}
        filtros={{ estatus: "CONCLUIDO" }}
        onAlternar={vi.fn()}
        onLimpiar={onLimpiar}
      />,
    );

    expect(screen.getByText("Filtro: Concluida")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Intelisis: ver desglose" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Quitar filtro" }));

    expect(onLimpiar).toHaveBeenCalledTimes(1);
  });
});

describe("IntelisisUfeFlujo · Validador y SUNAT", () => {
  it("el Validador separa sin traza de pendientes de conclusión", async () => {
    renderFlujo();

    const tarjeta = screen.getByRole("button", {
      name: "Validador: ver desglose",
    });

    // El número grande (409) se repite en la leyenda: ambos son correctos.
    expect(within(tarjeta).getAllByText("409")).toHaveLength(2);
    expect(
      within(tarjeta).getByText("409 de 417 documentos generados"),
    ).toBeTruthy();
    expect(within(tarjeta).getByText("Pendiente de conclusión")).toBeTruthy();
    // "Sin registro" es el estado técnico y no se pinta: se descompone en
    // sin traza / pendiente de conclusión / en gracia.
    expect(within(tarjeta).queryByText("Sin registro")).toBeNull();

    fireEvent.click(tarjeta);
    await screen.findByText("Validador · desglose");

    // Los derivados ya filtran: la nota vieja confundia al usuario.
    expect(
      within(panel()).queryByText("Los estados derivados no filtran la tabla."),
    ).toBeNull();
  });

  it("un estado derivado filtra la tabla con la clave derivado", async () => {
    const { onAlternar } = renderFlujo({
      sin_traza: 2,
      por_estado_generacion: [
        { key: "generado", count: 409 },
        { key: "sin_registro", count: 10 },
      ],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Validador: ver desglose" }),
    );
    await screen.findByText("Validador · desglose");

    const contenido = panel();
    expect(
      within(contenido).getByText(
        "Concluida en el ERP sin registro en la bitácora: es un fallo del generador.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(contenido).getByRole("button", { name: /^Sin traza/ }),
    );

    expect(onAlternar).toHaveBeenCalledWith("derivado", "sin_traza");
    // El popover se cierra, igual que con un estado tecnico.
    expect(screen.queryByText("Validador · desglose")).toBeNull();
  });

  it("Pendiente de conclusión también filtra", async () => {
    const { onAlternar } = renderFlujo();

    fireEvent.click(
      screen.getByRole("button", { name: "Validador: ver desglose" }),
    );
    await screen.findByText("Validador · desglose");

    fireEvent.click(
      within(panel()).getByRole("button", {
        name: /^Pendiente de conclusión/,
      }),
    );

    expect(onAlternar).toHaveBeenCalledWith(
      "derivado",
      "pendientes_conclusion",
    );
  });

  it("SUNAT expone el puente de consultables", () => {
    renderFlujo();

    const tarjeta = screen.getByRole("button", { name: "SUNAT: ver desglose" });

    expect(within(tarjeta).getByText("0")).toBeTruthy();
    expect(within(tarjeta).getByText("0 de 417 consultables")).toBeTruthy();
    expect(within(tarjeta).getByText("Sin consulta")).toBeTruthy();
  });

  it("sin ventas en el período lo dice, sin inventar ceros", () => {
    renderFlujo({
      total: 0,
      total_ventas: 0,
      sunat_consultables: 0,
      por_estatus: [],
      por_estatus_listado: [],
      por_estado_generacion: [],
      por_estado_sunat: [],
      pendientes_conclusion: 0,
    });

    const tarjeta = screen.getByRole("button", {
      name: "Intelisis: ver desglose",
    });

    expect(within(tarjeta).getByText("Sin ventas en el período")).toBeTruthy();
    expect(
      screen.getByText("No incluye ventas de SynerPOS (SE-*): esas se controlan en la pestaña SynerPos."),
    ).toBeTruthy();
  });
});
