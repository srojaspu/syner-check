// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SunatProgress } from "./SunatProgress";

describe("SunatProgress", () => {
  it("shows the live percentage and persisted counts", () => {
    render(
      <SunatProgress
        progress={{
          jobIndex: 1,
          jobCount: 2,
          estado: "EN_PROCESO",
          total: 50,
          procesados: 20,
          exitosos: 18,
          errores: 2,
          pendientes: 30,
          porcentaje: 40,
          mensaje: "Consultando SUNAT…",
        }}
        notice={null}
        warning={null}
        error={null}
      />,
    );

    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText("Lote 1 de 2")).toBeTruthy();
    expect(screen.getByText("20 de 50 procesados")).toBeTruthy();
    expect(screen.getByText("2 con error")).toBeTruthy();
    expect(screen.getByText("30 pendientes")).toBeTruthy();
  });

  it("keeps a background warning visible when polling paused", () => {
    render(
      <SunatProgress
        progress={null}
        notice={null}
        warning="El servidor seguirá reconciliando el lote."
        error={null}
      />,
    );

    expect(screen.getByText("Validación en segundo plano")).toBeTruthy();
    expect(
      screen.getByText("El servidor seguirá reconciliando el lote."),
    ).toBeTruthy();
  });
});
