import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { TriangleAlertIcon } from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { IntelisisReenvioFila } from "../api/types";

const NOTA_MAX = 500;

interface IntelisisUfeResolverDialogProps {
  /** Fila `NO_CONFIRMADO` que se va a cerrar (null = cerrado). */
  fila: IntelisisReenvioFila | null;
  enviando: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (nota: string) => void;
}

/**
 * Cierre manual de un `NO_CONFIRMADO`.
 *
 * El worker perdió la conexión a mitad del generador: pudo haber emitido el
 * documento, así que no se reintenta solo. La nota es obligatoria y queda en
 * `RevisadoPor`/`Revision` de la fila del ERP.
 */
export function IntelisisUfeResolverDialog({
  fila,
  enviando,
  error,
  onOpenChange,
  onConfirm,
}: IntelisisUfeResolverDialogProps) {
  const [nota, setNota] = useState("");

  useEffect(() => {
    if (!fila) return;
    setNota("");
  }, [fila]);

  const notaLimpia = nota.trim();
  const valida = notaLimpia.length > 0 && notaLimpia.length <= NOTA_MAX;

  return (
    <Dialog open={Boolean(fila)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cerrar revisión manual</DialogTitle>
          <DialogDescription>
            El procesador perdió la conexión mientras ejecutaba este documento,
            así que no se reintenta solo: pudo haber emitido el comprobante.
            Revisa el ERP y deja constancia de lo que encontraste.
          </DialogDescription>
        </DialogHeader>

        {fila ? (
          <div className="grid gap-1 rounded-lg border p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground">Reenvío</span>
              <span className="tabular-nums">#{fila.ID}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground">Venta</span>
              <span className="tabular-nums">{fila.IDVenta}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground">Generador</span>
              <span>{fila.Procedimiento || "—"}</span>
            </div>
            {fila.Detalle ? (
              <p className="text-muted-foreground">{fila.Detalle}</p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-1.5">
          <Label htmlFor="reenvio-nota">Nota de revisión</Label>
          <textarea
            id="reenvio-nota"
            value={nota}
            onChange={(event) => setNota(event.target.value)}
            maxLength={NOTA_MAX}
            rows={3}
            required
            placeholder="Ej. El comprobante sí se generó; se validó en SUNAT."
            className="min-h-20 w-full resize-y rounded-lg border border-input bg-input/30 px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {notaLimpia.length}/{NOTA_MAX}
          </span>
        </div>

        {error ? (
          <Alert variant="destructive">
            <HugeiconsIcon icon={TriangleAlertIcon} strokeWidth={2} />
            <AlertTitle>No se pudo cerrar la revisión</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={enviando}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!valida || enviando}
            onClick={() => onConfirm(notaLimpia)}
          >
            {enviando ? "Registrando…" : "Registrar revisión"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
