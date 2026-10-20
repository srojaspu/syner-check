import { useState, type ReactNode } from "react";
import type { DateRange } from "react-day-picker";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CalendarDaysIcon,
  HashIcon,
  Search01Icon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateRangePicker } from "./search/DateRangePicker";
import { ALL_TIPOS, TypeChips } from "./search/TypeChips";
import { toISODate } from "../api/format";

export { ALL_TIPOS, TypeChips };

export function defaultRange(): { start: string; end: string } {
  const today = toISODate(new Date());
  return { start: today, end: today };
}

function Panel({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-4">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          aria-hidden
        >
          {icon}
        </span>
        {children}
      </CardContent>
    </Card>
  );
}

export function RangePanel({
  disabled,
  onSearch,
}: {
  disabled: boolean;
  onSearch: (start: string, end: string, types: string) => void;
}) {
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const now = new Date();
    return { from: now, to: now };
  });
  const [tipos, setTipos] = useState<string[]>([...ALL_TIPOS]);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (disabled) return;
    if (!range?.from || !range?.to) {
      setError("Selecciona el rango completo (inicio y fin).");
      return;
    }
    if (!tipos.length) {
      setError("Selecciona al menos un tipo de documento.");
      return;
    }
    setError(null);
    onSearch(toISODate(range.from), toISODate(range.to), tipos.join(","));
  };

  return (
    <div className="flex flex-col gap-3">
      <Panel
        icon={<HugeiconsIcon icon={CalendarDaysIcon} size={18} strokeWidth={2} />}
      >
        <DateRangePicker value={range} onChange={setRange} />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Tipo de documento</span>
          <TypeChips values={tipos} onChange={setTipos} />
        </div>
        <Button
          type="button"
          className="sm:ml-auto"
          onClick={submit}
          disabled={disabled}
        >
          Consultar
        </Button>
      </Panel>
      {error ? (
        <Alert variant="destructive">
          <HugeiconsIcon icon={TriangleAlertIcon} strokeWidth={2} />
          <AlertTitle>Revisa los filtros</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Filtra por <b>rango de fechas + tipo de documento</b>. La consulta
        general usa campos resumidos para responder más rápido; abre un
        documento para cargar el detalle completo.
      </p>
    </div>
  );
}

export function NumberPanel({
  disabled,
  onSearch,
}: {
  disabled: boolean;
  onSearch: (number: string) => void;
}) {
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (disabled) return;
    if (!number.trim()) {
      setError("Ingresa un número.");
      return;
    }
    setError(null);
    onSearch(number.trim());
  };

  return (
    <div className="flex flex-col gap-3">
      <Panel icon={<HugeiconsIcon icon={HashIcon} size={18} strokeWidth={2} />}>
        <div className="flex min-w-52 flex-1 flex-col gap-1.5">
          <Label htmlFor="numero-comprobante">Número</Label>
          <Input
            id="numero-comprobante"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            disabled={disabled}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            placeholder="Ej. F001-00012345"
            autoComplete="off"
          />
        </div>
        <Button type="button" onClick={submit} disabled={disabled}>
          <HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={2} aria-hidden /> Buscar
        </Button>
      </Panel>
      {error ? (
        <Alert variant="destructive">
          <HugeiconsIcon icon={TriangleAlertIcon} strokeWidth={2} />
          <AlertTitle>Revisa los filtros</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Busca el comprobante por número en el índice local. Si no está indexado,
        se consulta GraphQL sobre el rango de los últimos días.
      </p>
    </div>
  );
}
