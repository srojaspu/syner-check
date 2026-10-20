import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { SunatProgressState } from "../hooks/useSunat";

interface SunatProgressProps {
  progress: SunatProgressState | null;
  notice: string | null;
  warning: string | null;
  error: string | null;
}

const STATE_LABEL: Record<string, string> = {
  COMPLETADO: "Completado",
  COMPLETADO_ERROR: "Con errores",
  CANCELADO: "Cancelado",
  ERROR: "Con errores",
};

function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? "En proceso";
}

function stateVariant(state: string): "default" | "secondary" | "destructive" {
  if (state === "COMPLETADO") return "default";
  if (state === "COMPLETADO_ERROR" || state === "CANCELADO" || state === "ERROR") {
    return "destructive";
  }
  return "secondary";
}

export function SunatProgress({
  progress,
  notice,
  warning,
  error,
}: SunatProgressProps) {
  if (!progress && !notice && !warning && !error) return null;

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>No se pudo validar en SUNAT</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {warning ? (
        <Alert variant="destructive">
          <AlertTitle>Validación en segundo plano</AlertTitle>
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ) : null}

      {progress ? (
        <Alert>
          <AlertTitle className="flex flex-wrap items-center gap-2">
            Validación SUNAT
            <Badge variant={stateVariant(progress.estado)}>
              {stateLabel(progress.estado)}
            </Badge>
            {progress.jobCount > 1 ? (
              <span className="text-xs font-normal text-muted-foreground">
                Lote {progress.jobIndex} de {progress.jobCount}
              </span>
            ) : null}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span aria-live="polite">{progress.mensaje}</span>
            <Progress
              value={progress.porcentaje}
              aria-label="Avance de la validación SUNAT"
            />
            <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
              <span>
                {progress.procesados} de {progress.total || "?"} procesados
              </span>
              <span>{progress.exitosos} válidos</span>
              {progress.errores > 0 ? (
                <span className="text-destructive">
                  {progress.errores} con error
                </span>
              ) : null}
              {progress.pendientes > 0 ? (
                <span>{progress.pendientes} pendientes</span>
              ) : null}
            </span>
          </AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
