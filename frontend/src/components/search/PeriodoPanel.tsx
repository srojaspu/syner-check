import type { ReactNode } from "react";
import type { DateRange } from "react-day-picker";
import { HugeiconsIcon } from "@hugeicons/react";
import { CalendarDaysIcon, Loading02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateRangePicker } from "./DateRangePicker";

/**
 * Panel de periodo: rango de fechas, filtros extra y el boton "Consultar".
 *
 * Compartido por las dos pantallas (comprobantes de SynerPOS y comprobantes
 * Intelisis UFE). La diferencia entre ellas son los filtros extra: aca la
 * de SynerPOS anade el tipo de documento.
 *
 * Los filtros extra son **parametros de la consulta**: se aplican al pulsar
 * "Consultar", no filtran la tabla por si solos (como en la pantalla de
 * comprobantes).
 */
export function PeriodoPanel({
  range,
  onRange,
  onConsultar,
  loading = false,
  disabled = false,
  extra,
}: {
  range: DateRange | undefined;
  onRange: (range: DateRange | undefined) => void;
  onConsultar: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** Filtros extra entre el rango y el boton (tipo de documento). */
  extra?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-4">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          aria-hidden
        >
          <HugeiconsIcon icon={CalendarDaysIcon} size={18} strokeWidth={2} />
        </span>
        <DateRangePicker value={range} onChange={onRange} />
        {extra}
        <Button
          type="button"
          onClick={onConsultar}
          disabled={disabled || loading}
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
        </Button>
      </CardContent>
    </Card>
  );
}
