import { cn } from "cn";
import type { IntelisisUfeFiltros, IntelisisUfeKpis } from "../api/types";

/** Una cifra del resumen. Si es pulsable, acts como filtro. */
export function KpiTile({
  label,
  value,
  hint,
  tone = "neutral",
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "neutral" | "alert";
  active?: boolean;
  onClick?: () => void;
}) {
  const contenido = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "alert" && value > 0 && "text-destructive",
        )}
      >
        {value.toLocaleString("es-PE")}
      </p>
      {hint ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </>
  );
  if (!onClick) {
    return (
      <div className="rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/10">
        {contenido}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? "Quitar este filtro" : `Filtrar por ${label.toLowerCase()}`}
      className={cn(
        "rounded-2xl bg-card px-4 py-3 text-left ring-1 outline-none transition-shadow",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active
          ? "ring-2 ring-foreground/40"
          : "ring-foreground/10 hover:ring-foreground/25",
      )}
    >
      {contenido}
    </button>
  );
}

/**
 * Resumen del periodo. Las cifras son filtros: al pulsarlas dejan el
 * filtro preparado (se aplica al pulsar "Consultar").
 */
export function IntelisisUfeKpis({
  kpis,
  filtros,
  onAlternar,
  onLimpiar,
}: {
  kpis: IntelisisUfeKpis;
  filtros: IntelisisUfeFiltros;
  onAlternar: (clave: "resultado" | "generador" | "sunat", valor: string) => void;
  onLimpiar: () => void;
}) {
  return (
    <section
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      aria-label="Resumen del periodo"
    >
      <KpiTile
        label="Emitidos"
        value={kpis.total}
        active={!filtros.resultado && !filtros.generador}
        onClick={onLimpiar}
      />
      <KpiTile
        label="Conformes"
        value={kpis.conformes}
        hint={`${kpis.con_incidencia} por revisar`}
        active={filtros.resultado === "CONFORME"}
        onClick={() => onAlternar("resultado", "CONFORME")}
      />
      <KpiTile
        label="Con incidencia"
        value={kpis.con_incidencia}
        tone="alert"
        active={filtros.resultado === "REVISAR"}
        onClick={() => onAlternar("resultado", "REVISAR")}
      />
      <KpiTile
        label="Sin traza"
        value={kpis.sin_traza}
        hint={`${kpis.en_espera} en espera · ${kpis.no_aplica} no aplica`}
        active={filtros.generador === "SIN TRAZA"}
        onClick={() => onAlternar("generador", "SIN TRAZA")}
      />
      <KpiTile
        label="Sin cobertura SUNAT"
        value={kpis.sin_cobertura_sunat}
        hint="sin consultar"
        active={filtros.sunat === "SUNAT SIN CONSULTA"}
        onClick={() => onAlternar("sunat", "SUNAT SIN CONSULTA")}
      />
    </section>
  );
}
