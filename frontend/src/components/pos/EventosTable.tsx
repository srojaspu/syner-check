import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon } from "@hugeicons/core-free-icons";
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
import { fmtFecha } from "./format";
import { PosLevelBadge } from "./PosLevelBadge";

export function EventosTable({
  items,
  loading,
  onDetalle,
}: {
  items: PosEvento[];
  loading: boolean;
  onDetalle: (evento: PosEvento) => void;
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
    <Table aria-label="Eventos" className="w-full table-fixed min-w-[860px]">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[9%]">Fecha</TableHead>
          <TableHead className="w-[9%]">Nivel</TableHead>
          <TableHead className="w-[19%]">Clave</TableHead>
          <TableHead className="w-[17%]">Instancia / serial</TableHead>
          <TableHead className="w-[27%]">Mensaje</TableHead>
          <TableHead className="w-[8%]">Pedido</TableHead>
          <TableHead className="w-[11%] text-right">Importe</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((evento) => (
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
            <TableCell className="max-w-56 truncate font-medium">
              {evento.clave}
            </TableCell>
            <TableCell className="max-w-48">
              <div className="flex flex-col">
                <span className="truncate">{evento.instancia}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {evento.serial ?? "sin serial"}
                </span>
              </div>
            </TableCell>
            <TableCell className="max-w-80">
              <span
                className="line-clamp-2 text-xs text-muted-foreground"
                title={evento.mensaje}
              >
                {evento.mensaje}
              </span>
            </TableCell>
            <TableCell className="font-mono text-xs">
              {evento.pedido ?? "—"}
            </TableCell>
            <TableCell className="text-right text-xs whitespace-nowrap tabular-nums">
              {evento.importe
                ? `${evento.importe} ${evento.moneda ?? ""}`.trim()
                : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
