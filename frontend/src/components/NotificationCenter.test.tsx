// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  NotificationAlert,
  NotificationBell,
  NotificationHost,
  NotificationsProvider,
  type NotificationItem,
} from "./NotificationCenter";

afterEach(cleanup);

describe("NotificationCenter", () => {
  it("renderiza las notificaciones flotantes y permite minimizarlas y restaurarlas desde la campana", () => {
    const items: NotificationItem[] = [
      {
        id: "sunat-running",
        signature: "sunat:1",
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
        <NotificationHost sourceId="test" items={items} />
      </NotificationsProvider>,
    );

    expect(
      screen.getByRole("region", { name: "Notificaciones y progreso" }),
    ).toBeTruthy();
    expect(screen.getByText("Validando 10 documentos…")).toBeTruthy();

    // Minimizar desde la tarjeta flotante
    fireEvent.click(
      screen.getByRole("button", { name: "Minimizar progreso" }),
    );
    expect(screen.queryByText("Validación SUNAT")).toBeNull();

    // Abrir el centro de notificaciones en el TopBar y restaurar
    fireEvent.click(
      screen.getByRole("button", {
        name: "Centro de notificaciones y progreso",
      }),
    );
    expect(
      screen.getByText("SUNAT: Validando 10 documentos…"),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /Mostrar en pantalla \(1\)/ }),
    );
    expect(screen.getByText("Validación SUNAT")).toBeTruthy();
  });
});
