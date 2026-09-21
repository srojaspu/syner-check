import { useState } from "react";
import { format, startOfMonth, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { HugeiconsIcon } from "@hugeicons/react";
import { CalendarDaysIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

function formatDay(date: Date): string {
  return format(date, "dd/MM/yyyy", { locale: es });
}

/**
 * Range picker: trigger button + popover calendar.
 * Owns only the popover open state; the selected range is fully controlled
 * by the parent. A day-picker "deselect" (undefined) is ignored so the last
 * valid selection is never wiped by an accidental click.
 */
export function DateRangePicker({
  value,
  onChange,
  label = "Rango de fechas",
}: {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button variant="outline" aria-label="Elegir rango de fechas" />
          }
        >
          <HugeiconsIcon
            icon={CalendarDaysIcon}
            size={16}
            strokeWidth={2}
            aria-hidden
          />
          {value?.from && value?.to
            ? `${formatDay(value.from)} – ${formatDay(value.to)}`
            : "Elegir fechas"}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            numberOfMonths={2}
            locale={es}
            selected={value}
            onSelect={(next) => {
              if (next) onChange(next);
            }}
            // Two visible months: previous + current (day-picker renders
            // defaultMonth and the month after it).
            defaultMonth={startOfMonth(subMonths(value?.from ?? new Date(), 1))}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
