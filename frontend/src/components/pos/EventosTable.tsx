import { HugeiconsIcon } from "@hugeicons/react";
import {
  InformationCircleIcon,
  Loading02Icon,
} from "@hugeicons/core-free-icons";
import type { PosEvento } from "../../api/types";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { fmtFecha } from "./format";
import type { EnrichedPosLog } from "./posAnalytics";
import { describePosEvent, shortEventLabel } from "./posCatalog";
import { PosLevelBadge } from "./PosLevelBadge";

function getDescription(evento: PosEvento | EnrichedPosLog) {
  if ("descripcion" in evento && evento.descripcion) {
    return evento.descripcion;
  }
  return describePosEvent(evento);
}

export function EventosTable({
  items,
  loading,
  onDetalle,
  onVerPedido,
}: {
  items: Array<PosEvento | EnrichedPosLog>;
  loading: boolean;
  onDetalle: (evento: PosEvento) => void;
  onVerPedido?: (numero: string) => void;
}) {
  if (loading) {
    return (
      <div
        className="flex items-center gap-2 p-6 text-sm text-muted-foreground"
        role="status"
        aria-busy="true"
      >
        <HugeiconsIcon
          icon={Loading02Icon}
          size={16}
          strokeWidth={2}
          className="animate-spin"
          aria-hidden
        />
        Consultando eventos…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Empty className="border-0">
        <EmptyTitle>Sin eventos</EmptyTitle>
        <EmptyDescription>
          No hay registros con estos filtros. Prueba limpiando la búsqueda o
          ampliando la ventana.
        </EmptyDescription>
      </Empty>
    );
  }

  return (
    <TooltipProvider delay={180}>
      <Table aria-label="Eventos" className="w-full table-fixed min-w-[900px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[10%]">Fecha</TableHead>
            <TableHead className="w-[9%]">Nivel</TableHead>
            <TableHead className="w-[18%]">Evento / clave</TableHead>
            <TableHead className="w-[16%]">Instancia / serial</TableHead>
            <TableHead className="w-[30%]">Descripción</TableHead>
            <TableHead className="w-[8%]">Pedido</TableHead>
            <TableHead className="w-[9%] text-right">Importe</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((evento) => {
            const desc = getDescription(evento);
            return (
              <TableRow
                key={evento.oid}
                onClick={() => onDetalle(evento)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onDetalle(evento);
                }}
                tabIndex={0}
                aria-label={`Ver detalle del evento ${evento.clave} del ${fmtFecha(evento.fecha)}`}
                className="cursor-pointer outline-none focus-visible:bg-muted/60"
              >
                <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                  {fmtFecha(evento.fecha)}
                </TableCell>
                <TableCell>
                  <PosLevelBadge nivel={evento.nivel} />
                </TableCell>
                <TableCell className="max-w-52">
                  <div className="flex flex-col">
                    <span className="truncate text-xs font-medium">
                      {shortEventLabel(evento.clave)}
                    </span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {evento.clave}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="max-w-48">
                  <div className="flex flex-col">
                    <span className="truncate text-xs">{evento.instancia}</span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                      {evento.serial ?? "sin serial"}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="max-w-80 whitespace-normal">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <div className="group flex flex-col gap-0.5 text-left" />
                      }
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
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {evento.pedido ? (
                    onVerPedido ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onVerPedido(evento.pedido as string);
                        }}
                        className="rounded px-1 py-0.5 font-mono text-xs underline decoration-muted-foreground/50 underline-offset-2 hover:bg-muted"
                        title={`Ver traza del pedido ${evento.pedido}`}
                      >
                        {evento.pedido}
                      </button>
                    ) : (
                      evento.pedido
                    )
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right text-xs whitespace-nowrap tabular-nums">
                  {evento.importe
                    ? `${evento.importe} ${evento.moneda ?? ""}`.trim()
                    : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}
