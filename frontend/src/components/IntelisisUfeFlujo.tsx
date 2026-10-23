import { useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ChevronDownIcon,
  CloudIcon,
  Database02Icon,
  FileValidationIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ESTADOS_GENERACION,
  ESTADOS_SUNAT,
  ESTADO_GENERACION_LABEL,
  ESTADO_SUNAT_LABEL,
} from "./IntelisisUfeEstados";
import type { IntelisisUfeFiltros, IntelisisUfeKpis } from "../api/types";

type Clave = "estatus" | "estado" | "sunat";
type Tono = "ok" | "warn" | "muted";

interface EstadoConteo {
  key: string;
  count: number;
}

function dotClass(tono: Tono): string {
  if (tono === "ok") return "bg-emerald-500";
  if (tono === "warn") return "bg-amber-500";
  return "bg-muted-foreground/40";
}

function tonoDe(pendientes: number, total: number): Tono {
  if (total === 0) return "muted";
  return pendientes > 0 ? "warn" : "ok";
}

/**
 * Ordena el desglose por el ciclo de vida y descarta los estados vacios.
 * Los estados que el backend devuelva y no esten en el orden van al final.
 */
function ordenar(
  estados: EstadoConteo[],
  orden: readonly string[],
): EstadoConteo[] {
  const conteo = new Map(estados.map((item) => [item.key, item.count]));
  const conocidos = orden.map((key) => ({ key, count: conteo.get(key) ?? 0 }));
  const extra = estados.filter((item) => !orden.includes(item.key));
  return [...conocidos, ...extra].filter((item) => item.count > 0);
}

function cuenta(estados: EstadoConteo[], key: string): number {
  return estados.find((item) => item.key === key)?.count ?? 0;
}

