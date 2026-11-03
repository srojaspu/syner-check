import { Suspense, lazy } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon } from "@hugeicons/core-free-icons";
import { Account, AppShell, LoginCard, TopBar } from "./components/AppShell";
import { PrimaryNav } from "./components/PrimaryNav";
import { useHashRoute } from "./hooks/useHashRoute";
import { useSession } from "./hooks/useSession";
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

  return (
    <AppShell
      topbar={
        <TopBar
          nav={<PrimaryNav ruta={ruta} />}
          actions={<Account user={user} />}
        />
      }
    >
      {ruta === "intelisis-ufe" ? (
        <Suspense fallback={<PageSkeleton />}>
          <IntelisisUfePage onAuthFailure={onAuthFailure} />
        </Suspense>
      ) : (
        <ComprobantesPage onAuthFailure={onAuthFailure} />
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Workspace />
    </ThemeProvider>
  );
}
