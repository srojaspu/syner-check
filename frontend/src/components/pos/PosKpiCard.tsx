import type { ReactNode } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";

export type PosKpiTone = "ok" | "warn" | "critical" | "caja" | "nuc";

const TONE_DOT: Record<PosKpiTone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  critical: "bg-destructive",
  caja: "bg-orange-500",
  nuc: "bg-sky-500",
};

const TONE_ACTIVE: Record<PosKpiTone, string> = {
  ok: "border-emerald-500/60 bg-emerald-500/5 ring-1 ring-emerald-500/30",
  warn: "border-amber-500/60 bg-amber-500/5 ring-1 ring-amber-500/30",
  critical: "border-destructive/60 bg-destructive/5 ring-1 ring-destructive/30",
  caja: "border-orange-500/60 bg-orange-500/5 ring-1 ring-orange-500/30",
  nuc: "border-sky-500/60 bg-sky-500/5 ring-1 ring-sky-500/30",
};

export function PosKpiCard({
  label,
  value,
  hint,
  icon,
  tone = "ok",
  alerta = false,
  active = false,
  compact = false,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: PosKpiTone;
  alerta?: boolean;
  active?: boolean;
  compact?: boolean;
  onClick?: () => void;
}) {
  const interactive = typeof onClick === "function";
  const classes = cn(
    "flex min-w-0 flex-col justify-between gap-1.5 rounded-xl border border-border/70 bg-card text-left transition-colors",
    compact ? "p-3" : "p-4",
    alerta && !active && "border-destructive/40",
    interactive &&
      "cursor-pointer hover:border-foreground/25 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    active && TONE_ACTIVE[tone],
  );

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? (
            <span
              className={cn(
                "flex shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/80",
                compact ? "size-6" : "size-7",
              )}
              aria-hidden
            >
              {icon}
            </span>
          ) : null}
          <span className="line-clamp-2 text-xs font-medium leading-tight text-muted-foreground">
            {label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          {active ? (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
              Filtro
            </Badge>
          ) : null}
          <span
            className={cn("size-2 rounded-full", TONE_DOT[tone])}
            aria-hidden
          />
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <span
          className={cn(
            "font-semibold tracking-tight tabular-nums text-foreground",
            compact ? "text-xl" : "text-2xl",
          )}
        >
          {value}
        </span>
      </div>

      {hint ? (
        <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={classes}
      >
        {content}
      </button>
    );
  }

  return <div className={classes}>{content}</div>;
}
