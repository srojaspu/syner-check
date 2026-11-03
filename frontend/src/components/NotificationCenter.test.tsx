// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NotificationAlert,
  NotificationHost,
  type NotificationItem,
} from "./NotificationCenter";
import { OperationProgressDialog } from "./OperationProgressDialog";
import { SunatProgress, isSunatProgressTerminal } from "./SunatProgress";
import type { SunatProgressState } from "../hooks/useSunat";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("NotificationHost", () => {
  it("muestra notificaciones de error, warning o info con boton de cierre integrado y auto-cierre", () => {
    vi.useFakeTimers();
    const items: NotificationItem[] = [
      {
        id: "sunat-warning",
        signature: "sunat:warning:1",
        tone: "warning",
        content: (
          <NotificationAlert
            tone="warning"
            title="Validación en SUNAT"
            description="Algunos comprobantes quedaron pendientes."
          />
        ),
      },
    ];

    render(<NotificationHost items={items} autoDismissMs={3000} />);

    expect(
      screen.getByText("Algunos comprobantes quedaron pendientes."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Cerrar notificación" }),
    ).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(
      screen.queryByText("Algunos comprobantes quedaron pendientes."),
    ).toBeNull();
  });
});

describe("OperationProgressDialog · cancelacion segura", () => {
  it("pide confirmacion explicando los riesgos al intentar cerrar o cancelar mientras el proceso esta en curso", () => {
    const onCancel = vi.fn();
    const onClose = vi.fn();

    render(
      <OperationProgressDialog
        open={true}
        running={true}
        title="Progreso de validación en SUNAT"
        description="Consultando el estado de los comprobantes seleccionados contra SUNAT."
        riskDescription="Los lotes ya registrados seguirán procesándose en segundo plano."
        onCancel={onCancel}
        onClose={onClose}
      >
        <div>40% procesado</div>
      </OperationProgressDialog>,
    );

    expect(screen.getByText("40% procesado")).toBeTruthy();

    // Intentar cancelar abre la confirmación de riesgos sin cancelar todavía
    fireEvent.click(screen.getByRole("button", { name: "Cancelar proceso" }));

    expect(
      screen.getByText("¿Deseas cancelar el proceso en curso?"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Los lotes ya registrados seguirán procesándose en segundo plano.",
      ),
    ).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();

    // Puede arrepentirse y continuar con el proceso
    fireEvent.click(
      screen.getByRole("button", { name: "Continuar con el proceso" }),
    );
    expect(
      screen.queryByText("¿Deseas cancelar el proceso en curso?"),
    ).toBeNull();

    // Si pulsa el botón X de cerrar el modal mientras corre, también pide confirmación
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(
      screen.getByText("¿Deseas cancelar el proceso en curso?"),
    ).toBeTruthy();

    // Al confirmar la cancelación se ejecuta onCancel
    fireEvent.click(
      screen.getByRole("button", { name: "Sí, cancelar proceso" }),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("permite cerrar directamente cuando el proceso ya termino", () => {
    const onCancel = vi.fn();
    const onClose = vi.fn();

    render(
      <OperationProgressDialog
        open={true}
        running={false}
        title="Progreso de envío a MovSynerPos"
        description="Proceso finalizado."
        riskDescription="Riesgo"
        onCancel={onCancel}
        onClose={onClose}
      >
        <div>100% completado</div>
      </OperationProgressDialog>,
    );

    const cerrarButtons = screen.getAllByRole("button", { name: "Cerrar" });
    fireEvent.click(cerrarButtons[cerrarButtons.length - 1]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("sincroniza en el mismo render el estado Completado de SunatProgress con el icono y el boton Cerrar del modal", () => {
    const completedProgress: SunatProgressState = {
      phase: "job",
      jobIndex: 1,
      jobCount: 1,
      estado: "COMPLETADO",
      total: 1,
      procesados: 1,
      exitosos: 1,
      errores: 0,
      pendientes: 0,
      porcentaje: 100,
      mensaje: "Validación completada (ACEPTADO).",
      alcance: "todos",
      enviados: 1,
      porEnviar: 1,
      aceptados: 0,
      enProceso: 0,
      sinConfirmar: 0,
      invalidos: 0,
      chunksDone: 1,
      chunksTotal: 1,
    };

    const running = !isSunatProgressTerminal(completedProgress);
    expect(running).toBe(false);

    render(
      <OperationProgressDialog
        open={true}
        running={running}
        title="Progreso de validación en SUNAT"
        description="Consultando el estado de los comprobantes."
        riskDescription="Riesgo"
        onCancel={vi.fn()}
        onClose={vi.fn()}
      >
        <SunatProgress
          progress={completedProgress}
          notice={null}
          warning={null}
          error={null}
        />
      </OperationProgressDialog>,
    );

    expect(screen.getByText("Completado")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Cancelar proceso" }),
    ).toBeNull();
    expect(screen.getAllByRole("button", { name: "Cerrar" }).length).toBeGreaterThanOrEqual(2);
  });
});
