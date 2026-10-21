import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { MovSynerPosProgressState } from "../hooks/useMovSynerPos";

interface MovSynerPosProgressProps {
  progress: MovSynerPosProgressState | null;
  notice: string | null;
  warning: string | null;
  error: string | null;
  failedCount: number;
  onRetry?: () => void;
}

export function MovSynerPosProgress({
  progress,
  notice,
  warning,
  error,
  failedCount,
  onRetry,
}: MovSynerPosProgressProps) {
  if (!progress && !notice && !warning && !error) return null;

  const total = progress?.total ?? 0;
  const enviados = progress?.enviados ?? 0;
  const porcentaje = total > 0 ? Math.min(100, (enviados / total) * 100) : 0;
  const running = Boolean(progress && !notice && !error);
  const withIssues = (progress?.errores ?? 0) + (progress?.conflictos ?? 0);

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>No se pudo enviar a MovSynerPos</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {progress ? (
        <Alert>
          <AlertTitle className="flex flex-wrap items-center gap-2">
            Envío a MovSynerPos
            <Badge variant={withIssues > 0 ? "destructive" : running ? "secondary" : "default"}>
              {error
                ? "Detenido"
                : withIssues > 0
                  ? "Con observaciones"
                  : running
                    ? "Enviando"
                    : "Completado"}
            </Badge>
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {enviados} de {total} documentos
            </span>
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <Progress
              value={porcentaje}
              aria-label="Avance del envío a MovSynerPos"
              className={running ? "animate-pulse" : undefined}
            />
            <span
              className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums"
              aria-live="polite"
            >
              <span>{progress.insertados} insertados</span>
              {progress.reparados > 0 ? (
                <span>{progress.reparados} reparados</span>
              ) : null}
              <span>{progress.sinCambios} sin cambios</span>
              {progress.conflictos > 0 ? (
                <span className="text-destructive">
                  {progress.conflictos} con conflicto
                </span>
              ) : null}
              {progress.errores > 0 ? (
                <span className="text-destructive">
                  {progress.errores} con error
                </span>
              ) : null}
            </span>
          </AlertDescription>
        </Alert>
      ) : null}

      {warning ? (
        <Alert variant="destructive">
          <AlertTitle>Algunos documentos no se enviaron</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{warning}</span>
            {failedCount > 0 && onRetry ? (
              <span>
                <button
                  type="button"
                  className="font-medium underline underline-offset-2"
                  onClick={onRetry}
                >
                  Reintentar solo los {failedCount} fallidos
                </button>
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {!warning && failedCount > 0 && onRetry ? (
        <Alert>
          <AlertDescription>
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={onRetry}
            >
              Reintentar solo los {failedCount} fallidos
            </button>
          </AlertDescription>
        </Alert>
      ) : null}

      {notice && !progress ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
