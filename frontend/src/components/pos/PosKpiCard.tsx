import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function PosKpiCard({
  label,
  value,
  hint,
  alerta = false,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  alerta?: boolean;
}) {
  return (
    <Card className={alerta ? "border-destructive/40" : undefined}>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {hint ? (
          <span className="text-[11px] leading-tight text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}
