// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
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
  movsynerpos: {
    busy: false,
    refreshing: false,
    progress: null,
    notice: null,
    warning: null,
    error: null,
    failed: [],
    reset: vi.fn(),
    run: vi.fn(),
    retry: vi.fn(),
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
    progress: null,
    notice: null,
    warning: null,
    error: null,
    reset: vi.fn(),
    runBatch: vi.fn(),
  }),
}));

vi.mock("./hooks/useMovSynerPos", () => ({
  useMovSynerPos: () => mocks.movsynerpos,
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
    mocks.movsynerpos.run.mockReset();
    stubMatchMedia();
  });

  it("keeps hook order when the session becomes ready", () => {
    const { rerender } = render(<App />);

    mocks.session.ready = true;
    rerender(<App />);

    expect(screen.getByText("Resultados")).toBeTruthy();
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
});
