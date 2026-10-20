import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight02Icon,
  ChevronRightIcon,
  CloudIcon,
  Database01Icon,
  Database02Icon,
  FileValidationIcon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type {
  FlowBreakdown,
  FlowStageKey,
  FlowStageSummary,
} from "../api/types";

type StageTone = "graphite" | "ok" | "warn" | "muted";

function Stage({
  icon,
  title,
  subtitle,
  value,
  missing,
  tone,
  hint,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  value: number;
  missing?: number;
  tone: StageTone;
  hint?: string;
  onClick?: () => void;
}) {
  const dot =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-500"
        : tone === "muted"
          ? "bg-muted-foreground/40"
          : "bg-sky-500";
  const content = (
    <>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted"
          aria-hidden
        >
          {icon}
        </span>
        <span className="min-w-0">
          <b className="block truncate text-foreground">{title}</b>
          <span className="block truncate">{subtitle}</span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <span className={`size-2 rounded-full ${dot}`} aria-hidden />
          {onClick ? (
            <HugeiconsIcon
              icon={ChevronRightIcon}
              size={13}
              strokeWidth={2}
              aria-hidden
            />
          ) : null}
        </span>
      </span>
      <b className="text-2xl leading-tight tabular-nums">{value}</b>
      {typeof missing === "number" && missing > 0 ? (
        <Badge variant="outline" className="w-fit">
          −{missing} en el paso
        </Badge>
      ) : null}
      {hint ? (
        <span className="text-xs leading-snug text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </>
  );

  const className = cn(
    "flex min-w-0 flex-1 flex-col gap-1 rounded-xl border border-border/60 bg-card p-3 text-left",
    onClick &&
      "cursor-pointer transition-colors hover:border-border hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
  );

  if (!onClick) {
    return <div className={className}>{content}</div>;
  }
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={`${title}: ver detalle por estado`}
    >
      {content}
    </button>
  );
}

function FlowArrow() {
  return (
    <span
      className="flex items-center justify-center text-muted-foreground"
      aria-hidden
    >
      <HugeiconsIcon
        icon={ArrowRight02Icon}
        size={18}
        strokeWidth={2}
        className="rotate-90 sm:rotate-0"
      />
    </span>
  );
}

function stateCount(
  stage: FlowStageSummary | undefined,
  key: string,
): number {
  return stage?.states.find((state) => state.key === key)?.count ?? 0;
}

function sunatPending(stage: FlowStageSummary | undefined): number {
  if (!stage) return 0;
  return stage.states
    .filter((state) =>
      ["error", "en_proceso", "desconocido"].includes(state.key),
    )
    .reduce((sum, state) => sum + state.count, 0);
}

export function FlowBar({
  flow,
  intelisisEnabled,
  intelisisCount,
  intelisisWarning,
  sunatEnabled,
  onOpenStage,
}: {
  flow: FlowBreakdown;
  intelisisEnabled: boolean;
  intelisisCount: number;
  intelisisWarning?: string | null;
  sunatEnabled: boolean;
  onOpenStage: (stage: FlowStageKey) => void;
}) {
  const totals = flow.totals;
  const lostMov = totals.missing_in_mov;
  const lostIntelisis = totals.missing_in_intelisis;
  const sunatStage = flow.stages?.sunat;
  const accepted = stateCount(sunatStage, "aceptado");
  const consulted = sunatStage?.consulted ?? 0;
  const pendingSunat = sunatPending(sunatStage);
  const sunatTone: StageTone = !sunatEnabled
    ? "muted"
    : pendingSunat > 0
      ? "warn"
      : consulted > 0
        ? "ok"
        : "muted";
  const sunatHint = !sunatEnabled
    ? "Validación no configurada"
    : consulted === 0
      ? "Sin consultas registradas"
      : `${consulted} consultado${consulted === 1 ? "" : "s"}${
          pendingSunat > 0 ? ` · ${pendingSunat} por revisar` : ""
        }`;

  return (
    <Card aria-live="polite" aria-label="Flujo de documentos">
      <CardContent className="flex flex-col gap-3">
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <b>Flujo</b>
          <span className="text-muted-foreground">
            SynerCOM → MovSynerPos → Intelisis
          </span>
          {!intelisisEnabled ? (
            <Badge variant="outline" className="gap-1">
              <HugeiconsIcon
                icon={InformationCircleIcon}
                size={13}
                strokeWidth={2}
                aria-hidden
              />
              {intelisisWarning
                ? "Intelisis no disponible (revisar conexión)"
                : "Intelisis no configurado"}
            </Badge>
          ) : (
            <Badge variant="secondary">{intelisisCount} en Punidas</Badge>
          )}
        </span>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
          <div className="grid flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-stretch">
            <Stage
              icon={<HugeiconsIcon icon={CloudIcon} size={15} strokeWidth={2} />}
              title="1 · SynerCOM"
              subtitle="GraphQL"
              value={totals.graphql}
              tone="graphite"
            />
            <FlowArrow />
            <Stage
              icon={
                <HugeiconsIcon icon={Database01Icon} size={15} strokeWidth={2} />
              }
              title="2 · MovSynerPos"
              subtitle="Pu_synerpos · 172.0.2.162"
              value={totals.in_mov}
              missing={lostMov}
              tone={lostMov > 0 ? "warn" : "ok"}
            />
            <FlowArrow />
            <Stage
              icon={
                <HugeiconsIcon icon={Database02Icon} size={15} strokeWidth={2} />
              }
              title="3 · Intelisis"
              subtitle="Punidas · 172.0.1.156 · SE-*"
              value={intelisisEnabled ? totals.in_intelisis : 0}
              missing={intelisisEnabled ? lostIntelisis : undefined}
              tone={
                !intelisisEnabled ? "muted" : lostIntelisis > 0 ? "warn" : "ok"
              }
              onClick={() => onOpenStage("intelisis")}
            />
          </div>

          {/*
            SUNAT is deliberately outside the flow grid and has no arrow:
            SynerPOS submits vouchers to SUNAT through Factus in parallel.
            MovSynerPOS → Intelisis is a separate ERP registration path.
          */}
          <div className="flex flex-col border-t border-border/60 pt-3 lg:w-64 lg:border-t-0 lg:border-l lg:pl-3 lg:pt-0">
            <Stage
              icon={
                <HugeiconsIcon
                  icon={FileValidationIcon}
                  size={15}
                  strokeWidth={2}
                />
              }
              title="SUNAT"
              subtitle="Envío desde SynerPos"
              value={accepted}
              hint={sunatHint}
              tone={sunatTone}
              onClick={() => onOpenStage("sunat")}
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {totals.full} documentos completan el flujo
          {intelisisEnabled && totals.pending_in_intelisis > 0
            ? ` · ${totals.pending_in_intelisis} pendientes de conclusión en Intelisis`
            : null}
          {intelisisEnabled && totals.cancelled_in_intelisis > 0
            ? ` · ${totals.cancelled_in_intelisis} cancelados en Intelisis`
            : null}{" "}
          · {lostMov} faltan en Mov ·{" "}
          {intelisisEnabled
            ? `${lostIntelisis} ausentes en Intelisis`
            : intelisisWarning
              ? "Intelisis con fallo de conexión (ver log del servidor)"
              : "Intelisis en modo degradado"}
          .{" "}
          {sunatEnabled
            ? `${accepted} aceptados en SUNAT de ${consulted} consultados.`
            : "SUNAT no está configurado en esta instancia."}
        </p>
      </CardContent>
    </Card>
  );
}
