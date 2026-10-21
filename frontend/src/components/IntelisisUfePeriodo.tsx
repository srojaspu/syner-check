import type { DateRange } from "react-day-picker";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateRangePicker } from "@/components/search/DateRangePicker";

/**
 * Panel de periodo: rango y el boton "Consultar".
 *
 * La consulta solo sale de aqui: entrar en la pantalla no golpea el ERP.
 * Arranca en el dia de hoy, igual que la pantalla de comprobantes.
 */
export function IntelisisUfePeriodo({
  range,
  onRange,
  onConsultar,
  loading,
  periodoDistinto,
}: {
  range: DateRange | undefined;
  onRange: (range: DateRange | undefined) => void;
  onConsultar: () => void;
  loading: boolean;
  /** El periodo elegido es distinto del que se consulto. */
  periodoDistinto: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-4">
        <DateRangePicker value={range} onChange={onRange} label="Periodo" />
        <Button
          type="button"
          onClick={onConsultar}
          disabled={loading}
          className="sm:ml-auto"
        >
          {loading ? (
            <HugeiconsIcon
              icon={Loading02Icon}
              size={16}
              strokeWidth={2}
              className="animate-spin"
              aria-hidden
            />
          ) : null}{" "}
          Consultar
          {periodoDistinto && !loading ? (
            <span
              className="ml-1 size-1.5 rounded-full bg-current"
              aria-hidden
            />
          ) : null}
        </Button>
        {periodoDistinto && !loading ? (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            El periodo cambio: la tabla sigue mostrando el consultado
          </span>
        ) : null}
      </CardContent>
    </Card>
  );
}
