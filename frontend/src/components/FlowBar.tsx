import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight02Icon,
  CloudIcon,
  Database01Icon,
  Database02Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { FlowPerTipo } from "../api/types";

function Stage({
  icon,
  title,
  subtitle,
  value,
  missing,
  tone,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  value: number;
  missing?: number;
  tone: "graphite" | "ok" | "warn" | "muted";
}) {
  const dot =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-500"
        : tone === "muted"
          ? "bg-muted-foreground/40"
          : "bg-sky-500";
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-xl border border-border/60 bg-card p-3">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex size-7 items-center justify-center rounded-lg bg-muted" aria-hidden>
          {icon}
        </span>
        <span className="min-w-0">
          <b className="block truncate text-foreground">{title}</b>
          <span className="block truncate">{subtitle}</span>
        </span>
        <span className={`ml-auto size-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      </span>
      <b className="text-2xl leading-tight tabular-nums">{value}</b>
      {typeof missing === "number" && missing > 0 ? (
        <Badge variant="outline" className="w-fit">
          −{missing} en el paso
        </Badge>
      ) : null}
    </div>
  );
}

export function FlowBar({
  totals,
  intelisisEnabled,
  intelisisCount,
  intelisisWarning,
}: {
  totals: FlowPerTipo;
  intelisisEnabled: boolean;
  intelisisCount: number;
  intelisisWarning?: string | null;
}) {
  const lostMov = totals.missing_in_mov;
  const lostIntelisis = totals.missing_in_intelisis;
  return (
    <Card aria-live="polite" aria-label="Flujo de documentos">
      <CardContent className="flex flex-col gap-3">
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <b>Flujo</b>
          <span className="text-muted-foreground">SynerCOM → MovSynerPos → Intelisis</span>
          {!intelisisEnabled ? (
            <Badge variant="outline" className="gap-1">
              <HugeiconsIcon icon={InformationCircleIcon} size={13} strokeWidth={2} aria-hidden />
              {intelisisWarning
                ? "Intelisis no disponible (revisar conexión)"
                : "Intelisis no configurado"}
            </Badge>
          ) : (
            <Badge variant="secondary">{intelisisCount} en Punidas</Badge>
          )}
        </span>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <Stage
            icon={<HugeiconsIcon icon={CloudIcon} size={15} strokeWidth={2} />}
            title="1 · SynerCOM"
            subtitle="GraphQL"
            value={totals.graphql}
            tone="graphite"
          />
          <span className="flex items-center justify-center text-muted-foreground" aria-hidden>
            <HugeiconsIcon icon={ArrowRight02Icon} size={18} strokeWidth={2} className="rotate-90 sm:rotate-0" />
          </span>
          <Stage
            icon={<HugeiconsIcon icon={Database01Icon} size={15} strokeWidth={2} />}
            title="2 · MovSynerPos"
            subtitle="Pu_synerpos · 172.0.2.162"
            value={totals.in_mov}
            missing={lostMov}
            tone={lostMov > 0 ? "warn" : "ok"}
          />
          <span className="flex items-center justify-center text-muted-foreground" aria-hidden>
            <HugeiconsIcon icon={ArrowRight02Icon} size={18} strokeWidth={2} className="rotate-90 sm:rotate-0" />
          </span>
          <Stage
            icon={<HugeiconsIcon icon={Database02Icon} size={15} strokeWidth={2} />}
            title="3 · Intelisis"
            subtitle="Punidas · 172.0.1.156 · SE-*"
            value={intelisisEnabled ? totals.in_intelisis : 0}
            missing={intelisisEnabled ? lostIntelisis : undefined}
            tone={!intelisisEnabled ? "muted" : lostIntelisis > 0 ? "warn" : "ok"}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {totals.full} documentos completan el flujo · {lostMov} faltan en Mov ·{" "}
          {intelisisEnabled
            ? `${lostIntelisis} faltan en Intelisis`
            : intelisisWarning
              ? "Intelisis con fallo de conexión (ver log del servidor)"
              : "Intelisis en modo degradado"}.
        </p>
      </CardContent>
    </Card>
  );
}
