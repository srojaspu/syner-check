import { useState, type ReactNode } from "react";
import { CalendarDays, Hash, Search } from "lucide-react";
import { toISODate } from "../api/format";

export const ALL_TIPOS = ["FACTURA", "BOLETA", "NOTA DE CREDITO"] as const;

export function defaultRange(): { start: string; end: string } {
  const today = toISODate(new Date());
  return { start: today, end: today };
}

export function TypeChips({
  values,
  onChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const toggle = (tipo: string) => {
    onChange(
      values.includes(tipo)
        ? values.filter((value) => value !== tipo)
        : [...values, tipo],
    );
  };
  const labels: Record<string, string> = {
    FACTURA: "Factura",
    BOLETA: "Boleta",
    "NOTA DE CREDITO": "Nota de crédito",
  };
  return (
    <div className="type-options">
      {ALL_TIPOS.map((tipo) => (
        <label key={tipo} className="check-chip">
          <input
            type="checkbox"
            checked={values.includes(tipo)}
            onChange={() => toggle(tipo)}
          />
          <span>{labels[tipo]}</span>
        </label>
      ))}
    </div>
  );
}

function Panel({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="filters">
      <span className="panel-icon" aria-hidden>
        {icon}
      </span>
      {children}
    </div>
  );
}

export function RangePanel({
  disabled,
  onSearch,
}: {
  disabled: boolean;
  onSearch: (start: string, end: string, types: string) => void;
}) {
  const initial = defaultRange();
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [tipos, setTipos] = useState<string[]>([...ALL_TIPOS]);

  const submit = () => {
    if (!tipos.length) {
      alert("Selecciona al menos un tipo de documento.");
      return;
    }
    onSearch(start, end, tipos.join(","));
  };

  return (
    <div>
      <Panel icon={<CalendarDays size={18} />}>
        <label>
          Desde
          <input
            type="date"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={end}
            onChange={(event) => {
              setEnd(event.target.value);
              if (!start) setStart(event.target.value);
            }}
          />
        </label>
        <div className="filter-group">
          <span className="filter-label">Tipo de documento</span>
          <TypeChips values={tipos} onChange={setTipos} />
        </div>
        <div className="range-actions">
          <button
            type="button"
            className="btn primary"
            onClick={submit}
            disabled={disabled}
          >
            Consultar
          </button>
        </div>
      </Panel>
      <p className="hint">
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

  const submit = () => {
    if (!number.trim()) {
      alert("Ingresa un número.");
      return;
    }
    onSearch(number.trim());
  };

  return (
    <div>
      <Panel icon={<Hash size={18} />}>
        <label className="grow">
          Número
          <input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            placeholder="Ej. F001-00012345"
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          className="btn primary"
          onClick={submit}
          disabled={disabled}
        >
          <Search size={16} aria-hidden /> Buscar
        </button>
      </Panel>
      <p className="hint">
        Busca el comprobante por número en el índice local. Si no está indexado,
        se consulta GraphQL sobre el rango de los últimos días.
      </p>
    </div>
  );
}
