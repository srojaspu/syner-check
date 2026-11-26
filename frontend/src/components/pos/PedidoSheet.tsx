import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon } from "@hugeicons/core-free-icons";
import type { PosEvento, PosPedidoResponse } from "../../api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fmtFecha } from "./format";
import { describePosEvent } from "./posCatalog";
import { PosLevelBadge } from "./PosLevelBadge";

export function PedidoSheet({
  open,
  onOpenChange,
  numero,
  loading,
  pedido,
  onVerDetalle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  numero: string;
  loading: boolean;
  pedido: PosPedidoResponse | null;
  onVerDetalle: (evento: PosEvento) => void;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        if (eventDetails?.reason === "outside-press") return;
        onOpenChange(nextOpen);
      }}
    >
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-xl!"
        aria-label="Resultados del pedido"
      >
        <SheetHeader className="items-start text-left">
          <SheetTitle>Pedido {pedido?.numero ?? numero}</SheetTitle>
          <SheetDescription>
            {pedido
              ? `${pedido.total} eventos en los últimos 7 días · ${fmtFecha(pedido.ventana.desde)} a ${fmtFecha(pedido.ventana.hasta)}`
              : "Consultando el pedido en SynerCOM…"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 px-6 pb-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <HugeiconsIcon
                icon={Loading02Icon}
                size={16}
                strokeWidth={2}
                className="animate-spin"
                aria-hidden
              />
              Buscando el pedido…
            </div>
          ) : pedido && pedido.eventos.length === 0 ? (
            <Empty className="border-0">
              <EmptyTitle>Sin eventos</EmptyTitle>
              <EmptyDescription>
                No se encontraron eventos para ese pedido en los últimos 7 días.
              </EmptyDescription>
            </Empty>
          ) : (
            (pedido?.eventos ?? []).map((evento) => {
              const desc = describePosEvent(evento);
              return (
                <div
                  key={evento.oid}
                  className="flex flex-col gap-2 rounded-md border p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <PosLevelBadge nivel={evento.nivel} />
                    <Badge variant="outline">{evento.clave}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {fmtFecha(evento.fecha)}
                    </span>
                  </div>
                  <p className="text-sm font-medium leading-snug text-foreground">
                    {desc.mensajeLegible}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {evento.mensaje}
                  </p>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {evento.instancia}
                      {evento.serial ? ` · ${evento.serial}` : ""}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onVerDetalle(evento)}
                    >
                      Ver detalle
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
