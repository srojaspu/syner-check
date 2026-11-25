import { Badge } from "@/components/ui/badge";
import type { PosNivel, PosSalud } from "../../api/types";

const NIVEL: Record<
  PosNivel,
  { label: string; variant: "secondary" | "destructive" | "outline"; className?: string }
> = {
  INFO: { label: "Info", variant: "secondary" },
  WARN: {
    label: "Advertencia",
    variant: "outline",
    className: "border-chart-4/60 bg-chart-4/15 text-foreground",
  },
  ERROR: { label: "Error", variant: "destructive" },
  UNKNOWN: { label: "Desconocido", variant: "outline" },
};

const SALUD: Record<
  PosSalud,
  { label: string; variant: "secondary" | "destructive" | "outline"; className?: string }
> = {
  OK: { label: "OK", variant: "secondary" },
  DEGRADED: {
    label: "Degradado",
    variant: "outline",
    className: "border-chart-4/60 bg-chart-4/15 text-foreground",
  },
  CRITICAL: { label: "Crítico", variant: "destructive" },
  NO_DATA: { label: "Sin datos", variant: "outline" },
};

export function PosLevelBadge({ nivel }: { nivel: PosNivel }) {
  const config = NIVEL[nivel] ?? NIVEL.UNKNOWN;
  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  );
}

export function PosHealthBadge({ salud }: { salud: PosSalud }) {
  const config = SALUD[salud] ?? SALUD.NO_DATA;
  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  );
}
