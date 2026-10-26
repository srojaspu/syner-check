import { HugeiconsIcon } from "@hugeicons/react";
import { InformationCircleIcon, TriangleAlertIcon } from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMoney } from "../api/format";
import type { IntelisisUfeSinDocumentoRow } from "../api/types";

function ventas(cantidad: number): string {
  return `${cantidad.toLocaleString("es-PE")} venta${cantidad === 1 ? "" : "s"}`;
}

/**
 * Situación documental de la venta.
 *
 * "Sin documento" y "Documento inválido" no son lo mismo: en el segundo caso
 * el generador sí la intentó y dejó un número que no es un comprobante
 * (`159-00000000`). El badge lleva el texto, no solo el color.
 */
function SituacionBadge({ fila }: { fila: IntelisisUfeSinDocumentoRow }) {
  if (fila.situacion === "documento_invalido") {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        title="El generador lo intentó y el número de documento no era válido."
      >
        Documento inválido · {fila.documento_invalido ?? "—"}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      title="Nunca llegó a la bitácora del generador."
    >
      Sin documento
    </Badge>
  );
}

function Fila({
  fila,
}: {
  fila: IntelisisUfeSinDocumentoRow;
}) {
  return (
    <TableRow>
      <TableCell className="tabular-nums">
        {formatDate(fila.fecha_emision)}
      </TableCell>
      <TableCell className="whitespace-normal">
        <span title={`${fila.sucursal} · ${fila.sucursal_nombre}`}>
          <span className="font-medium">{fila.sucursal}</span>{" "}
          <span className="text-muted-foreground">
            {fila.sucursal_nombre || "Sin nombre"}
          </span>
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">
        <span className="flex flex-col">
          <span>{fila.mov}</span>
          {/* El folio del ERP no es el número del comprobante: se rotula para
              que no se lea como un CPE emitido. Sin folio no se inventa uno. */}
          <small
            className="tabular-nums"
            title={
              fila.mov_id
                ? "Folio del movimiento en Intelisis; no es el número del comprobante electrónico."
                : "El movimiento no llegó a tener folio en Intelisis."
            }
          >
            {fila.mov_id ? `Folio ${fila.mov_id}` : "Sin folio"}
          </small>
        </span>
      </TableCell>
      <TableCell className="tabular-nums">{fila.id_venta}</TableCell>
      <TableCell className="whitespace-normal">
        {fila.cliente || "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatMoney(fila.total, "PEN")}
      </TableCell>
      <TableCell>
        <SituacionBadge fila={fila} />
      </TableCell>
    </TableRow>
  );
}

/**
 * Diálogo "Ventas sin documentar": ventas SINAFECTAR del período.
 *
 * No forma parte de la grilla principal porque esas ventas no tienen
 * comprobante electrónico: no se pueden validar en SUNAT ni reenviar. Es
 * solo lectura y se carga al abrirlo.
 */
export function IntelisisUfeSinDocumentoDialog({
  open,
  onOpenChange,
  desde,
  hasta,
  rows,
  loading,
  error,
  truncado,
  maxFilas,
  onReintentar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  desde: string;
  hasta: string;
  rows: IntelisisUfeSinDocumentoRow[];
  loading: boolean;
  error: string | null;
  truncado: boolean;
  maxFilas: number;
  onReintentar: () => void;
}) {
  const total = rows.length;
  const rango = desde && hasta ? `${formatDate(desde)} — ${formatDate(hasta)}` : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Ventas sin documentar</DialogTitle>
          <DialogDescription>
            Ventas registradas en Intelisis que no llegaron a afectarse y no
            tienen comprobante electrónico emitido. No se pueden validar en
            SUNAT ni reenviar.
          </DialogDescription>
          {rango ? (
            <p className="text-xs text-muted-foreground">{rango}</p>
          ) : null}
        </DialogHeader>

        {loading ? (
          <div
            className="flex flex-col gap-2"
            aria-busy="true"
            aria-label="Cargando ventas sin documentar"
          >
            <span className="sr-only">Cargando ventas sin documentar…</span>
            {Array.from({ length: 4 }, (_, indice) => (
              <Skeleton key={indice} className="h-11 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col gap-3">
            <Alert variant="destructive">
              <HugeiconsIcon icon={TriangleAlertIcon} strokeWidth={2} />
              <AlertTitle>No se pudo consultar</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              onClick={onReintentar}
            >
              Reintentar
            </Button>
          </div>
        ) : total === 0 ? (
          <div className="flex flex-col items-start gap-1 rounded-lg border border-dashed p-6">
            <p className="font-medium">No hay ventas sin documentar</p>
            <p className="text-sm text-muted-foreground">
              Todas las ventas del período tienen comprobante electrónico o no
              son parte de este eje.
            </p>
          </div>
        ) : (
          <div className="max-h-[60vh] min-w-0 overflow-y-auto rounded-lg border">
            <Table aria-label="Ventas sin documentar">
              <TableHeader className="sticky top-0 z-10 bg-popover">
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead>Movimiento</TableHead>
                  <TableHead>ID ERP</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Situación</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((fila) => (
                  <Fila key={fila.id_venta} fila={fila} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {truncado ? (
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
            <span className="mt-0.5 shrink-0">
              <HugeiconsIcon
                icon={InformationCircleIcon}
                size={13}
                strokeWidth={2}
                aria-hidden
              />
            </span>
            Se muestran las primeras {maxFilas.toLocaleString("es-PE")} ventas.
            Acorta el período para ver el resto.
          </p>
        ) : null}

        <DialogFooter className="items-center justify-between sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {loading ? "Consultando…" : `${ventas(total)} · no incluye canceladas`}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
