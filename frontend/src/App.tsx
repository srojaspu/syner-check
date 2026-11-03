import { Suspense, lazy, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon } from "@hugeicons/core-free-icons";
import { Account, AppShell, LoginCard, TopBar } from "./components/AppShell";
import { PrimaryNav } from "./components/PrimaryNav";
import { useHashRoute } from "./hooks/useHashRoute";
import { useSession } from "./hooks/useSession";
import ComprobantesPage from "./pages/ComprobantesPage";
import { NotificationsProvider } from "./components/NotificationCenter";
import { ThemeProvider } from "./theme/ThemeContext";

// La pantalla nueva entra por separado: el bundle del flujo actual no crece
// y, si el backend de Intelisis falla, la pantalla 1 ni se entera (D4).
const IntelisisUfePage = lazy(() => import("./pages/IntelisisUfePage"));

function PageSkeleton() {
  return (
    <div
      className="flex items-center justify-center gap-2 py-16 text-muted-foreground"
      role="status"
      aria-busy="true"
    >
      <HugeiconsIcon
        icon={Loading02Icon}
        size={22}
        strokeWidth={2}
        className="animate-spin"
        aria-hidden
      />
      <b>Cargando…</b>
    </div>
  );
}

function Workspace() {
  const { user, ready, onAuthFailure } = useSession();
  const ruta = useHashRoute();
  const [visitedUfe, setVisitedUfe] = useState(
    () => ruta === "intelisis-ufe",
  );

  useEffect(() => {
    if (ruta === "intelisis-ufe") {
      setVisitedUfe(true);
    }
  }, [ruta]);

  if (!ready) {
    return (
      <AppShell topbar={<TopBar actions={null} />}>
        <PageSkeleton />
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell topbar={<TopBar actions={null} />}>
        <LoginCard />
      </AppShell>
    );
  }

  const isUfe = ruta === "intelisis-ufe";

  return (
    <AppShell
      topbar={
        <TopBar
          nav={<PrimaryNav ruta={ruta} />}
          actions={<Account user={user} />}
        />
      }
    >
      <div
        hidden={isUfe}
        aria-hidden={isUfe}
        className={isUfe ? "hidden" : "block"}
      >
        <ComprobantesPage onAuthFailure={onAuthFailure} />
      </div>
      {visitedUfe || isUfe ? (
        <div
          hidden={!isUfe}
          aria-hidden={!isUfe}
          className={isUfe ? "block" : "hidden"}
        >
          <Suspense fallback={<PageSkeleton />}>
            <IntelisisUfePage onAuthFailure={onAuthFailure} />
          </Suspense>
        </div>
      ) : null}
    </AppShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <NotificationsProvider>
        <Workspace />
      </NotificationsProvider>
    </ThemeProvider>
  );
}
