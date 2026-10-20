import { useState, type ReactNode } from "react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  FlowBreakdown,
  FlowStageKey,
  FlowStageSummary,
} from "../api/types";

type StageTone = "graphite" | "ok" | "warn" | "muted";

function stageDot(tone: StageTone): string {
  if (tone === "ok") return "bg-emerald-500";
  if (tone === "warn") return "bg-amber-500";
  if (tone === "muted") return "bg-muted-foreground/40";
  return "bg-sky-500";
}

function stageCardClass(interactive: boolean, active = false): string {
  return cn(
    "flex min-w-0 flex-1 flex-col gap-1 rounded-xl border border-border/60 bg-card p-3 text-left",
    interactive &&
      "cursor-pointer transition-colors hover:border-border hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    active && "border-primary/40 bg-muted/40",
  );
}

function StageContent({
  icon,
  title,
  subtitle,
  value,
  missing,
  tone,
  hint,
  interactive,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  value: number;
  missing?: number;
  tone: StageTone;
  hint?: string;
  interactive?: boolean;
}) {
  return (
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
          <span
            className={`size-2 rounded-full ${stageDot(tone)}`}
            aria-hidden
          />
          {interactive ? (
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

function StagePopoverContent({
  stage,
  title,
  summary,
  enabled,
  selectedState,
  onSelect,
  onClear,
}: {
  stage: FlowStageKey;
  title: string;
  summary?: FlowStageSummary;
  enabled: boolean;
  selectedState?: string | null;
  onSelect: (state: string) => void;
  onClear?: () => void;
}) {
  const states = (summary?.states ?? []).filter((state) => state.count > 0);
  const available = enabled && (summary?.enabled ?? false);
  const total = summary?.total ?? 0;
  const consulted = summary?.consulted ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <p className="font-medium">{title} · estados</p>
        <p className="text-xs text-muted-foreground">
          {summary
            ? `${total} documento${total === 1 ? "" : "s"} en esta búsqueda${
                stage === "sunat" ? ` · ${consulted} consultados` : ""
              }`
            : "Sin desglose disponible"}
        </p>
      </div>

      {!summary ? (
        <p className="text-xs leading-snug text-muted-foreground">
          El servidor no devolvió el desglose de estados.
        </p>
      ) : !available ? (
        <p className="text-xs leading-snug text-muted-foreground">
          {stage === "sunat"
            ? "La validación SUNAT no está configurada en esta instancia."
            : "La conexión con Intelisis no está disponible."}
        </p>
      ) : states.length === 0 ? (
        <p className="text-xs leading-snug text-muted-foreground">
          No hay documentos para mostrar en esta búsqueda.
        </p>
      ) : (
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
          {states.map((state) => {
            const active = state.key === selectedState;
            return (
              <button
                key={state.key}
                type="button"
                onClick={() => onSelect(state.key)}
                aria-pressed={active}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active && "bg-muted font-medium",
                )}
              >
                <span className="min-w-0 truncate">{state.label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {active ? (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Filtro
                    </span>
                  ) : null}
                  <Badge
                    variant={active ? "secondary" : "outline"}
                    className="tabular-nums"
                  >
                    {state.count}
                  </Badge>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <p className="text-[11px] leading-snug text-muted-foreground">
          {selectedState
            ? "Filtro aplicado en la tabla."
            : "Selecciona un estado para ver esos documentos en la tabla."}
        </p>
        {selectedState && onClear ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Quitar filtro
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function StagePopover({
  stage,
  title,
  summary,
  enabled,
  selectedState,
  open,
  onOpenChange,
  onSelect,
  onClear,
  triggerClassName,
  children,
}: {
  stage: FlowStageKey;
  title: string;
  summary?: FlowStageSummary;
  enabled: boolean;
  selectedState?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (state: string) => void;
  onClear?: () => void;
  triggerClassName: string;
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={triggerClassName}
            aria-label={`${title}: ver estados`}
          />
        }
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(22rem,calc(100vw-1rem))] p-3"
      >
        <StagePopoverContent
          stage={stage}
          title={title}
          summary={summary}
          enabled={enabled}
          selectedState={selectedState}
          onSelect={onSelect}
          onClear={onClear}
        />
      </PopoverContent>
    </Popover>
  );
}

export function FlowBar({
  flow,
  intelisisEnabled,
  intelisisCount,
  intelisisWarning,
  sunatEnabled,
  selectedStage,
  selectedState,
  onSelectState,
  onClearSelection,
}: {
  flow: FlowBreakdown;
  intelisisEnabled: boolean;
  intelisisCount: number;
  intelisisWarning?: string | null;
  sunatEnabled: boolean;
  selectedStage?: FlowStageKey | null;
  selectedState?: string | null;
  onSelectState: (stage: FlowStageKey, state: string) => void;
  onClearSelection?: () => void;
}) {
  const [openStage, setOpenStage] = useState<FlowStageKey | null>(null);
  const totals = flow.totals;
  const lostMov = totals.missing_in_mov;
  const lostIntelisis = totals.missing_in_intelisis;
  const intelisisStage = flow.stages?.intelisis;
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
  const intelisisSelected =
    selectedStage === "intelisis" ? selectedState : null;
  const sunatSelected = selectedStage === "sunat" ? selectedState : null;

  const handleSelect = (stage: FlowStageKey, state: string) => {
    onSelectState(stage, state);
    setOpenStage(null);
  };

  const handleClear = () => {
    onClearSelection?.();
    setOpenStage(null);
  };

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
            <div className={stageCardClass(false)}>
              <StageContent
                icon={
                  <HugeiconsIcon icon={CloudIcon} size={15} strokeWidth={2} />
                }
                title="1 · SynerCOM"
                subtitle="GraphQL"
                value={totals.graphql}
                tone="graphite"
              />
            </div>
            <FlowArrow />
            <div className={stageCardClass(false)}>
              <StageContent
                icon={
                  <HugeiconsIcon
                    icon={Database01Icon}
                    size={15}
                    strokeWidth={2}
                  />
                }
                title="2 · MovSynerPos"
                subtitle="Pu_synerpos · 172.0.2.162"
                value={totals.in_mov}
                missing={lostMov}
                tone={lostMov > 0 ? "warn" : "ok"}
              />
            </div>
            <FlowArrow />
            <StagePopover
              stage="intelisis"
              title="Intelisis"
              summary={intelisisStage}
              enabled={intelisisEnabled}
              selectedState={intelisisSelected}
              open={openStage === "intelisis"}
              onOpenChange={(open) =>
                setOpenStage(open ? "intelisis" : null)
              }
              onSelect={(state) => handleSelect("intelisis", state)}
              onClear={intelisisSelected ? handleClear : undefined}
              triggerClassName={stageCardClass(
                true,
                selectedStage === "intelisis",
              )}
            >
              <StageContent
                icon={
                  <HugeiconsIcon
                    icon={Database02Icon}
                    size={15}
                    strokeWidth={2}
                  />
                }
                title="3 · Intelisis"
                subtitle="Punidas · 172.0.1.156 · SE-*"
                value={intelisisEnabled ? totals.in_intelisis : 0}
                missing={intelisisEnabled ? lostIntelisis : undefined}
                tone={
                  !intelisisEnabled
                    ? "muted"
                    : lostIntelisis > 0
                      ? "warn"
                      : "ok"
                }
                interactive
              />
            </StagePopover>
          </div>

          {/*
            SUNAT is deliberately outside the flow grid and has no arrow:
            SynerPOS submits vouchers to SUNAT through Factus in parallel.
            MovSynerPOS → Intelisis is a separate ERP registration path.
          */}
          <div className="flex flex-col border-t border-border/60 pt-3 lg:w-64 lg:border-t-0 lg:border-l lg:pl-3 lg:pt-0">
            <StagePopover
              stage="sunat"
              title="SUNAT"
              summary={sunatStage}
              enabled={sunatEnabled}
              selectedState={sunatSelected}
              open={openStage === "sunat"}
              onOpenChange={(open) => setOpenStage(open ? "sunat" : null)}
              onSelect={(state) => handleSelect("sunat", state)}
              onClear={sunatSelected ? handleClear : undefined}
              triggerClassName={stageCardClass(
                true,
                selectedStage === "sunat",
              )}
            >
              <StageContent
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
                interactive
              />
            </StagePopover>
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
