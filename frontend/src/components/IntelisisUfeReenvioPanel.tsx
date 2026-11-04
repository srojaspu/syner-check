import { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Loading02Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/DataTable";
import {
  fechaHora,
  intelisisReenvioColumns,
} from "./IntelisisReenvioColumns";
import type {
  IntelisisReenvioCola,
  IntelisisReenvioFila,
} from "../api/types";

/** Paginacion de la cola: las dos tablas comparten los mismos tamanos. */
const TAMANOS_PAGINA = [10, 20, 50];

interface IntelisisUfeReenvioPanelProps {
  panel: IntelisisReenvioCola | null;
  loading: boolean;
  error?: string | null;
  resolviendo: number | null;
  onRecargar: () => void;
  onResolver: (fila: IntelisisReenvioFila) => void;
}

/**
 * Panel de la cola del ERP (`feop_queue`).
 *
 * Muestra el heartbeat del worker PHP (`dbo.FE_Worker`), lo que esta en curso,
 * lo que quedo sin confirmar y el historial. Mientras haya trabajo se refresca
 * solo; sin trabajo no consulta nada.
 *
 * Las tablas usan el `DataTable` comun con paginacion de 10/20/50. El sondeo
 * no reinicia la pagina: solo el cambio de filtro lo hace (via `key`).
 */
export function IntelisisUfeReenvioPanel({
  panel,
  loading,
  resolviendo,
  onRecargar,
  onResolver,
}: IntelisisUfeReenvioPanelProps) {
  const worker = panel?.worker ?? null;
  const activos = panel?.activos ?? [];
  const historial = panel?.historial ?? [];
  const resumen = panel?.resumen ?? {};
  const enCola = resumen.EN_COLA ?? panel?.pendientes ?? 0;
  const ejecutando = resumen.EJECUTANDO ?? 0;

  const haySinConfirmar = useMemo(
    () => activos.some((fila) => fila.Estado === "NO_CONFIRMADO"),
    [activos],
  );

  const columnasActivos = useMemo(
    () =>
      intelisisReenvioColumns({
        resolviendo,
        onResolver,
        incluirAccion: haySinConfirmar,
      }),
    [resolviendo, onResolver, haySinConfirmar],
  );

  const columnasHistorial = useMemo(
    () => intelisisReenvioColumns({ incluirAccion: false }),
    [],
  );

  return (
    <Card>
      <CardHeader className="gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-base font-medium">Cola de reenvíos</h2>
            <span className="text-sm text-muted-foreground">
              del ERP · <code>dbo.FE_Reenvio</code>
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            El worker del ERP ejecuta el generador de a un documento. Esta
            pantalla solo encola, observa y cierra revisiones.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRecargar}
          disabled={loading}
          className="sm:justify-self-end"
        >
          {loading ? (
            <HugeiconsIcon
              icon={Loading02Icon}
              size={16}
              strokeWidth={2}
              className="animate-spin"
              aria-hidden
            />
          ) : (
            <HugeiconsIcon icon={RefreshIcon} size={16} strokeWidth={2} aria-hidden />
          )}{" "}
          Actualizar
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div
          className="flex flex-wrap items-center gap-2 text-sm"
          aria-live="polite"
        >
          <Badge variant={panel?.ocupado ? "secondary" : "outline"}>
            {panel?.ocupado ? "Procesador ocupado" : "Procesador libre"}
          </Badge>
          <Badge variant="outline">
            Worker: {worker?.Estado || "sin heartbeat"}
          </Badge>
          {worker?.UltimoContacto ? (
            <span className="text-muted-foreground">
              último contacto {fechaHora(worker.UltimoContacto)}
            </span>
          ) : null}
          <span className="text-muted-foreground">
            · {enCola} en cola · {ejecutando} ejecutando ·{" "}
            {panel?.sin_confirmar ?? 0} sin confirmar · {panel?.total ?? 0} en
            total
          </span>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">En curso</h3>
          <DataTable.Root
            data={activos}
            columns={columnasActivos}
            initialPageSize={10}
            resetPageOnDataChange={false}
          >
            <DataTable.View<IntelisisReenvioFila>
              label="Reenvíos en curso"
              loading={loading}
              empty={
                <p className="text-sm text-muted-foreground">
                  No hay reenvíos activos.
                </p>
              }
            />
            {activos.length ? (
              <DataTable.Pagination pageSizeOptions={TAMANOS_PAGINA} />
            ) : null}
          </DataTable.Root>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Historial</h3>
          <DataTable.Root
            data={historial}
            columns={columnasHistorial}
            initialPageSize={10}
            resetPageOnDataChange={false}
          >
            <DataTable.View<IntelisisReenvioFila>
              label="Historial de reenvíos"
              loading={loading}
              empty={
                <p className="text-sm text-muted-foreground">
                  Todavía no hay reenvíos en el historial.
                </p>
              }
            />
            {historial.length ? (
              <DataTable.Pagination pageSizeOptions={TAMANOS_PAGINA} />
            ) : null}
          </DataTable.Root>
        </section>
      </CardContent>
    </Card>
  );
}
