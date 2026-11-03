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
      <NotificationsProvider autoDismissMs={3000}>
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
      <NotificationsProvider autoDismissMs={3000}>
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

  it("mantiene visibles los procesos en segundo plano de otra pestaña en el icono de notificaciones", () => {
    const synerposItems: NotificationItem[] = [
      {
        id: "synerpos-sunat",
        signature: "synerpos:sunat:45",
        tone: "info",
        running: true,
        progressPercent: 45,
        originLabel: "SynerPos",
        originHref: "#/comprobantes",
        summary: "SUNAT: Consultando lote 1 de 2…",
        content: (
          <NotificationAlert
            tone="info"
            title="Validación SUNAT"
            description="Consultando lote 1 de 2…"
          />
        ),
      },
    ];

    render(
      <NotificationsProvider>
        <NotificationBell />
        <div hidden aria-hidden>
          <NotificationHost sourceId="synerpos" items={synerposItems} />
        </div>
        <div>
          <NotificationHost sourceId="intelisis-ufe" items={[]} />
        </div>
      </NotificationsProvider>,
    );

    // El botón del TopBar muestra que hay 1 proceso en curso
    const bell = screen.getByRole("button", {
      name: "Centro de notificaciones y progreso",
    });
    expect(bell.textContent).toContain("En curso (1)");

    // Al abrir el centro de notificaciones se ve el proceso en segundo plano, su origen y su barra de progreso
    fireEvent.click(bell);
    expect(
      screen.getByText("Procesos en segundo plano (1)"),
    ).toBeTruthy();
    expect(screen.getByText("SynerPos")).toBeTruthy();
    expect(
      screen.getByText("SUNAT: Consultando lote 1 de 2…"),
    ).toBeTruthy();
    expect(
      screen.getByRole("progressbar", { name: /Avance SynerPos/ }).getAttribute(
        "aria-valuenow",
      ),
    ).toBe("45");
    expect(
      screen.getByRole("link", { name: "Ir a SynerPos" }).getAttribute("href"),
    ).toBe("#/comprobantes");
  });
});
