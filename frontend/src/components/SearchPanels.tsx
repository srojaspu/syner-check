import { useMemo, useState, type ReactNode } from "react";
import type { DateRange } from "react-day-picker";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  HashIcon,
  Loading02Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NotificationHost,
  type NotificationItem,
} from "./NotificationCenter";
import { PeriodoPanel } from "./search/PeriodoPanel";
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
  const [errorSeq, setErrorSeq] = useState(0);

  const submit = () => {
    if (disabled) return;
    if (!range?.from || !range?.to) {
      setErrorSeq((n) => n + 1);
      setError("Selecciona el rango completo (inicio y fin).");
      return;
    }
    if (!tipos.length) {
      setErrorSeq((n) => n + 1);
      setError("Selecciona al menos un tipo de documento.");
      return;
    }
    setError(null);
    onSearch(toISODate(range.from), toISODate(range.to), tipos.join(","));
  };

  const notificationItems = useMemo<NotificationItem[]>(() => {
    if (!error) return [];
    return [
      {
        id: "range-panel-error",
        signature: `range-error:${error}:${errorSeq}`,
        tone: "error",
        onDismiss: () => setError(null),
        title: "Revisa los filtros",
        description: error,
      },
    ];
  }, [error, errorSeq]);

  return (
    <div className="flex flex-col gap-3">
      <PeriodoPanel
        range={range}
        onRange={(nextRange) => {
          setError(null);
          setRange(nextRange);
        }}
        onConsultar={submit}
        disabled={disabled}
        extra={
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Tipo de documento</span>
            <TypeChips
              values={tipos}
              onChange={(nextTipos) => {
                setError(null);
                setTipos(nextTipos);
              }}
            />
          </div>
        }
      />
      <p className="text-sm text-muted-foreground">
        Filtra por <b>rango de fechas + tipo de documento</b>. La consulta
        general usa campos resumidos para responder más rápido; abre un
        documento para cargar el detalle completo.
      </p>
      <NotificationHost items={notificationItems} />
    </div>
  );
}

export function NumberPanel({
  disabled = false,
  loading = false,
  onSearch,
  label = "Número",
  placeholder = "Ej. F001-00012345",
  hint,
}: {
  disabled?: boolean;
  /** Busqueda en curso: deshabilita y muestra el indicador. */
  loading?: boolean;
  onSearch: (number: string) => void;
  label?: string;
  placeholder?: string;
  hint?: string;
}) {
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorSeq, setErrorSeq] = useState(0);
  const ocupado = disabled || loading;

  const submit = () => {
    if (ocupado) return;
    if (!number.trim()) {
      setErrorSeq((n) => n + 1);
      setError("Ingresa un número.");
      return;
    }
    setError(null);
    onSearch(number.trim());
  };

  const notificationItems = useMemo<NotificationItem[]>(() => {
    if (!error) return [];
    return [
      {
        id: "number-panel-error",
        signature: `number-error:${error}:${errorSeq}`,
        tone: "error",
        onDismiss: () => setError(null),
        title: "Revisa los filtros",
        description: error,
      },
    ];
  }, [error, errorSeq]);

  return (
    <div className="flex flex-col gap-3">
      <Panel icon={<HugeiconsIcon icon={HashIcon} size={18} strokeWidth={2} />}>
        <div className="flex min-w-52 flex-1 flex-col gap-1.5">
          <Label htmlFor="numero-comprobante">{label}</Label>
          <Input
            id="numero-comprobante"
            value={number}
            onChange={(event) => {
              setError(null);
              setNumber(event.target.value);
            }}
            disabled={ocupado}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            placeholder={placeholder}
            autoComplete="off"
          />
        </div>
        <Button
          type="button"
          onClick={submit}
          disabled={ocupado}
          aria-busy={loading}
        >
          <HugeiconsIcon
            icon={loading ? Loading02Icon : Search01Icon}
            size={16}
            strokeWidth={2}
            className={loading ? "animate-spin" : undefined}
            aria-hidden
          />{" "}
          {loading ? "Buscando…" : "Buscar"}
        </Button>
      </Panel>
      {loading ? (
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          Buscando el comprobante en Intelisis…
        </p>
      ) : null}
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      <NotificationHost items={notificationItems} />
    </div>
  );
}
