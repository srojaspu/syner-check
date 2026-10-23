import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface ResultsCardProps {
  /** Titulo de la seccion (h2: la pantalla no trae uno propio). */
  title: string;
  /** Resumen de una linea: conteo, periodo o el error de la consulta. */
  summary: ReactNode;
  /** Contenido extra bajo el resumen: totales, incidencias, seleccion, avisos. */
  details?: ReactNode;
  /** Botones de accion, alineados a la derecha en pantallas anchas. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Marco comun de los resultados tabulares (Comprobantes e Intelisis UFE).
 *
 * Es solo presentacion: la pagina decide que mostrar y que acciones ofrecer.
 * La grilla en si vive en ``DataTable``; esto unifica la cabecera, el
 * espaciado y el lugar de las acciones para que las dos pantallas se lean
 * igual.
 */
export function ResultsCard({
  title,
  summary,
  details,
  actions,
  children,
}: ResultsCardProps) {
  return (
    <Card>
      <CardHeader className="gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-base font-medium">{title}</h2>
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {summary}
            </span>
          </div>
          {details}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 sm:justify-self-end">
            {actions}
          </div>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
