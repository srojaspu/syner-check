import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon } from "@hugeicons/core-free-icons";
import type { PosEventoDetalle } from "../../api/types";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fmtFecha, numeroFmt } from "./format";
import { PosLevelBadge } from "./PosLevelBadge";

export function EventoDetalleSheet({
  open,
  onOpenChange,
  loading,
  evento,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  evento: PosEventoDetalle | null;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        // Un clic fuera del panel no debe cerrar el detalle.
        if (eventDetails?.reason === "outside-press") return;
        onOpenChange(nextOpen);
      }}
    >
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-xl!"
        aria-label="Detalle del evento"
      >
        <SheetHeader className="items-start text-left">
          <div className="flex flex-wrap items-center gap-2">
            <PosLevelBadge nivel={evento?.nivel ?? "UNKNOWN"} />
            {evento ? <Badge variant="outline">{evento.clave}</Badge> : null}
          </div>
          <SheetTitle>Evento {evento?.oid ?? ""}</SheetTitle>
          <SheetDescription>
            {evento
              ? `${fmtFecha(evento.fecha)} · ${evento.instancia}`
              : "Cargando detalle…"}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center gap-2 px-6 pb-6 text-sm text-muted-foreground">
            <HugeiconsIcon
              icon={Loading02Icon}
              size={16}
              strokeWidth={2}
              className="animate-spin"
              aria-hidden
            />
            Consultando el evento…
          </div>
        ) : evento ? (
          <div className="flex flex-col gap-5 px-6 pb-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Dato
                  label="OID"
                  value={
                    <span className="font-mono text-xs break-all">
                      {evento.oid}
                    </span>
                  }
                />
              </div>
              <div className="col-span-2">
                <Dato
                  label="Clave"
                  value={
                    <span className="font-mono text-xs break-all">
                      {evento.clave}
                    </span>
                  }
                />
              </div>
              <Dato label="Instancia" value={evento.instancia} />
              <Dato label="Serial" value={evento.serial ?? "—"} />
              <Dato label="Versión" value={evento.version ?? "—"} />
              <Dato label="Pedido" value={evento.pedido ?? "—"} />
              <Dato
                label="Importe"
                value={
                  evento.importe
                    ? `${evento.importe} ${evento.moneda ?? ""}`.trim()
                    : "—"
                }
              />
              <Dato label="Moneda" value={evento.moneda ?? "—"} />
              <Dato
                label="Tipo de documento"
                value={evento.valor?.tipoDocumento ?? "—"}
              />
              <Dato
                label="Comprobante"
                value={evento.valor?.documento ?? "—"}
              />
              <Dato label="Pasarela" value={evento.valor?.pasarela ?? "—"} />
              <Dato
                label="Pan enmascarado"
                value={evento.valor?.panEnmascarado ?? "—"}
              />
              <Dato
                label="Duración"
                value={
                  evento.valor?.elapsedMs !== null &&
                  evento.valor?.elapsedMs !== undefined
                    ? `${numeroFmt.format(evento.valor.elapsedMs)} ms`
                    : "—"
                }
              />
              <div className="col-span-2">
                <Dato
                  label="Fecha exacta"
                  value={
                    <span className="font-mono text-xs break-all">
                      {evento.fecha}
                    </span>
                  }
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Mensaje
              </span>
              <p className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">
                {evento.mensaje}
              </p>
            </div>

            {evento.valor === null ? (
              <p className="text-xs text-muted-foreground">
                Este evento no trae datos adicionales en el origen.
              </p>
            ) : null}

            <p className="text-xs text-muted-foreground">
              No se muestran códigos de autorización ni el trace completo de la
              pasarela.
            </p>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Dato({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm break-words">{value}</span>
    </div>
  );
}
