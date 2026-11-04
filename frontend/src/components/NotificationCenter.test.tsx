// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_DISMISS_MS,
  NotificationHost,
  type NotificationItem,
} from "./NotificationCenter";
import { OperationProgressDialog } from "./OperationProgressDialog";
import { SunatProgress } from "./SunatProgress";
import type { SunatProgressState } from "../hooks/useSunat";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** Sonner agrega cada toast en un `setTimeout`: con timers falsos hay que avanzarlos. */
function flushToasts() {
  act(() => {
    vi.advanceTimersByTime(20);
  });
}

describe("NotificationHost", () => {
  it("muestra el aviso como toast de Sonner con titulo, descripcion y auto-cierre", () => {
    vi.useFakeTimers();
    const items: NotificationItem[] = [
      {
        id: "sunat-warning",
        signature: "sunat:warning:1",
        tone: "warning",
        title: "Validación en SUNAT",
        description: "Algunos comprobantes quedaron pendientes.",
      },
    ];

    render(<NotificationHost items={items} autoDismissMs={3000} />);
    flushToasts();

    expect(screen.getByText("Validación en SUNAT")).toBeTruthy();
    expect(
      screen.getByText("Algunos comprobantes quedaron pendientes."),
    ).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(
      screen.queryByText("Algunos comprobantes quedaron pendientes."),
    ).toBeNull();
  });

  it("muestra varios avisos a la vez, cada uno como su propio toast", async () => {
    const items: NotificationItem[] = [
      { id: "a", signature: "a", tone: "error", title: "Primer aviso" },
      { id: "b", signature: "b", tone: "info", title: "Segundo aviso" },
    ];

    render(<NotificationHost items={items} />);

    expect(await screen.findByText("Primer aviso")).toBeTruthy();
    expect(await screen.findByText("Segundo aviso")).toBeTruthy();
    expect(document.querySelectorAll("[data-sonner-toast]")).toHaveLength(2);
  });

  it("ejecuta la accion del toast", async () => {
    const onClick = vi.fn();
    render(
      <NotificationHost
        items={[
          {
            id: "cola",
            signature: "cola:1",
            tone: "error",
            title: "No fue posible leer la cola",
            action: { label: "Reintentar", onClick },
          },
        ]}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("vuelve a mostrar un aviso descartado si el estado se limpia y reaparece", () => {
    const item: NotificationItem = {
      id: "ufe-error",
      signature: "ufe-error:sin-conexion",
      tone: "error",
      persistent: true,
      title: "No fue posible consultar",
      description: "Sin conexión con Intelisis.",
    };

    vi.useFakeTimers();
    const { rerender } = render(<NotificationHost items={[item]} />);
    flushToasts();
    fireEvent.click(
      screen.getByRole("button", { name: "Cerrar notificación" }),
    );
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByText("Sin conexión con Intelisis.")).toBeNull();

    // El origen se limpia (nueva consulta) y el mismo error vuelve a ocurrir:
    // no debe quedar silenciado por el descarte anterior.
    rerender(<NotificationHost items={[]} />);
    rerender(<NotificationHost items={[item]} />);
    flushToasts();

    expect(screen.getByText("Sin conexión con Intelisis.")).toBeTruthy();
  });

  it("oculta automaticamente las notificaciones de error tras AUTO_DISMISS_MS usando Sonner", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const items: NotificationItem[] = [
      {
        id: "number-panel-error",
        signature: "number-error:Ingresa un número.:1",
        tone: "error",
        onDismiss,
        title: "Revisa los filtros",
        description: "Ingresa un número.",
      },
    ];

    render(<NotificationHost items={items} />);
    flushToasts();

    expect(screen.getByText("Revisa los filtros")).toBeTruthy();
    expect(screen.getByText("Ingresa un número.")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(AUTO_DISMISS_MS + 500);
    });

    expect(screen.queryByText("Ingresa un número.")).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("OperationProgressDialog · cancelacion segura", () => {
  it("pide confirmacion explicando los riesgos al intentar cerrar o cancelar mientras el proceso esta en curso", () => {
    const onCancel = vi.fn();
    const onClose = vi.fn();

    render(
      <OperationProgressDialog
        open={true}
        status="running"
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

    // Si pulsa Escape mientras corre, también pide confirmación (el modal no
    // duplica el botón "Cerrar": la única salida es cancelar el proceso).
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      code: "Escape",
    });
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
        status="completed"
        title="Progreso de envío a MovSynerPos"
        description="Proceso finalizado."
        riskDescription="Riesgo"
        onCancel={onCancel}
        onClose={onClose}
      >
        <div>100% completado</div>
      </OperationProgressDialog>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("pinta el resultado terminal sin boton de cancelar y con un solo Cerrar", () => {
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

    render(
      <OperationProgressDialog
        open={true}
        status="completed"
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
    expect(screen.getAllByRole("button", { name: "Cerrar" })).toHaveLength(1);
  });

  it("marca aria-busy solo mientras la operacion sigue en curso", () => {
    const { rerender } = render(
      <OperationProgressDialog
        open={true}
        status="running"
        title="Progreso"
        description="En curso"
        riskDescription="Riesgo"
        onCancel={vi.fn()}
        onClose={vi.fn()}
      >
        <div>50%</div>
      </OperationProgressDialog>,
    );

    expect(
      screen.getByRole("dialog").getAttribute("aria-busy"),
    ).toBe("true");

    rerender(
      <OperationProgressDialog
        open={true}
        status="failed"
        title="Progreso"
        description="Con error"
        riskDescription="Riesgo"
        onCancel={vi.fn()}
        onClose={vi.fn()}
      >
        <div>50%</div>
      </OperationProgressDialog>,
    );

    expect(
      screen.getByRole("dialog").getAttribute("aria-busy"),
    ).toBe("false");
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeTruthy();
  });
});
