import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Logout01Icon,
  MoonIcon,
  ShieldCheckIcon,
  SunIcon,
} from "@hugeicons/core-free-icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs as UiTabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "cn";
import { logout } from "../api/client";
import type { SessionUser } from "../api/types";
import { useTheme } from "../theme/ThemeContext";

export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={
        resolved === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"
      }
      title={resolved === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
    >
      {resolved === "dark" ? (
        <HugeiconsIcon icon={SunIcon} size={18} strokeWidth={2} />
      ) : (
        <HugeiconsIcon icon={MoonIcon} size={18} strokeWidth={2} />
      )}
    </Button>
  );
}

export function Account({ user }: { user: SessionUser }) {
  return (
    <div className="flex items-center gap-2">
      <Avatar className="size-8">
        <AvatarImage
          src={user.picture || "/static/img/avatar.svg"}
          alt=""
        />
        <AvatarFallback>
          {(user.email?.[0] ?? "?").toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:inline">
        {user.email}
      </span>
      <Button type="button" variant="ghost" size="sm" onClick={logout} title="Salir">
        <HugeiconsIcon icon={Logout01Icon} size={15} strokeWidth={2} aria-hidden />
        <span>Salir</span>
      </Button>
    </div>
  );
}

export function TopBar({ actions }: { actions: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary font-semibold text-primary-foreground">
            S
          </div>
          <div className="flex flex-col leading-tight">
            <b className="text-sm">Syner Check</b>
            <span className="text-xs text-muted-foreground">
              Consulta de comprobantes
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {actions}
        </div>
      </div>
    </header>
  );
}

export function LoginCard() {
  return (
    <div className="flex justify-center py-16">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center">
          <span
            className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
            aria-hidden
          >
            <HugeiconsIcon icon={ShieldCheckIcon} size={28} strokeWidth={2} />
          </span>
          <CardTitle className="text-xl">Consulta segura</CardTitle>
          <CardDescription>
            Accede con tu cuenta empresarial de{" "}
            <b>@perfumeriasunidas.com.pe</b> para consultar boletas, facturas y
            notas de crédito.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a
            className={cn(buttonVariants(), "w-full")}
            href="/auth/login"
          >
            Continuar con Google
          </a>
        </CardContent>
      </Card>
    </div>
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
    <UiTabs
      value={mode}
      onValueChange={(value) => onChange(value as "range" | "number")}
    >
      <TabsList>
        <TabsTrigger value="range">Rango de fechas</TabsTrigger>
        <TabsTrigger value="number">Número de comprobante</TabsTrigger>
      </TabsList>
    </UiTabs>
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
    <div id="app" className="min-h-screen bg-background text-foreground">
      {topbar}
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
