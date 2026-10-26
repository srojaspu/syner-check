import { useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ChevronDownIcon,
  CloudIcon,
  Database02Icon,
  FileValidationIcon,
  InformationCircleIcon,
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
  DERIVADO_DESC,
  DERIVADO_LABEL,
  DERIVADO_TONO,
  ERP_ESTADOS,
  ERP_ESTADO_DESC,
  ERP_ESTADO_LABEL,
  ERP_ESTADO_TONO,
  ESTADOS_SUNAT,
  ESTADO_GENERACION_DESC,
  ESTADO_GENERACION_LABEL,
  ESTADO_GENERACION_TONO,
  ESTADO_SUNAT_DESC,
  ESTADO_SUNAT_LABEL,
  ESTADO_SUNAT_TONO,
  type UfeTono,
} from "./IntelisisUfeEstados";
import type { IntelisisUfeFiltros, IntelisisUfeKpis } from "../api/types";

type Clave = "estatus" | "estado" | "sunat";

interface Segmento {
  key: string;
  label: string;
  count: number;
  tono: UfeTono;
  desc: string;
  /** Filtra la tabla en el servidor (solo estados que la API acepta). */
  filtrable?: boolean;
  /** Acción propia del segmento (abre el diálogo de ventas sin documentar). */
  accion?: "sin-documento";
}

const TONO_BARRA: Record<UfeTono, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-destructive",
  muted: "bg-muted-foreground/30",
  neutral: "bg-slate-500",
};

const PESO_TONO: Record<UfeTono, number> = {
  ok: 0,
  muted: 1,
  neutral: 2,
  warn: 3,
  bad: 4,
};

/** El peor tono presente resume la tarjeta en un solo punto de color. */
function peorTono(segmentos: Segmento[]): UfeTono {
  return segmentos.reduce<UfeTono>(
    (peor, segmento) =>
      PESO_TONO[segmento.tono] > PESO_TONO[peor] ? segmento.tono : peor,
    "ok",
  );
}

function cuenta(
  estados: { key: string; count: number }[] | undefined,
  key: string,
): number {
  return estados?.find((item) => item.key === key)?.count ?? 0;
}

function porcentaje(count: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

function numero(valor: number): string {
  return valor.toLocaleString("es-PE");
}

function FilaSegmento({
  segmento,
  total,
  activo,
  onFiltrar,
  onSinDocumento,
  onCerrar,
}: {
  segmento: Segmento;
  total: number;
  activo: boolean;
  onFiltrar: (key: string) => void;
  onSinDocumento?: () => void;
  onCerrar: () => void;
}) {
  const contenido = (
    <>
      <span className="flex min-w-0 items-start gap-2">
        <span
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            TONO_BARRA[segmento.tono],
          )}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="block text-sm leading-snug">
            {segmento.label}
            {activo ? (
              <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                filtro
              </span>
            ) : null}
          </span>
          <span className="block text-xs leading-snug text-muted-foreground">
            {segmento.desc}
          </span>
          {segmento.accion === "sin-documento" && onSinDocumento ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-1.5 h-7 w-fit"
              onClick={() => {
                onCerrar();
                onSinDocumento();
              }}
            >
              Ver ventas sin documentar
            </Button>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-sm font-medium tabular-nums">
          {numero(segmento.count)}
        </span>
        <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
          {porcentaje(segmento.count, total)}
        </span>
      </span>
    </>
  );

  const claseFila =
    "flex items-start justify-between gap-3 rounded-lg px-2.5 py-2 text-left";

  if (segmento.filtrable) {
    return (
      <button
        type="button"
        aria-pressed={activo}
        onClick={() => {
          onFiltrar(segmento.key);
          onCerrar();
        }}
        className={cn(
          claseFila,
          "transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          activo && "bg-muted",
        )}
      >
        {contenido}
      </button>
    );
  }

  return <div className={claseFila}>{contenido}</div>;
}

/**
 * Tarjeta de un eje: número grande, puente con el otro universo, barra
 * segmentada y leyenda completa. Toda la interacción vive en el popover.
 */
