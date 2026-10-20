// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  emptyRows: [] as [],
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
    rows: mocks.emptyRows,
    subtitle: "0 documentos",
    loading: false,
    error: null,
    searched: false,
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

describe("App", () => {
  beforeEach(() => {
    mocks.session.ready = false;
    stubMatchMedia();
  });

  it("keeps hook order when the session becomes ready", () => {
    const { rerender } = render(<App />);

    mocks.session.ready = true;
    rerender(<App />);

    expect(screen.getByText("Resultados")).toBeTruthy();
  });
});
