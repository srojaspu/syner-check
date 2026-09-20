import type { ReactNode } from "react";
import { LogOut, Moon, ShieldCheck, Sun } from "lucide-react";
import { logout } from "../api/client";
import type { SessionUser } from "../api/types";
import { useTheme } from "../theme/ThemeContext";

export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={
        resolved === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"
      }
      title={resolved === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
    >
      {resolved === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export function Account({ user }: { user: SessionUser }) {
  return (
    <div className="account">
      <img
        className="avatar"
        src={user.picture || "/static/img/avatar.svg"}
        alt=""
      />
      <span className="email">{user.email}</span>
      <button type="button" className="logout" onClick={logout} title="Salir">
        <LogOut size={15} aria-hidden />
        <span>Salir</span>
      </button>
    </div>
  );
}

export function TopBar({ actions }: { actions: ReactNode }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">S</div>
        <div>
          <b>Syner Check</b>
          <span>Consulta de comprobantes</span>
        </div>
      </div>
      <div className="topbar-actions">
        <ThemeToggle />
        {actions}
      </div>
    </header>
  );
}

export function LoginCard() {
  return (
    <section className="login-card">
      <div className="login-icon" aria-hidden>
        <ShieldCheck size={28} />
      </div>
      <h1>Consulta segura</h1>
      <p>
        Accede con tu cuenta empresarial de <b>@perfumeriasunidas.com.pe</b>{" "}
        para consultar boletas, facturas y notas de crédito.
      </p>
      <a className="btn primary" href="/auth/login">
        Continuar con Google
      </a>
    </section>
  );
}

export function Tabs({
  mode,
  onChange,
}: {
  mode: "range" | "number";
  onChange: (mode: "range" | "number") => void;
}) {
  return (
    <div className="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "range"}
        className={mode === "range" ? "tab active" : "tab"}
        onClick={() => onChange("range")}
      >
        Rango de fechas
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "number"}
        className={mode === "number" ? "tab active" : "tab"}
        onClick={() => onChange("number")}
      >
        Número de comprobante
      </button>
    </div>
  );
}

/** Shell composes topbar + page body via slots. */
export function AppShell({
  topbar,
  children,
}: {
  topbar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div id="app">
      {topbar}
      <main className="shell">{children}</main>
    </div>
  );
}
