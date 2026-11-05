import { Suspense, lazy, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon } from "@hugeicons/core-free-icons";
import { Account, AppShell, LoginCard, TopBar } from "./components/AppShell";
import { PrimaryNav } from "./components/PrimaryNav";
import { useHashRoute } from "./hooks/useHashRoute";
import { useSession } from "./hooks/useSession";
import { NotificationProvider } from "./components/NotificationCenter";
import { OperationsHost } from "./operations/OperationsHost";
import { OperationsProvider } from "./operations/OperationsContext";
import ComprobantesPage from "./pages/ComprobantesPage";
import { ThemeProvider } from "./theme/ThemeContext";

// La pantalla nueva entra por separado: el bundle del flujo actual no crece
// y, si el backend de Intelisis falla, la pantalla 1 ni se entera (D4).
const IntelisisUfePage = lazy(() => import("./pages/IntelisisUfePage"));
const SerieSucursalPage = lazy(() => import("./pages/SerieSucursalPage"));

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

  // Intelisis UFE y Series Sucursal se montan la primera vez que se visitan
  // y se quedan montadas (ocultas) para no abortar estado ni refetches.
  const [visitedUfe, setVisitedUfe] = useState(ruta === "intelisis-ufe");
  const [visitedSeries, setVisitedSeries] = useState(
    ruta === "series-sucursal",
  );
  useEffect(() => {
    if (ruta === "intelisis-ufe") setVisitedUfe(true);
    if (ruta === "series-sucursal") setVisitedSeries(true);
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

  const enComprobantes = ruta === "comprobantes";
  const enUfe = ruta === "intelisis-ufe";
  const enSeries = ruta === "series-sucursal";

  return (
    <OperationsProvider onAuthFailure={onAuthFailure}>
      <AppShell
        topbar={
          <TopBar
            nav={<PrimaryNav ruta={ruta} />}
            actions={<Account user={user} />}
          />
        }
      >
        {/*
          Las páginas quedan montadas al visitarse: cambiar de pestaña ya no
          desmonta los hooks de operación y no aborta procesos en curso.
        */}
        <div hidden={!enComprobantes} aria-hidden={!enComprobantes || undefined}>
          <ComprobantesPage onAuthFailure={onAuthFailure} />
        </div>

        {visitedUfe ? (
          <div hidden={!enUfe} aria-hidden={!enUfe || undefined}>
            <Suspense fallback={<PageSkeleton />}>
              <IntelisisUfePage onAuthFailure={onAuthFailure} />
            </Suspense>
          </div>
        ) : null}

        {visitedSeries ? (
          <div hidden={!enSeries} aria-hidden={!enSeries || undefined}>
            <Suspense fallback={<PageSkeleton />}>
              <SerieSucursalPage onAuthFailure={onAuthFailure} />
            </Suspense>
          </div>
        ) : null}

        <OperationsHost />
      </AppShell>
    </OperationsProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <NotificationProvider>
        <Workspace />
      </NotificationProvider>
    </ThemeProvider>
  );
}
