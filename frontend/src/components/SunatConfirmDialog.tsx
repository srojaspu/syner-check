import { useEffect, useId, useState } from "react";
import { cn } from "cn";
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
import type { SunatScope, Voucher } from "../api/types";

interface SunatConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: Voucher[];
  onConfirm: (scope: SunatScope) => void;
}

interface SunatSelectionCounts {
  total: number;
  accepted: number;
  pending: number;
  unconfirmed: number;
  all: number;
}

export function sunatSelectionCounts(rows: Voucher[]): SunatSelectionCounts {
  const accepted = rows.filter(
    (row) => row.sunat?.estado?.trim().toUpperCase() === "ACEPTADO",
  ).length;
  const unconfirmed = rows.filter(
    (row) => row.sunat?.estado?.trim().toUpperCase() === "SIN_CONFIRMAR",
  ).length;
  return {
    total: rows.length,
    accepted,
    pending: rows.length - accepted - unconfirmed,
    unconfirmed,
    all: rows.length - unconfirmed,
  };
}

function documents(count: number): string {
  return `${count} documento${count === 1 ? "" : "s"}`;
}

function countLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function joinSpanish(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/** Only mention omissions that actually exist; zero counts are noise. */
function omittedText(counts: SunatSelectionCounts): string {
  const parts: string[] = [];
  if (counts.accepted > 0) {
    parts.push(countLabel(counts.accepted, "aceptado", "aceptados"));
  }
  if (counts.unconfirmed > 0) {
    parts.push(`${counts.unconfirmed} sin confirmar`);
  }
  if (!parts.length) return "";
  const verb = counts.accepted + counts.unconfirmed === 1 ? "omite" : "omiten";
  return ` Se ${verb} ${joinSpanish(parts)}.`;
}

function noPendingText(counts: SunatSelectionCounts): string {
  if (counts.total === 0) return "No hay documentos para consultar.";
  if (counts.accepted === counts.total) {
    return "Todos los documentos ya están aceptados.";
  }
  if (counts.unconfirmed === counts.total) {
    return "Todos los documentos tienen un envío sin confirmar.";
  }
  return "No hay documentos pendientes consultables.";
}

/**
 * Ask the user for the batch scope before spending SUNAT quota.
 *
 * The default skips vouchers already ACEPTADO; "todos" forces a fresh query
 * even for accepted vouchers. Cancelling never spends a SUNAT call.
 */
export function SunatConfirmDialog({
  open,
  onOpenChange,
  rows,
  onConfirm,
}: SunatConfirmDialogProps) {
  const radioName = useId();
  const counts = sunatSelectionCounts(rows);
  const [scope, setScope] = useState<SunatScope>("no_aceptados");

  useEffect(() => {
    if (!open) return;
    // With zero pending documents the default option would do nothing, so
    // preselect "todos" while keeping the recommended option disabled.
    setScope(counts.pending > 0 ? "no_aceptados" : "todos");
  }, [open, counts.pending]);

  const count = scope === "no_aceptados" ? counts.pending : counts.all;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Consultar en SUNAT</DialogTitle>
          <DialogDescription>
            Elige qué documentos quieres reconsultar. Los ya aceptados se
            omiten por defecto para evitar bloqueos o consumo innecesario.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="grid gap-3">
          <legend className="sr-only">Alcance de la consulta SUNAT</legend>

          <label
            className={cn(
              "flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors",
              scope === "no_aceptados"
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50",
              counts.pending === 0 && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              name={radioName}
              value="no_aceptados"
              checked={scope === "no_aceptados"}
              disabled={counts.pending === 0}
              onChange={() => setScope("no_aceptados")}
              className="mt-1 size-4 accent-primary"
            />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                Solo no aceptados
                <Badge variant="secondary">Recomendado</Badge>
              </span>
              <span className="text-sm text-muted-foreground">
                {counts.pending > 0
                  ? `${documents(counts.pending)} para consultar.${omittedText(counts)}`
                  : noPendingText(counts)}
              </span>
            </span>
          </label>

          <label
            className={cn(
              "flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors",
              scope === "todos"
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50",
            )}
          >
            <input
              type="radio"
              name={radioName}
              value="todos"
              checked={scope === "todos"}
              onChange={() => setScope("todos")}
              className="mt-1 size-4 accent-primary"
            />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="font-medium">Todos</span>
              <span className="text-sm text-muted-foreground">
                {counts.all > 0
                  ? `${documents(counts.all)} con consulta nueva.` +
                    (counts.accepted > 0
                      ? ` Incluye ${countLabel(
                          counts.accepted,
                          "aceptado",
                          "aceptados",
                        )}.`
                      : "") +
                    (counts.unconfirmed > 0
                      ? ` Se omiten ${counts.unconfirmed} sin confirmar.`
                      : "") +
                    " Puede tardar más y consumir más cuota de SUNAT."
                  : "No hay documentos consultables."}
              </span>
            </span>
          </label>
        </fieldset>

        <p className="text-xs text-muted-foreground">
          {counts.unconfirmed > 0
            ? `Los envíos sin confirmar (${counts.unconfirmed}) y los lotes en proceso se omiten para no duplicar trabajos en SUNAT.`
            : "Los lotes en proceso se omiten para no duplicar trabajos en SUNAT."}
        </p>

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
            disabled={count === 0}
            onClick={() => {
              onOpenChange(false);
              onConfirm(scope);
            }}
          >
            Consultar {documents(count)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
