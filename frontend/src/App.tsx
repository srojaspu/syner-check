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

  // Intelisis UFE se monta la primera vez que se visita y se queda montada
  // (oculta) para no abortar sus consultas al cambiar de pestaña.
  const [visitedUfe, setVisitedUfe] = useState(ruta === "intelisis-ufe");
  useEffect(() => {
    if (ruta === "intelisis-ufe") setVisitedUfe(true);
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

  const enUfe = ruta === "intelisis-ufe";

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
          Las dos páginas quedan montadas: cambiar de pestaña ya no desmonta
          los hooks de operación y, por tanto, no aborta la validación o el
          envío en curso. El host de operaciones vive fuera de ambas y es el
          único que pinta el modal y los avisos de proceso.
        */}
        <div hidden={enUfe} aria-hidden={enUfe || undefined}>
          <ComprobantesPage onAuthFailure={onAuthFailure} />
        </div>

        {visitedUfe ? (
          <div hidden={!enUfe} aria-hidden={!enUfe || undefined}>
            <Suspense fallback={<PageSkeleton />}>
              <IntelisisUfePage onAuthFailure={onAuthFailure} />
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
