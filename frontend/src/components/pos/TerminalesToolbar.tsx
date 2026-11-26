import { HugeiconsIcon } from "@hugeicons/react";
import { CalendarDaysIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RANGOS, type RangoId } from "./rangos";

export function TerminalesToolbar({
  rango,
  onRango,
}: {
  rango: RangoId;
  onRango: (rango: RangoId) => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-1.5 p-3">
        <HugeiconsIcon
          icon={CalendarDaysIcon}
          size={16}
          strokeWidth={2}
          className="mr-1 text-muted-foreground"
          aria-hidden
        />
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Rango de la ventana"
        >
          {RANGOS.map((item) => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={item.id === rango ? "default" : "outline"}
              aria-pressed={item.id === rango}
              onClick={() => onRango(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
