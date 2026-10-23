import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { TriangleAlertIcon } from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { nuevoToken } from "../api/token";
import type { IntelisisUfeRow } from "../api/types";

const MOTIVO_MAX = 500;

interface IntelisisUfeReenvioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: IntelisisUfeRow[];
  /** Tope de documentos por solicitud que impone el servidor. */
  maxBatch: number;
  enviando: boolean;
  error: string | null;
  onConfirm: (motivo: string, token: string, forzar: boolean) => void;
}

function documentos(cantidad: number): string {
  return `${cantidad} documento${cantidad === 1 ? "" : "s"}`;
}

/**
 * Confirmación del reenvío manual.
 *
 * No ejecuta el generador: encola en `dbo.FE_Reenvio`, la misma cola que
 * atiende el worker PHP del ERP. El `motivo` es obligatorio (queda en la fila
 * del ERP y en el log) y el `token` es la clave de idempotencia de la
 * solicitud: se genera al abrir y se conserva si el usuario reintenta.
 */
export function IntelisisUfeReenvioDialog({
  open,
  onOpenChange,
  rows,
  maxBatch,
  enviando,
  error,
  onConfirm,
}: IntelisisUfeReenvioDialogProps) {
  const [motivo, setMotivo] = useState("");
  const [forzar, setForzar] = useState(false);
  const [token, setToken] = useState("");

  // Cada apertura es una intención nueva: motivo limpio y token nuevo.
  useEffect(() => {
    if (!open) return;
    setMotivo("");
    setForzar(false);
    setToken(nuevoToken());
  }, [open]);

  const excedido = rows.length > maxBatch;
  const hayGenerados = rows.some(
    (fila) => fila.estado_generacion === "generado",
  );
  const motivoLimpio = motivo.trim();
  const motivoValido =
    motivoLimpio.length > 0 && motivoLimpio.length <= MOTIVO_MAX;
  const bloqueado = excedido || enviando || !motivoValido;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reenviar al generador UFE</DialogTitle>
          <DialogDescription>
            Se encola en <code>dbo.FE_Reenvio</code>, la misma cola que usa el
            ERP. El generador lo ejecuta el worker del ERP de a un documento:
            esta pantalla no lo ejecuta ni espera el resultado.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Documentos seleccionados</span>
            <Badge variant="secondary">{documentos(rows.length)}</Badge>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
            <span>Máximo por solicitud</span>
            <span className="tabular-nums">{documentos(maxBatch)}</span>
          </div>
        </div>

        {excedido ? (
          <Alert variant="destructive">
            <HugeiconsIcon icon={TriangleAlertIcon} strokeWidth={2} />
            <AlertTitle>Demasiados documentos</AlertTitle>
            <AlertDescription>
              El tope por solicitud es de {documentos(maxBatch)}: quita{" "}
              {documentos(rows.length - maxBatch)} de la selección.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-1.5">
          <Label htmlFor="reenvio-motivo">Motivo del reenvío</Label>
          <textarea
            id="reenvio-motivo"
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
            maxLength={MOTIVO_MAX}
            rows={3}
            required
            aria-invalid={motivo.length > 0 && !motivoValido}
            aria-describedby="reenvio-motivo-ayuda"
            placeholder="Ej. El comprobante no se generó y el cliente lo reclama."
            className="min-h-20 w-full resize-y rounded-lg border border-input bg-input/30 px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
          />
          <div
            className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
            id="reenvio-motivo-ayuda"
          >
            <span>Queda registrado en la fila del ERP, con tu usuario.</span>
            <span className="tabular-nums">
              {motivoLimpio.length}/{MOTIVO_MAX}
            </span>
          </div>
        </div>

        {hayGenerados ? (
          <div className="flex items-start gap-3 rounded-lg border p-4">
            <Checkbox
              id="reenvio-forzar"
              aria-label="Confirmo regenerar los documentos ya generados"
              checked={forzar}
              onCheckedChange={(checked) => setForzar(checked === true)}
              className="mt-0.5"
            />
            <div className="grid gap-1">
              <Label htmlFor="reenvio-forzar">
                Regenerar documentos ya generados
              </Label>
              <p className="text-sm text-muted-foreground">
                Parte de la selección ya tiene un comprobante emitido. Sin esta
                casilla el servidor los rechaza; los demás se encolan igual.
              </p>
            </div>
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <HugeiconsIcon icon={TriangleAlertIcon} strokeWidth={2} />
            <AlertTitle>No se pudo encolar</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={enviando}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={bloqueado}
            onClick={() => onConfirm(motivoLimpio, token, forzar)}
          >
            {enviando
              ? "Encolando…"
              : `Encolar ${documentos(rows.length)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
