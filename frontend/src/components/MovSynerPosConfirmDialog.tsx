import { useState } from "react";
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
import type { Voucher } from "../api/types";

interface MovSynerPosConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: Voucher[];
  onConfirm: (reparar: boolean) => void;
}

export interface MovSynerPosSelectionCounts {
  total: number;
  missing: number;
  existing: number;
}

/** ``in_sql=false`` means no MovSynerPos row exists for that document yet. */
export function movSynerPosSelectionCounts(
  rows: Voucher[],
): MovSynerPosSelectionCounts {
  const missing = rows.filter((row) => row.in_sql !== true).length;
  return { total: rows.length, missing, existing: rows.length - missing };
}

function documents(count: number): string {
  return `${count} documento${count === 1 ? "" : "s"}`;
}

/**
 * Confirm the manual INSERT-only resend to SynerPOS.
 *
 * The checkbox is the only way to touch documents that already have rows, and
 * it only inserts missing lines: the backend never updates or deletes.
 */
export function MovSynerPosConfirmDialog({
  open,
  onOpenChange,
  rows,
  onConfirm,
}: MovSynerPosConfirmDialogProps) {
  const counts = movSynerPosSelectionCounts(rows);
  const [wantsRepair, setWantsRepair] = useState(false);
  const reparar = wantsRepair && counts.existing > 0;
  const actionable = counts.missing + (reparar ? counts.existing : 0);
  const disabled = actionable === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar a MovSynerPos</DialogTitle>
          <DialogDescription>
            Se vuelve a consultar cada documento en SynerCom y se insertan sus
            líneas en SynerPOS. No se actualiza ni se elimina nada.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 rounded-lg border p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Documentos seleccionados</span>
            <Badge variant="secondary">{documents(counts.total)}</Badge>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>Faltantes en MovSynerPos</span>
            <Badge>{documents(counts.missing)}</Badge>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
            <span>Ya existentes</span>
            <span className="tabular-nums">{documents(counts.existing)}</span>
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border p-4">
          <Checkbox
            id="movsynerpos-reparar"
            aria-label="Reintentar existentes para reparar líneas"
            checked={reparar}
            disabled={counts.existing === 0}
            onCheckedChange={(checked) => setWantsRepair(checked === true)}
            className="mt-0.5"
          />
          <div className="grid gap-1">
            <Label htmlFor="movsynerpos-reparar">
              Reintentar existentes para reparar líneas
            </Label>
            <p className="text-sm text-muted-foreground">
              Solo inserta las líneas que falten; las que ya existen no se
              tocan. Sin esta casilla, los documentos con líneas en SynerPOS se
              omiten.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={disabled}
            onClick={() => {
              onOpenChange(false);
              onConfirm(reparar);
            }}
          >
            {disabled
              ? "Nada para enviar"
              : `Enviar ${documents(actionable)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