function TarjetaEje({
  titulo,
  subtitulo,
  icono,
  valor,
  puente,
  segmentos,
  total,
  unidad,
  seleccionado,
  onSeleccionar,
  onLimpiar,
  onSinDocumento,
  pie,
  notaPie,
  vacio,
  loading,
  abierto,
  onAbierto,
}: {
  titulo: string;
  subtitulo: string;
  icono: ReactNode;
  valor: number;
  puente: string;
  segmentos: Segmento[];
  total: number;
  unidad: "ventas" | "documentos";
  seleccionado?: string;
  onSeleccionar: (key: string) => void;
  onLimpiar: () => void;
  onSinDocumento?: () => void;
  pie?: ReactNode;
  notaPie?: string;
  vacio: string;
  loading?: boolean;
  abierto: boolean;
  onAbierto: (open: boolean) => void;
}) {
  const etiquetaSeleccionada = segmentos.find(
    (segmento) => segmento.key === seleccionado,
  )?.label;
  const visibles = segmentos.filter((segmento) => segmento.count > 0);
  const tono = visibles.length ? peorTono(visibles) : "muted";

  return (
    <Popover open={abierto && !loading} onOpenChange={onAbierto}>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={loading}
            aria-label={`${titulo}: ver desglose`}
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
            <span
              className={`size-2 rounded-full ${TONO_BARRA[tono]}`}
              aria-hidden
            />
            <HugeiconsIcon
              icon={ChevronDownIcon}
              size={14}
              strokeWidth={2}
              aria-hidden
            />
          </span>
        </span>

        {loading ? (
          <Skeleton className="h-7 w-16" aria-hidden />
        ) : (
          <b className="text-2xl leading-tight tabular-nums">
            {numero(valor)}
          </b>
        )}

        <span className="text-xs leading-snug text-muted-foreground">
          {loading ? "Calculando…" : puente}
        </span>

        {!loading && visibles.length && total > 0 ? (
          <span
            className="mt-0.5 flex h-1.5 overflow-hidden rounded-full bg-muted"
            aria-hidden
          >
            {visibles.map((segmento) => (
              <span
                key={segmento.key}
                className={TONO_BARRA[segmento.tono]}
                style={{ width: `${(segmento.count / total) * 100}%` }}
              />
            ))}
          </span>
        ) : null}

        {!loading && visibles.length ? (
          <span className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
            {visibles.map((segmento) => (
              <span
                key={segmento.key}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    TONO_BARRA[segmento.tono],
                  )}
                  aria-hidden
                />
                <span className="whitespace-nowrap">{segmento.label}</span>
                <span className="font-medium tabular-nums text-foreground">
                  {numero(segmento.count)}
                </span>
              </span>
            ))}
          </span>
        ) : null}

        {seleccionado ? (
          <Badge variant="secondary" className="mt-0.5 w-fit">
            Filtro: {etiquetaSeleccionada ?? seleccionado}
          </Badge>
        ) : null}
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[min(24rem,calc(100vw-1rem))] p-3"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <p className="font-medium">{titulo} · desglose</p>
              <p className="text-xs text-muted-foreground">
                {numero(total)} {unidad}
              </p>
            </div>
          </div>

          {segmentos.length ? (
            <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto pr-1">
              {segmentos.map((segmento) => (
                <FilaSegmento
                  key={segmento.key}
                  segmento={segmento}
                  total={total}
                  activo={segmento.key === seleccionado}
                  onFiltrar={onSeleccionar}
                  onSinDocumento={onSinDocumento}
                  onCerrar={() => onAbierto(false)}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs leading-snug text-muted-foreground">
              {vacio}
            </p>
          )}

          {pie ? (
            <p className="border-t border-border/60 pt-2 text-[11px] leading-snug text-muted-foreground">
              {pie}
            </p>
          ) : null}

          {notaPie ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {notaPie}
            </p>
          ) : null}

          {seleccionado ? (
            <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
              <p className="text-[11px] leading-snug text-muted-foreground">
                Filtro aplicado en la tabla.
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onLimpiar();
                  onAbierto(false);
                }}
              >
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
 * El número grande es el total del eje y la leyenda muestra el desglose
 * completo (no solo el conteo sano). El ERP cuenta los cuatro estados de
 * `dbo.Venta`; la grilla, en cambio, solo puede devolver CONCLUIDO y
 * PENDIENTE, y por eso solo esos dos ofrecen filtro.
 */
export function IntelisisUfeFlujo({
  kpis,
  filtros,
  onAlternar,
  onLimpiar,
  onSinDocumento,
  loading,
}: {
  kpis: IntelisisUfeKpis;
  filtros: IntelisisUfeFiltros;
  onAlternar: (clave: Clave, valor: string) => void;
  onLimpiar: () => void;
  onSinDocumento?: () => void;
  loading?: boolean;
}) {
  const [abierto, setAbierto] = useState<Clave | null>(null);

  const documentos = kpis.total;
  const totalVentas = kpis.total_ventas ?? documentos;
  const consultables = kpis.sunat_consultables ?? documentos;

  // Solo los estados que la grilla puede devolver filtran: ofrecer
  // SINAFECTAR o CANCELADO daria cero filas y pareceria un error.
  const listado = kpis.por_estatus_listado?.length
    ? kpis.por_estatus_listado
    : (kpis.por_estatus ?? []).filter(
        (item) => item.key === "CONCLUIDO" || item.key === "PENDIENTE",
      );
  const filtrablesErp = new Set(listado.map((item) => item.key));

  const erpSegmentos: Segmento[] = ERP_ESTADOS.map((key) => ({
    key,
    label: ERP_ESTADO_LABEL[key],
    count: cuenta(kpis.por_estatus, key),
    tono: ERP_ESTADO_TONO[key],
    desc: ERP_ESTADO_DESC[key],
    filtrable: filtrablesErp.has(key),
    accion: key === "SINAFECTAR" ? "sin-documento" : undefined,
  }));

  const generacion = (key: string) => cuenta(kpis.por_estado_generacion, key);
  const tecnico = (
    key: keyof typeof ESTADO_GENERACION_LABEL,
  ): Segmento => ({
    key,
    label: ESTADO_GENERACION_LABEL[key],
    count: generacion(key),
    tono: ESTADO_GENERACION_TONO[key],
    desc: ESTADO_GENERACION_DESC[key],
    filtrable: generacion(key) > 0,
  });
  const derivado = (
    key: keyof typeof DERIVADO_LABEL,
    count: number,
  ): Segmento => ({
    key,
    label: DERIVADO_LABEL[key],
    count,
    tono: DERIVADO_TONO[key],
    desc: DERIVADO_DESC[key],
    // No son estados del generador: la API no los acepta como filtro.
    filtrable: false,
  });

  const validadorSegmentos = [
    tecnico("generado"),
    tecnico("en_proceso"),
    derivado("sin_traza", kpis.sin_traza),
    tecnico("error_validacion"),
    tecnico("omitido_validacion"),
    tecnico("sin_bloque"),
    derivado("pendientes_conclusion", kpis.pendientes_conclusion),
    derivado("en_espera", kpis.en_espera),
    tecnico("fuera_de_bitacora"),
    derivado("no_aplica", kpis.no_aplica),
  ].filter((segmento) => segmento.count > 0);

  const sunatSegmentos: Segmento[] = ESTADOS_SUNAT.map((key) => ({
    key,
    label: ESTADO_SUNAT_LABEL[key],
    count: cuenta(kpis.por_estado_sunat, key),
    tono: ESTADO_SUNAT_TONO[key],
    desc: ESTADO_SUNAT_DESC[key],
    filtrable: cuenta(kpis.por_estado_sunat, key) > 0,
  })).filter((segmento) => segmento.count > 0);

  const generados = generacion("generado");
  const aceptados = cuenta(kpis.por_estado_sunat, "ACEPTADO");

  return (
    <section aria-label="Estado por eje" className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-3">
        <TarjetaEje
          titulo="Intelisis"
          subtitulo="Ventas del período · origen Intelisis"
          icono={
            <HugeiconsIcon icon={Database02Icon} size={15} strokeWidth={2} />
          }
          valor={totalVentas}
          puente={
            totalVentas
              ? `${numero(documentos)} documentos electrónicos`
              : "Sin ventas en el período"
          }
          segmentos={erpSegmentos}
          total={totalVentas}
          unidad="ventas"
          seleccionado={filtros.estatus}
          onSeleccionar={(key) => onAlternar("estatus", key)}
          onLimpiar={onLimpiar}
          onSinDocumento={onSinDocumento}
          pie={
            totalVentas
              ? `${numero(documentos)} de ${numero(totalVentas)} ventas tienen comprobante electrónico`
              : undefined
          }
          vacio="Sin ventas en el período."
          loading={loading}
          abierto={abierto === "estatus"}
          onAbierto={(open) => setAbierto(open ? "estatus" : null)}
        />
        <TarjetaEje
          titulo="Validador"
          subtitulo="Generador UFE · solo ventas ERP"
          icono={
            <HugeiconsIcon icon={FileValidationIcon} size={15} strokeWidth={2} />
          }
          valor={generados}
          puente={
            documentos
              ? `${numero(generados)} de ${numero(documentos)} documentos generados`
              : "Sin documentos en el período"
          }
          segmentos={validadorSegmentos}
          total={documentos}
          unidad="documentos"
          seleccionado={filtros.estado}
          onSeleccionar={(key) => onAlternar("estado", key)}
          onLimpiar={onLimpiar}
          notaPie="Los estados derivados no filtran la tabla."
          vacio="Sin documentos en el período."
          loading={loading}
          abierto={abierto === "estado"}
          onAbierto={(open) => setAbierto(open ? "estado" : null)}
        />
        <TarjetaEje
          titulo="SUNAT"
          subtitulo="Validación electrónica"
          icono={<HugeiconsIcon icon={CloudIcon} size={15} strokeWidth={2} />}
          valor={aceptados}
          puente={`${numero(aceptados)} de ${numero(consultables)} consultables`}
          segmentos={sunatSegmentos}
          total={documentos}
          unidad="documentos"
          seleccionado={filtros.sunat}
          onSeleccionar={(key) => onAlternar("sunat", key)}
          onLimpiar={onLimpiar}
          vacio="Nada que consultar en el período."
          loading={loading}
          abierto={abierto === "sunat"}
          onAbierto={(open) => setAbierto(open ? "sunat" : null)}
        />
      </div>
      <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
        <span className="mt-0.5 shrink-0">
          <HugeiconsIcon
            icon={InformationCircleIcon}
            size={13}
            strokeWidth={2}
            aria-hidden
          />
        </span>
        No incluye ventas de SynerPOS (SE-*): esas se controlan en la pestaña
        SynerPos.
      </p>
    </section>
  );
}
