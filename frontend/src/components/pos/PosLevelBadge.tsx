import { Badge } from "@/components/ui/badge";
import type { PosNivel } from "../../api/types";

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

export function PosLevelBadge({ nivel }: { nivel: PosNivel }) {
  const config = NIVEL[nivel] ?? NIVEL.UNKNOWN;
  return (
    <Badge variant={config.variant} className={config.className}>
      {config.label}
    </Badge>
  );
}
