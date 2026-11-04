// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Voucher } from "./api/types";

const mocks = vi.hoisted(() => ({
  session: {
    ready: false,
    user: {
      email: "dev@example.com",
      name: "Dev",
      picture: "",
      auth_mode: "development",
    },
  },
  rows: [] as Voucher[],
  ncWarning: null as string | null,
  ufeMounts: 0,
  movsynerpos: {
    busy: false,
    refreshing: false,
    status: "idle",
    progress: null,
    notice: null,
    warning: null,
    error: null,
    failed: [],
    reset: vi.fn(),
    run: vi.fn(),
    retry: vi.fn(),
    cancel: vi.fn(),
    dismissProgress: vi.fn(),
  },
}));

vi.mock("./hooks/useSession", () => ({
  useSession: () => ({
    user: mocks.session.ready ? mocks.session.user : null,
    ready: mocks.session.ready,
    onAuthFailure: vi.fn(),
  }),
}));

vi.mock("./hooks/useVouchers", () => ({
  useVouchers: () => ({
    rows: mocks.rows,
    subtitle: `${mocks.rows.length} documentos`,
    loading: false,
    error: null,
    searched: mocks.rows.length > 0,
    intelisisEnabled: false,
    intelisisCount: 0,
    intelisisWarning: null,
    ncWarning: mocks.ncWarning,
    sunatEnabled: false,
    flow: null,
    runRange: vi.fn(),
    runNumber: vi.fn(),
  }),
}));

vi.mock("./hooks/useDocument", () => ({
  useDocument: () => ({
    open: false,
    document: null,
    loading: false,
    error: null,
    show: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock("./hooks/useSunat", () => ({
  useSunat: () => ({
    busy: false,
    refreshing: false,
    status: "idle",
    progress: null,
    notice: null,
    warning: null,
    error: null,
    reset: vi.fn(),
    runBatch: vi.fn(),
    cancel: vi.fn(),
    dismissProgress: vi.fn(),
  }),
}));

vi.mock("./hooks/useMovSynerPos", () => ({
  useMovSynerPos: () => mocks.movsynerpos,
}));

vi.mock("./pages/IntelisisUfePage", () => ({
  default: () => {
    useEffect(() => {
      mocks.ufeMounts += 1;
    }, []);
    return <div>Pantalla UFE</div>;
  },
}));

import App from "./App";

afterEach(cleanup);

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

function row(oid: string, inSql: boolean): Voucher {
  return {
    oid,
    tipo: "BOLETA",
    number: `B004-${oid}`,
    date: "2026-10-20",
    crossTotal: 100,
    in_sql: inSql,
  };
}

describe("App", () => {
  beforeEach(() => {
    mocks.session.ready = false;
    mocks.rows = [];
    mocks.ncWarning = null;
    mocks.ufeMounts = 0;
    mocks.movsynerpos.run.mockReset();
    window.location.hash = "";
    stubMatchMedia();
  });

  function goTo(hash: string) {
    act(() => {
      window.location.hash = hash;
      window.dispatchEvent(new Event("hashchange"));
    });
  }

  it("keeps hook order when the session becomes ready", () => {
    const { rerender } = render(<App />);

    mocks.session.ready = true;
    rerender(<App />);

    expect(screen.getByText("Resultados")).toBeTruthy();
  });

  it("avisa en el sistema de notificaciones cuando la verificación de notas de crédito quedó incompleta", async () => {
    mocks.session.ready = true;
    mocks.rows = [row("1", true)];
    mocks.ncWarning = "credit_notes_unavailable";
    const { container } = render(<App />);

    const tray = screen.getByRole("region", { name: "Notificaciones" });
    expect(
      await within(tray).findByText("Notas de crédito sin verificar"),
    ).toBeTruthy();
    expect(
      within(tray).getByText(/puede faltar algún resultado/i),
    ).toBeTruthy();
    expect(container.querySelector('[data-slot="alert"]')).toBeNull();
  });

  it("disables the MovSynerPos button without rows", () => {
    mocks.session.ready = true;
    render(<App />);

    const button = screen.getByRole("button", {
      name: "Enviar a MovSynerPos",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("sends the effective rows after confirming the dialog", () => {
    mocks.session.ready = true;
    mocks.rows = [row("1", false), row("2", true)];
    render(<App />);

    fireEvent.click(
      screen.getByRole("button", { name: "Enviar a MovSynerPos (2)" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Enviar a MovSynerPos" }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Enviar 1 documento" }),
    );
    expect(mocks.movsynerpos.run).toHaveBeenCalledTimes(1);
    expect(mocks.movsynerpos.run.mock.calls[0][0]).toHaveLength(2);
    expect(mocks.movsynerpos.run.mock.calls[0][2]).toBe(false);
  });

  it("permite seleccionar comprobantes con checks y opera solo sobre los marcados", () => {
    mocks.session.ready = true;
    mocks.rows = [row("1", false), row("2", false)];
    render(<App />);

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Seleccionar B004-1" }),
    );

    const button = screen.getByRole("button", {
      name: "Enviar a MovSynerPos (1)",
    });
    expect(button).toBeTruthy();

    fireEvent.click(button);
    fireEvent.click(
      screen.getByRole("button", { name: "Enviar 1 documento" }),
    );
    expect(mocks.movsynerpos.run).toHaveBeenCalledTimes(1);
    expect(mocks.movsynerpos.run.mock.calls[0][0]).toEqual([mocks.rows[0]]);
  });

  it("mantiene ambas pantallas montadas al cambiar de ruta", async () => {
    mocks.session.ready = true;
    render(<App />);

    goTo("#/intelisis-ufe");
    expect(await screen.findByText("Pantalla UFE")).toBeTruthy();
    expect(mocks.ufeMounts).toBe(1);

    goTo("#/comprobantes");
    await waitFor(() => expect(screen.getByText("Resultados")).toBeTruthy());

    // La pantalla UFE sigue montada (oculta): volver no reinicia su estado ni
    // aborta una operación en curso.
    expect(screen.getByText("Pantalla UFE")).toBeTruthy();
    expect(mocks.ufeMounts).toBe(1);
  });
});
