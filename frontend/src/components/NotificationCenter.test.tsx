// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NotificationAlert,
  NotificationBell,
  NotificationHost,
  NotificationsProvider,
  type NotificationItem,
} from "./NotificationCenter";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("NotificationCenter", () => {
  it("no muestra el boton de cierre mientras el proceso esta en curso y no se auto-cierra", () => {
    vi.useFakeTimers();
    const items: NotificationItem[] = [
      {
        id: "sunat-running",
        signature: "sunat:running",
        tone: "info",
        running: true,
        summary: "SUNAT: Validando 10 documentos…",
        content: (
          <NotificationAlert
            tone="info"
            title="Validación SUNAT"
            description="Validando 10 documentos…"
          />
        ),
      },
    ];

    render(
      <NotificationsProvider>
        <NotificationBell />
        <NotificationHost sourceId="test" items={items} autoDismissMs={3000} />
      </NotificationsProvider>,
    );

    expect(screen.getByText("Validando 10 documentos…")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Cerrar notificación" }),
    ).toBeNull();

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText("Validando 10 documentos…")).toBeTruthy();
  });

  it("muestra el boton de cierre al terminar el proceso y desaparece sola tras el tiempo si nadie la cierra", () => {
    vi.useFakeTimers();
    const items: NotificationItem[] = [
      {
        id: "sunat-done",
        signature: "sunat:done",
        tone: "success",
        running: false,
        summary: "SUNAT: Validación completada.",
        content: (
          <NotificationAlert
            tone="success"
            title="Validación SUNAT"
            description="Validación completada."
          />
        ),
      },
    ];

    render(
      <NotificationsProvider>
        <NotificationBell />
        <NotificationHost sourceId="test" items={items} autoDismissMs={3000} />
      </NotificationsProvider>,
    );

    expect(screen.getByText("Validación completada.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Cerrar notificación" }),
    ).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.queryByText("Validación completada.")).toBeNull();

    // Sigue disponible en la campana superior para volver a mostrarla
    fireEvent.click(
      screen.getByRole("button", {
        name: "Centro de notificaciones y progreso",
      }),
    );
    expect(screen.getByText("SUNAT: Validación completada.")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /Mostrar en pantalla \(1\)/ }),
    );
    expect(screen.getByText("Validación completada.")).toBeTruthy();
  });
});
