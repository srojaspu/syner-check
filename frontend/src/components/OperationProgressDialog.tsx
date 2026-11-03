import { useEffect, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading02Icon, TriangleAlertIcon } from "@hugeicons/core-free-icons";
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

export interface OperationProgressDialogProps {
  open: boolean;
  running: boolean;
  title: string;
  description: string;
  riskTitle?: string;
  riskDescription: string;
  children: ReactNode;
  onCancel: () => void;
  onClose: () => void;
}

/**
 * Modal dedicado para procesos de validación en SUNAT y reenvío a MovSynerPos.
 *
 * - Ignora clics fuera del modal (`outside-press`) para evitar cierres accidentales.
 * - Mientras `running` es true, cualquier intento de cerrar (botón X, Escape o
 *   botón "Cancelar proceso") exige confirmación explícita advirtiendo los riesgos.
 * - Cuando `running` pasa a false, permite cerrar directamente para volver a la vista.
 */
export function OperationProgressDialog({
  open,
  running,
  title,
  description,
  riskTitle = "¿Deseas cancelar el proceso en curso?",
  riskDescription,
  children,
  onCancel,
  onClose,
}: OperationProgressDialogProps) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);

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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {running ? (
              <HugeiconsIcon
                icon={Loading02Icon}
                size={18}
                strokeWidth={2}
                className="animate-spin text-primary"
                aria-hidden
              />
            ) : null}
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
