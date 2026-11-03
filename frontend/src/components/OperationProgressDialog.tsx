import { useEffect, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Loading02Icon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
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
import {
  isOperationRunning,
  type OperationStatus,
} from "@/operations/types";

export interface OperationProgressDialogProps {
  open: boolean;
  status: OperationStatus;
  title: string;
  description: string;
  riskTitle?: string;
  riskDescription: string;
  children: ReactNode;
  onCancel: () => void;
  onClose: () => void;
}

/** Icono del encabezado: cuatro resultados distintos, no solo giro/check. */
function StatusIcon({ status }: { status: OperationStatus }) {
  if (status === "running") {
    return (
      <HugeiconsIcon
        icon={Loading02Icon}
        size={18}
        strokeWidth={2}
        className="animate-spin text-primary"
        aria-hidden
      />
    );
  }
  if (status === "completed") {
    return (
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        size={18}
        strokeWidth={2}
        className="text-emerald-600 dark:text-emerald-400"
        aria-hidden
      />
    );
  }
  if (status === "partial") {
    return (
      <HugeiconsIcon
        icon={TriangleAlertIcon}
        size={18}
        strokeWidth={2}
        className="text-amber-600 dark:text-amber-400"
        aria-hidden
      />
    );
  }
  if (status === "failed") {
    return (
      <HugeiconsIcon
        icon={TriangleAlertIcon}
        size={18}
        strokeWidth={2}
        className="text-destructive"
        aria-hidden
      />
    );
  }
  return (
    <HugeiconsIcon
      icon={Cancel01Icon}
      size={18}
      strokeWidth={2}
      className="text-muted-foreground"
      aria-hidden
    />
  );
}

/**
 * Modal dedicado para procesos de validación en SUNAT y reenvío a MovSynerPos.
 *
 * - Ignora clics fuera del modal (`outside-press`) para evitar cierres accidentales.
 * - Mientras el estado es `running`, cualquier intento de cerrar (Escape o
 *   botón "Cancelar proceso") exige confirmación explícita advirtiendo los riesgos.
 * - El icono del título y el botón del pie salen del estado de dominio, no de
 *   un booleano: un fallo o un resultado parcial no se pintan como éxito.
 */
export function OperationProgressDialog({
  open,
  status,
  title,
  description,
  riskTitle = "¿Deseas cancelar el proceso en curso?",
  riskDescription,
  children,
  onCancel,
  onClose,
}: OperationProgressDialogProps) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const running = isOperationRunning(status);

  useEffect(() => {
    if (!open || !running) {
      setConfirmingCancel(false);
    }
  }, [open, running]);

  const requestCloseOrCancel = () => {
    if (running) {
      setConfirmingCancel(true);
    } else {
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        if (eventDetails?.reason === "outside-press") return;
        if (!nextOpen) {
          requestCloseOrCancel();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-busy={running}
        className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StatusIcon status={status} />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">{children}</div>

        {confirmingCancel && running ? (
          <Alert variant="destructive">
            <HugeiconsIcon icon={TriangleAlertIcon} strokeWidth={2} />
            <AlertTitle>{riskTitle}</AlertTitle>
            <AlertDescription>{riskDescription}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          {running ? (
            confirmingCancel ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmingCancel(false)}
                >
                  Continuar con el proceso
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    setConfirmingCancel(false);
                    onCancel();
                  }}
                >
                  Sí, cancelar proceso
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmingCancel(true)}
              >
                Cancelar proceso
              </Button>
            )
          ) : (
            <Button type="button" onClick={onClose}>
              Cerrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
