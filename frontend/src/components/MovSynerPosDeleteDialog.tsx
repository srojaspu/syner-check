import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  Loading02Icon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
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
import { Textarea } from "@/components/ui/textarea";
import type { Voucher } from "../api/types";

/** Server-side bounds (``src/domain/movsynerpos.py``). */
export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 255;

interface MovSynerPosDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: Voucher | null;
  busy: boolean;
  /** Message returned by the backend (409 included). */
  error: string | null;
  /** True after a 409: Intelisis already concluded the sale. */
  blocked: boolean;
  onConfirm: (motivo: string, forzar: boolean) => void;
}

/**
 * Confirm the destructive removal of one wrong/duplicated receipt.
 *
 * The reason is mandatory and audited. ``forzar`` is only offered after the
 * backend refused with 409, so the operator must consciously override the
 * "already concluded in Intelisis" guard.
 */
export function MovSynerPosDeleteDialog({
  open,
  onOpenChange,
  document,
  busy,
  error,
  blocked,
  onConfirm,
}: MovSynerPosDeleteDialogProps) {
  const [motivo, setMotivo] = useState("");
  const [forzar, setForzar] = useState(false);

  // Each new target starts from a clean form so a previous reason never
  // leaks into another document's audit trail.
  useEffect(() => {
    if (!open) return;
    setMotivo("");
    setForzar(false);
  }, [open, document?.oid, document?.tipo]);

  const trimmed = motivo.trim();
  const tooShort = trimmed.length < MOTIVO_MIN;
  const counter = `${trimmed.length}/${MOTIVO_MAX}`;
  const canSubmit = Boolean(document) && !busy && !tooShort;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (busy) return;
        onOpenChange(value);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon
              icon={Delete02Icon}
              size={18}
              strokeWidth={2}
              aria-hidden
            />
            Eliminar de MovSynerPos
          </DialogTitle>
          <DialogDescription>
            Se eliminan todas las líneas de este comprobante en SynerPOS. La
            operación no se puede deshacer.
          </DialogDescription>
        </DialogHeader>

        {document ? (
          <div className="grid gap-2 rounded-lg border p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Tipo</span>
              <Badge variant="secondary">{document.tipo}</Badge>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Serie y número</span>
              <span className="font-medium tabular-nums">
                {document.number || "—"}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
              <span>OID</span>
              <span className="font-mono text-xs">{document.oid}</span>
            </div>
          </div>
        ) : null}

        <Alert variant="destructive">
          <HugeiconsIcon icon={TriangleAlertIcon} aria-hidden />
          <AlertTitle>Acción destructiva y auditada</AlertTitle>
          <AlertDescription>
            Solo se borra este documento. Si Intelisis ya concluyó la venta, el
            borrado se bloquea para no desincronizar el ERP: anúlalo primero
            allí.
          </AlertDescription>
        </Alert>

        <div className="grid gap-2">
          <Label htmlFor="movsynerpos-delete-motivo">
            Motivo de la eliminación
          </Label>
          <Textarea
            id="movsynerpos-delete-motivo"
            value={motivo}
            maxLength={MOTIVO_MAX}
            disabled={busy}
            aria-invalid={tooShort && trimmed.length > 0}
            aria-describedby="movsynerpos-delete-motivo-help"
            placeholder="Ej. SynerCom duplicó el comprobante y migró el detalle equivocado."
            onChange={(event) => setMotivo(event.target.value)}
          />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span id="movsynerpos-delete-motivo-help">
              Obligatorio, entre {MOTIVO_MIN} y {MOTIVO_MAX} caracteres. Queda
              registrado en el log de auditoría.
            </span>
            <span className="tabular-nums">{counter}</span>
          </div>
        </div>

        {blocked ? (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/40 p-4">
            <Checkbox
              id="movsynerpos-delete-forzar"
              aria-label="Forzar aunque Intelisis ya concluyó la venta"
              checked={forzar}
              disabled={busy}
              onCheckedChange={(checked) => setForzar(checked === true)}
              className="mt-0.5"
            />
            <div className="grid gap-1">
              <Label htmlFor="movsynerpos-delete-forzar">
                Forzar aunque Intelisis ya lo concluyó
              </Label>
              <p className="text-sm text-muted-foreground">
                Confirma que anulaste la venta en Intelisis y que eliminar estas
                líneas no dejará el ERP inconsistente.
              </p>
            </div>
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>No se pudo eliminar</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canSubmit || (blocked && !forzar)}
            onClick={() => onConfirm(trimmed, blocked && forzar)}
          >
            {busy ? (
              <HugeiconsIcon
                icon={Loading02Icon}
                size={15}
                strokeWidth={2}
                className="animate-spin"
                aria-hidden
              />
            ) : (
              <HugeiconsIcon
                icon={Delete02Icon}
                size={15}
                strokeWidth={2}
                aria-hidden
              />
            )}{" "}
            {busy ? "Eliminando…" : "Eliminar de MovSynerPos"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
