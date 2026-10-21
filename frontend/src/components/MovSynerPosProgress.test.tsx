// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MovSynerPosProgress } from "./MovSynerPosProgress";

afterEach(cleanup);

const PROGRESS = {
  enviados: 8,
  total: 10,
  insertados: 5,
  reparados: 1,
  sinCambios: 1,
  conflictos: 1,
  errores: 1,
};

describe("MovSynerPosProgress", () => {
  it("renders the running counters and progress bar", () => {
    render(
      <MovSynerPosProgress
        progress={PROGRESS}
        notice={null}
        warning={null}
        error={null}
        failedCount={0}
      />,
    );

    expect(screen.getByText("Envío a MovSynerPos")).toBeTruthy();
    expect(screen.getByText("8 de 10 documentos")).toBeTruthy();
    expect(screen.getByText("5 insertados")).toBeTruthy();
    expect(screen.getByText("1 reparados")).toBeTruthy();
    expect(screen.getByText("1 sin cambios")).toBeTruthy();
    expect(screen.getByText("1 con conflicto")).toBeTruthy();
    expect(screen.getByText("1 con error")).toBeTruthy();
    expect(
      screen.getByRole("progressbar", {
        name: /Avance del envío a MovSynerPos/,
      }),
    ).toBeTruthy();
  });

  it("shows the final summary and the retry action only for failures", () => {
    const onRetry = vi.fn();
    render(
      <MovSynerPosProgress
        progress={{ ...PROGRESS, enviados: 10, insertados: 10, errores: 0 }}
        notice="MovSynerPos: 10 insertados."
        warning={null}
        error={null}
        failedCount={0}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("MovSynerPos: 10 insertados.")).toBeTruthy();
    expect(screen.queryByText(/Reintentar solo los/)).toBeNull();
  });

  it("offers retry only for the failed documents", () => {
    const onRetry = vi.fn();
    render(
      <MovSynerPosProgress
        progress={{ ...PROGRESS, errores: 2, conflictos: 0 }}
        notice={null}
        warning="B004-1: Documento no encontrado en SynerCom."
        error={null}
        failedCount={2}
        onRetry={onRetry}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Reintentar solo los 2 fallidos" }),
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the error state", () => {
    render(
      <MovSynerPosProgress
        progress={PROGRESS}
        notice={null}
        warning={null}
        error="No se pudo reenviar a SynerPOS."
        failedCount={0}
      />,
    );

    expect(screen.getByText("No se pudo enviar a MovSynerPos")).toBeTruthy();
    expect(screen.getByText("Detenido")).toBeTruthy();
  });

  it("renders nothing when there is no state yet", () => {
    const { container } = render(
      <MovSynerPosProgress
        progress={null}
        notice={null}
        warning={null}
        error={null}
        failedCount={0}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
