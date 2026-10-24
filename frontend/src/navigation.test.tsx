// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrimaryNav } from "./components/PrimaryNav";
import { rutaDesdeHash } from "./hooks/useHashRoute";

afterEach(cleanup);

describe("ruteo por hash", () => {
  it("mapea las secciones conocidas", () => {
    expect(rutaDesdeHash("#/comprobantes")).toBe("comprobantes");
    expect(rutaDesdeHash("#/intelisis-ufe")).toBe("intelisis-ufe");
  });

  it("cae en comprobantes ante un hash desconocido", () => {
    expect(rutaDesdeHash("")).toBe("comprobantes");
    expect(rutaDesdeHash("#/otra-cosa")).toBe("comprobantes");
  });
});

describe("PrimaryNav", () => {
  it("marca la seccion activa con aria-current", () => {
    render(<PrimaryNav ruta="intelisis-ufe" />);

    const activo = screen.getByRole("link", { name: "Intelisis UFE" });
    const inactivo = screen.getByRole("link", { name: "SynerPos" });
    expect(activo.getAttribute("aria-current")).toBe("page");
    expect(inactivo.getAttribute("aria-current")).toBeNull();
  });

  it("navega con enlaces reales", () => {
    render(<PrimaryNav ruta="comprobantes" />);

    expect(
      screen.getByRole("link", { name: "SynerPos" }).getAttribute("href"),
    ).toBe("#/comprobantes");
    expect(
      screen.getByRole("link", { name: "Intelisis UFE" }).getAttribute("href"),
    ).toBe("#/intelisis-ufe");
  });
});
