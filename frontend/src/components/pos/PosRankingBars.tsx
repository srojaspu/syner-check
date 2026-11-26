import { cn } from "cn";
import { numeroFmt } from "./format";

export type PosRankingTone = "neutral" | "ok" | "warn" | "critical";

export interface PosRankingItem {
  label: string;
  value: number;
  hint?: string;
  tone?: PosRankingTone;
}

const TONE_BAR: Record<PosRankingTone, string> = {
  neutral: "bg-chart-2",
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  critical: "bg-destructive",
};

/**
 * Ranking horizontal simple (sin librería de gráficos) para resumir
 * distribuciones del periodo: instancias, fallas o resultados de venta.
 */
export function PosRankingBars({
  items,
  emptyLabel,
  label,
  limit = 6,
}: {
  items: PosRankingItem[];
  emptyLabel: string;
  label: string;
  limit?: number;
}) {
  const visible = items.filter((item) => item.value > 0).slice(0, limit);
  if (visible.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  const max = Math.max(1, ...visible.map((item) => item.value));

  return (
    <ul className="flex flex-col gap-2.5" aria-label={label}>
      {visible.map((item) => {
        const tone = item.tone ?? "neutral";
        return (
          <li
            key={item.label}
            className="flex flex-col gap-1"
            title={`${item.label}: ${numeroFmt.format(item.value)}`}
          >
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate font-medium">{item.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {numeroFmt.format(item.value)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", TONE_BAR[tone])}
                style={{
                  width: `${(item.value / max) * 100}%`,
                  minWidth: "2px",
                }}
              />
            </div>
            {item.hint ? (
              <span className="truncate text-[10px] text-muted-foreground">
                {item.hint}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
