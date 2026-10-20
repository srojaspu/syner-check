// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SunatProgress } from "./SunatProgress";

afterEach(cleanup);

describe("SunatProgress", () => {
  it("shows the live percentage and persisted counts", () => {
    render(
      <SunatProgress
        progress={{
          phase: "job",
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
          alcance: "no_aceptados",
          enviados: 20,
          porEnviar: 50,
          aceptados: 0,
          enProceso: 0,
          sinConfirmar: 0,
          invalidos: 0,
          chunksDone: 0,
          chunksTotal: 2,
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

  it("shows submission chunks before job polling starts", () => {
    render(
      <SunatProgress
        progress={{
          phase: "submission",
          jobIndex: 0,
          jobCount: 0,
          estado: "EN_PROCESO",
          total: 395,
          procesados: 50,
          exitosos: 0,
          errores: 0,
          pendientes: 117,
          porcentaje: 30,
          mensaje: "Enviando lote 2 de 4…",
          alcance: "no_aceptados",
          enviados: 50,
          porEnviar: 167,
          aceptados: 228,
          enProceso: 0,
          sinConfirmar: 0,
          invalidos: 0,
          chunksDone: 1,
          chunksTotal: 4,
        }}
        notice={null}
        warning={null}
        error={null}
      />,
    );

    expect(
      screen.getAllByText(/Enviando lote 2 de 4/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("50 de 167 enviados")).toBeTruthy();
    expect(screen.getByText("228 aceptados")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "30",
    );
  });

  it("says SUNAT is still working after all chunks are sent", () => {
    render(
      <SunatProgress
        progress={{
          phase: "submission",
          jobIndex: 0,
          jobCount: 0,
          estado: "COMPLETADO",
          total: 0,
          procesados: 0,
          exitosos: 0,
          errores: 0,
          pendientes: 0,
          porcentaje: 100,
          mensaje: "Lotes enviados. Consultando SUNAT…",
          alcance: "no_aceptados",
          enviados: 167,
          porEnviar: 0,
          aceptados: 0,
          enProceso: 0,
          sinConfirmar: 0,
          invalidos: 0,
          chunksDone: 2,
          chunksTotal: 2,
        }}
        notice={null}
        warning={null}
        error={null}
      />,
    );

    expect(screen.getByText("Consultando SUNAT")).toBeTruthy();
    expect(screen.getByText("2 de 2 lotes enviados")).toBeTruthy();
    expect(screen.queryByText("Completado")).toBeNull();
    expect(screen.queryByText("Sin envíos nuevos")).toBeNull();
  });

  it("does not mark an intermediate job as completed", () => {
    render(
      <SunatProgress
        progress={{
          phase: "job",
          jobIndex: 1,
          jobCount: 2,
          estado: "COMPLETADO",
          total: 100,
          procesados: 50,
          exitosos: 50,
          errores: 0,
          pendientes: 50,
          porcentaje: 50,
          mensaje: "Lote 1 listo. Consultando el siguiente…",
          alcance: "no_aceptados",
          enviados: 50,
          porEnviar: 100,
          aceptados: 0,
          enProceso: 0,
          sinConfirmar: 0,
          invalidos: 0,
          chunksDone: 0,
          chunksTotal: 2,
        }}
        notice={null}
        warning={null}
        error={null}
      />,
    );

    expect(screen.getByText("Lote listo")).toBeTruthy();
    expect(screen.queryByText("Completado")).toBeNull();
  });

  it("marks the last completed job as completed", () => {
    render(
      <SunatProgress
        progress={{
          phase: "job",
          jobIndex: 2,
          jobCount: 2,
          estado: "COMPLETADO",
          total: 100,
          procesados: 100,
          exitosos: 98,
          errores: 2,
          pendientes: 0,
          porcentaje: 100,
          mensaje: "Validación completada.",
          alcance: "no_aceptados",
          enviados: 100,
          porEnviar: 100,
          aceptados: 0,
          enProceso: 0,
          sinConfirmar: 0,
          invalidos: 0,
          chunksDone: 0,
          chunksTotal: 2,
        }}
        notice={null}
        warning={null}
        error={null}
      />,
    );

    expect(screen.getByText("Completado")).toBeTruthy();
    expect(screen.getByText("Lote 2 de 2")).toBeTruthy();
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
