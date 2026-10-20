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
  EN_COLA: "En cola",
  EN_PROCESO: "En proceso",
  COMPLETADO: "Completado",
  COMPLETADO_ERROR: "Con errores",
  CANCELADO: "Cancelado",
  ERROR: "Con errores",
};

/**
 * ``COMPLETADO`` means different things per phase:
 * - submission: every chunk was registered; SUNAT may still be working.
 * - job: that specific job finished; only the last one completes the batch.
 */
function stateLabel(progress: SunatProgressState): string {
  if (progress.phase === "submission") {
    if (progress.estado === "COMPLETADO") {
      return progress.chunksTotal > 0 ? "Consultando SUNAT" : "Completado";
    }
    if (progress.estado === "ERROR") return "Envío detenido";
    return STATE_LABEL[progress.estado] ?? "Enviando";
  }
  if (progress.estado === "COMPLETADO") {
    return progress.jobIndex < progress.jobCount
      ? "Lote listo"
      : "Completado";
  }
  return STATE_LABEL[progress.estado] ?? "En proceso";
}

function stateVariant(
  progress: SunatProgressState,
): "default" | "secondary" | "destructive" {
  const { estado, phase, jobIndex, jobCount } = progress;
  if (
    estado === "COMPLETADO_ERROR" ||
    estado === "CANCELADO" ||
    estado === "ERROR"
  ) {
    return "destructive";
  }
  if (estado !== "COMPLETADO") return "secondary";
  if (phase === "submission") {
    // Sending chunks is not validation completion.
    return progress.chunksTotal > 0 ? "secondary" : "default";
  }
  return jobIndex >= jobCount ? "default" : "secondary";
}

function submissionLabel(progress: SunatProgressState): string {
  if (progress.estado === "ERROR") return "Envío detenido";
  if (
    progress.estado === "COMPLETADO" ||
    (progress.chunksTotal > 0 && progress.chunksDone >= progress.chunksTotal)
  ) {
    return progress.chunksTotal > 0
      ? `${progress.chunksDone} de ${progress.chunksTotal} lotes enviados`
      : "Lote procesado";
  }
  if (progress.chunksTotal > 0) {
    return `Enviando lote ${Math.min(
      progress.chunksDone + 1,
      progress.chunksTotal,
    )} de ${progress.chunksTotal}`;
  }
  return "Preparando lote";
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
            <Badge variant={stateVariant(progress)}>
              {stateLabel(progress)}
            </Badge>
            {progress.phase === "submission" ? (
              <span className="text-xs font-normal text-muted-foreground">
                {progress.alcance === "todos" ? "Todos" : "Solo no aceptados"}
                {" · "}
                {submissionLabel(progress)}
              </span>
            ) : progress.jobCount > 1 ? (
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
              className={
                progress.phase === "submission" &&
                progress.estado !== "COMPLETADO" &&
                progress.estado !== "ERROR"
                  ? "animate-pulse"
                  : undefined
              }
            />
            <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
              {progress.phase === "submission" ? (
                <>
                  {progress.porEnviar > 0 ? (
                    <span>
                      {progress.enviados} de {progress.porEnviar} enviados
                    </span>
                  ) : progress.chunksTotal > 0 ? (
                    <span>
                      {progress.chunksDone} de {progress.chunksTotal}{" "}
                      {progress.chunksTotal === 1 ? "lote" : "lotes"} enviados
                    </span>
                  ) : progress.estado === "COMPLETADO" ? (
                    <span>Sin envíos nuevos</span>
                  ) : null}
                  {progress.aceptados > 0 ? (
                    <span>{progress.aceptados} aceptados</span>
                  ) : null}
                  {progress.enProceso > 0 ? (
                    <span>{progress.enProceso} en proceso</span>
                  ) : null}
                  {progress.sinConfirmar > 0 ? (
                    <span className="text-destructive">
                      {progress.sinConfirmar} sin confirmar
                    </span>
                  ) : null}
                  {progress.invalidos > 0 ? (
                    <span className="text-destructive">
                      {progress.invalidos} inválidos
                    </span>
                  ) : null}
                  {progress.errores > 0 ? (
                    <span className="text-destructive">
                      {progress.errores} lote(s) con error
                    </span>
                  ) : null}
                </>
              ) : (
                <>
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
                </>
              )}
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