function TarjetaEje({
  titulo,
  subtitulo,
  icono,
  valor,
  pista,
  tono,
  estados,
  etiqueta,
  seleccionado,
  onSeleccionar,
  onLimpiar,
  loading,
  abierto,
  onAbierto,
}: {
  titulo: string;
  subtitulo: string;
  icono: ReactNode;
  valor: number;
  pista: string;
  tono: Tono;
  estados: EstadoConteo[];
  etiqueta: (key: string) => string;
  seleccionado?: string;
  onSeleccionar: (key: string) => void;
  onLimpiar: () => void;
  loading?: boolean;
  abierto: boolean;
  onAbierto: (open: boolean) => void;
}) {
  return (
    <Popover open={abierto && !loading} onOpenChange={onAbierto}>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={loading}
            aria-label={`${titulo}: ver estados`}
            aria-pressed={Boolean(seleccionado)}
            className={cn(
              "flex min-w-0 flex-col gap-1.5 rounded-2xl border border-border/60 bg-card p-4 text-left transition-colors",
              "hover:border-border hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              "disabled:cursor-not-allowed disabled:opacity-70",
              seleccionado && "border-primary/40 bg-muted/40",
            )}
          />
        }
      >
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted"
            aria-hidden
          >
            {icono}
          </span>
          <span className="min-w-0">
            <b className="block truncate text-foreground">{titulo}</b>
            <span className="block truncate">{subtitulo}</span>
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <span className={`size-2 rounded-full ${dotClass(tono)}`} aria-hidden />
            <HugeiconsIcon
              icon={ChevronDownIcon}
              size={14}
              strokeWidth={2}
              aria-hidden
            />
          </span>
        </span>

        {loading ? (
          <Skeleton className="h-7 w-12" aria-hidden />
        ) : (
          <b className="text-2xl leading-tight tabular-nums">
            {valor.toLocaleString("es-PE")}
          </b>
        )}

        <span className="text-xs leading-snug text-muted-foreground">
          {pista}
        </span>

        {seleccionado ? (
          <Badge variant="secondary" className="w-fit">
            Filtro: {etiqueta(seleccionado)}
          </Badge>
        ) : null}
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[min(22rem,calc(100vw-1rem))] p-3"
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="font-medium">{titulo} · estados</p>
            <p className="text-xs text-muted-foreground">
              Selecciona un estado para filtrar la tabla.
            </p>
          </div>

          {estados.length ? (
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
              {estados.map((estado) => {
                const activo = estado.key === seleccionado;
                return (
                  <button
                    key={estado.key}
                    type="button"
                    aria-pressed={activo}
                    onClick={() => onSeleccionar(estado.key)}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                      "hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      activo && "bg-muted font-medium",
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {etiqueta(estado.key)}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {activo ? (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Filtro
                        </span>
                      ) : null}
                      <Badge
                        variant={activo ? "secondary" : "outline"}
                        className="tabular-nums"
                      >
                        {estado.count}
                      </Badge>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs leading-snug text-muted-foreground">
              No hay documentos en este periodo. Elige otro rango y consulta de
              nuevo.
            </p>
          )}

          {seleccionado ? (
            <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
              <p className="text-[11px] leading-snug text-muted-foreground">
                Filtro aplicado en la tabla.
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={onLimpiar}>
                Quitar filtro
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Estado del periodo por eje: Intelisis (ERP), Validador y SUNAT.
 *
 * Cada tarjeta resume el eje con su conteo sano y abre un popover con el
 * desglose de estados; elegir uno filtra la tabla. Es el mismo patron del
 * "Flujo" de la pestana Comprobantes, acotado a los tres ejes del UFE.
 */
export function IntelisisUfeFlujo({
  kpis,
  filtros,
  onAlternar,
  onLimpiar,
  loading,
}: {
  kpis: IntelisisUfeKpis;
  filtros: IntelisisUfeFiltros;
  onAlternar: (clave: Clave, valor: string) => void;
  onLimpiar: () => void;
  loading?: boolean;
}) {
  const [abierto, setAbierto] = useState<Clave | null>(null);

  const erp = ordenar(kpis.por_estatus ?? [], []);
  const validador = ordenar(kpis.por_estado_generacion ?? [], ESTADOS_GENERACION);
  const sunat = ordenar(kpis.por_estado_sunat ?? [], ESTADOS_SUNAT);

  const total = kpis.total;
  const concluidos = cuenta(erp, "CONCLUIDO");
  const generados = cuenta(validador, "generado");
  const aceptados = cuenta(sunat, "ACEPTADO");

  const pendientesErp = Math.max(total - concluidos, 0);
  const pendientesValidador = Math.max(total - generados - kpis.no_aplica, 0);
  const pendientesSunat = Math.max(total - aceptados, 0);

  const pistaErp = total
    ? pendientesErp
      ? `${pendientesErp} fuera de CONCLUIDO`
      : "Todos concluidos"
    : "Sin documentos";

  const pistaValidador = total
    ? [
        kpis.sin_traza ? `${kpis.sin_traza} sin traza` : "",
        kpis.no_aplica ? `${kpis.no_aplica} no aplica` : "",
      ]
        .filter(Boolean)
        .join(" · ") ||
      (pendientesValidador
        ? `${pendientesValidador} sin OK`
        : "Todos generados")
    : "Sin documentos";

  const pistaSunat = total
    ? kpis.sin_cobertura_sunat === total
      ? "Sin consultas registradas"
      : kpis.sin_cobertura_sunat
        ? `${kpis.sin_cobertura_sunat} sin consultar`
        : `${aceptados} aceptados`
    : "Sin documentos";

  return (
    <section aria-label="Estado por eje" className="grid gap-3 sm:grid-cols-3">
      <TarjetaEje
        titulo="Intelisis"
        subtitulo="Estatus de la venta (ERP)"
        icono={<HugeiconsIcon icon={Database02Icon} size={15} strokeWidth={2} />}
        valor={concluidos}
        pista={pistaErp}
        tono={tonoDe(pendientesErp, total)}
        estados={erp}
        etiqueta={(key) => key}
        seleccionado={filtros.estatus}
        onSeleccionar={(key) => onAlternar("estatus", key)}
        onLimpiar={onLimpiar}
        loading={loading}
        abierto={abierto === "estatus"}
        onAbierto={(open) => setAbierto(open ? "estatus" : null)}
      />
      <TarjetaEje
        titulo="Validador"
        subtitulo="Estado del generador UFE"
        icono={
          <HugeiconsIcon icon={FileValidationIcon} size={15} strokeWidth={2} />
        }
        valor={generados}
        pista={pistaValidador}
        tono={tonoDe(pendientesValidador, total)}
        estados={validador}
        etiqueta={(key) =>
          ESTADO_GENERACION_LABEL[key as keyof typeof ESTADO_GENERACION_LABEL] ??
          key
        }
        seleccionado={filtros.estado}
        onSeleccionar={(key) => onAlternar("estado", key)}
        onLimpiar={onLimpiar}
        loading={loading}
        abierto={abierto === "estado"}
        onAbierto={(open) => setAbierto(open ? "estado" : null)}
      />
      <TarjetaEje
        titulo="SUNAT"
        subtitulo="Validación electrónica"
        icono={<HugeiconsIcon icon={CloudIcon} size={15} strokeWidth={2} />}
        valor={aceptados}
        pista={pistaSunat}
        tono={tonoDe(pendientesSunat, total)}
        estados={sunat}
        etiqueta={(key) =>
          ESTADO_SUNAT_LABEL[key as keyof typeof ESTADO_SUNAT_LABEL] ?? key
        }
        seleccionado={filtros.sunat}
        onSeleccionar={(key) => onAlternar("sunat", key)}
        onLimpiar={onLimpiar}
        loading={loading}
        abierto={abierto === "sunat"}
        onAbierto={(open) => setAbierto(open ? "sunat" : null)}
      />
    </section>
  );
}
