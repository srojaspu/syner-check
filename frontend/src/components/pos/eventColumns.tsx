import type { ColumnDef } from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fmtFecha } from "./format";
import type { EnrichedPosLog } from "./posAnalytics";
import { shortEventLabel } from "./posCatalog";

/**
 * Columnas del Registro de eventos. Usa el mismo DataTable (TanStack) que la
 * pestaña de comprobantes: ordenamiento por cabecera, paginación y fila
 * clickeable para abrir el detalle.
 */
export function eventColumns(): ColumnDef<EnrichedPosLog, unknown>[] {
  return [
    {
      accessorKey: "fecha",
      header: "Fecha",
      meta: { priority: "always", width: "content" },
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {fmtFecha(row.original.fecha)}
        </span>
      ),
    },
    {
      id: "evento",
      header: "Evento / clave",
      accessorFn: (row) => shortEventLabel(row.clave),
      meta: { priority: "always", width: "content" },
      cell: ({ row }) => (
        <div className="flex max-w-52 flex-col">
          <span className="truncate text-xs font-medium">
            {shortEventLabel(row.original.clave)}
          </span>
          <span className="truncate font-mono text-[10px] text-muted-foreground">
            {row.original.clave}
          </span>
        </div>
      ),
    },
    {
      id: "instancia",
      header: "Instancia / serial",
      accessorFn: (row) => `${row.instancia} ${row.serial ?? ""}`,
      meta: { priority: "always", width: "content" },
      cell: ({ row }) => (
        <div className="flex max-w-48 flex-col">
          <span className="truncate text-xs">{row.original.instancia}</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {row.original.serial ?? "sin serial"}
          </span>
        </div>
      ),
    },
    {
      id: "descripcion",
      header: "Descripción",
      accessorFn: (row) => row.descripcion.mensajeLegible,
      meta: { priority: "always", width: "grow" },
      cell: ({ row }) => {
        const desc = row.original.descripcion;
        return (
          <Tooltip>
            <TooltipTrigger
              render={<div className="group flex flex-col gap-0.5 text-left" />}
            >
              <span className="flex items-start gap-1 text-xs leading-snug text-foreground">
                <span className="line-clamp-2">{desc.mensajeLegible}</span>
                <HugeiconsIcon
                  icon={InformationCircleIcon}
                  size={13}
                  strokeWidth={1.8}
                  className="mt-0.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground"
                  aria-hidden
                />
              </span>
              {desc.subtexto ? (
                <span className="line-clamp-1 text-[11px] text-muted-foreground">
                  {desc.subtexto}
                </span>
              ) : null}
            </TooltipTrigger>
            <TooltipContent side="top" align="start">
              <div className="flex flex-col gap-1.5">
                <p className="font-medium text-foreground">
                  {desc.mensajeLegible}
                </p>
                {desc.tooltip.motivo ? (
                  <p className="text-muted-foreground">
                    <b className="text-foreground">Motivo:</b>{" "}
                    {desc.tooltip.motivo}
                  </p>
                ) : null}
                {desc.tooltip.elapsedMs ? (
                  <p className="text-muted-foreground">
                    <b className="text-foreground">Tiempo de espera:</b>{" "}
                    {desc.tooltip.elapsedMs}
                  </p>
                ) : null}
                {desc.tooltip.caja ? (
                  <p className="text-muted-foreground">
                    <b className="text-foreground">Caja:</b>{" "}
                    {desc.tooltip.caja}
                    {desc.tooltip.endpoint
                      ? ` · ${desc.tooltip.endpoint}`
                      : ""}
                  </p>
                ) : null}
                {desc.tooltip.excepcion ? (
                  <p className="font-mono text-[11px] text-muted-foreground break-words">
                    {desc.tooltip.excepcion}
                  </p>
                ) : null}
                <div className="border-t border-border/60 pt-1.5">
                  <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                    Mensaje original (POS)
                  </span>
                  <p className="font-mono text-[11px] leading-snug text-muted-foreground break-words">
                    {desc.tooltip.mensajeOriginal}
                  </p>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        );
      },
    },
    {
      id: "pedido",
      header: "Pedido",
      accessorFn: (row) => row.pedido ?? "",
      meta: { priority: "always", width: "content" },
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.pedido ?? "—"}</span>
      ),
    },
    {
      id: "importe",
      header: "Importe",
      accessorFn: (row) => (row.importe ? Number(row.importe) : -1),
      meta: { priority: "always", width: "content" },
      cell: ({ row }) => (
        <span className="block text-right text-xs whitespace-nowrap tabular-nums">
          {row.original.importe
            ? `${row.original.importe} ${row.original.moneda ?? ""}`.trim()
            : "—"}
        </span>
      ),
    },
  ];
}
