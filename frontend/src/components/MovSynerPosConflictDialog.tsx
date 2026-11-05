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
import type { MovSynerPosConflicto } from "../hooks/useMovSynerPos";

export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 255;

const DEFAULT_MOTIVO =
  "Conflicto de serie al reenviar: se elimina el registro existente para insertar el comprobante actual.";

interface MovSynerPosConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflicts: MovSynerPosConflicto[];
  busy: boolean;
  error: string | null;
  onConfirm: (motivo: string) => void;
}

function money(value: string | null): string {
  if (!value) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : value;
}

/**
 * Resolve a serie collision: delete the registered row and resend the current
 * document. Shows the number **and** oid of both sides so the operator knows
 * exactly which record is going to disappear before confirming.
 */
export function MovSynerPosConflictDialog({
  open,
  onOpenChange,
  conflicts,
  busy,
  error,
  onConfirm,
}: MovSynerPosConflictDialogProps) {
  const [motivo, setMotivo] = useState(DEFAULT_MOTIVO);

  useEffect(() => {
    if (open) setMotivo(DEFAULT_MOTIVO);
  }, [open]);

  const trimmed = motivo.trim();
  const tooShort = trimmed.length < MOTIVO_MIN;
  const canSubmit = conflicts.length > 0 && !busy && !tooShort;

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
              icon={TriangleAlertIcon}
              size={18}
              strokeWidth={2}
              aria-hidden
            />
            Resolver conflicto en MovSynerPos
          </DialogTitle>
          <DialogDescription>
            Ya existe en MovSynerPos un registro con el mismo número. Para
            insertar el comprobante actual hay que eliminar primero ese registro
            (acción auditada y no reversible).
          </DialogDescription>
        </DialogHeader>

        <div className="base-ui-disable-scrollbar flex max-h-[45vh] flex-col gap-3 overflow-y-auto">
          {conflicts.map((conflict) => (
            <div
              key={`${String(conflict.documento.tipo)}|${conflict.documento.oid}`}
              className="grid gap-3 rounded-lg border p-4 text-sm"
            >
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">Documento actual</Badge>
                  <span className="text-xs text-muted-foreground">
                    se insertará después de eliminar
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium tabular-nums">
                    {conflict.documento.number || "—"}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    oid {conflict.documento.oid}
                  </span>
                </div>
              </div>

              {conflict.existentes.map((existente) => (
                <div
                  key={`${existente.oid}|${existente.number}`}
                  className="grid gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="destructive">
                      Registro existente en MovSynerPos
                    </Badge>
                    <span className="text-xs text-destructive">
                      se eliminará
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium tabular-nums">
                      {existente.number || "—"}
                    </span>
                    <span className="font-mono text-xs">
                      oid {existente.oid}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
                    <span>
                      {existente.lineas}{" "}
                      {existente.lineas === 1 ? "línea" : "líneas"}
                    </span>
                    <span>Total registrado: {money(existente.total)}</span>
                    {existente.fecha ? <span>{existente.fecha}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <Alert variant="destructive">
          <HugeiconsIcon icon={TriangleAlertIcon} aria-hidden />
          <AlertTitle>El borrado es definitivo</AlertTitle>
          <AlertDescription>
            Se eliminan las líneas del registro existente y luego se reenvía el
            documento actual desde SynerCom. Si Intelisis ya concluyó la venta
            del registro existente, el borrado se bloqueará.
          </AlertDescription>
        </Alert>

        <div className="grid gap-2">
          <Label htmlFor="movsynerpos-conflict-motivo">
            Motivo de la eliminación
          </Label>
          <Textarea
            id="movsynerpos-conflict-motivo"
            value={motivo}
            maxLength={MOTIVO_MAX}
            disabled={busy}
            aria-invalid={tooShort && trimmed.length > 0}
            aria-describedby="movsynerpos-conflict-motivo-help"
            onChange={(event) => setMotivo(event.target.value)}
          />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span id="movsynerpos-conflict-motivo-help">
              Obligatorio, entre {MOTIVO_MIN} y {MOTIVO_MAX} caracteres. Queda
              registrado en el log de auditoría junto con el oid eliminado.
            </span>
            <span className="tabular-nums">
              {trimmed.length}/{MOTIVO_MAX}
            </span>
          </div>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>No se pudieron resolver todos los conflictos</AlertTitle>
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
            disabled={!canSubmit}
            onClick={() => onConfirm(trimmed)}
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
            {busy ? "Resolviendo…" : "Eliminar existente y reenviar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
