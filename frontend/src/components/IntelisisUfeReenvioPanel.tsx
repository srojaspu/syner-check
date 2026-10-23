import { HugeiconsIcon } from "@hugeicons/react";
import {
  Loading02Icon,
  RefreshIcon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  IntelisisReenvioCola,
  IntelisisReenvioEstado,
  IntelisisReenvioFila,
} from "../api/types";

const ESTADOS: { value: IntelisisReenvioEstado; label: string }[] = [
  { value: "EN_COLA", label: "En cola" },
  { value: "EJECUTANDO", label: "Ejecutando" },
  { value: "FINALIZADO_OK", label: "Finalizado OK" },
  { value: "FINALIZADO_REVISAR", label: "Finalizado · revisar" },
  { value: "NO_EJECUTADO", label: "No ejecutado" },
  { value: "NO_CONFIRMADO", label: "Sin confirmar" },
  { value: "REVISADO_MANUAL", label: "Revisado a mano" },
];

const ETIQUETA: Record<string, string> = Object.fromEntries(
  ESTADOS.map((estado) => [estado.value, estado.label]),
);

type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

function variante(estado: string): BadgeVariant {
  if (estado === "FINALIZADO_OK") return "default";
  if (estado === "FINALIZADO_REVISAR" || estado === "NO_CONFIRMADO") {
    return "destructive";
  }
  if (estado === "EN_COLA" || estado === "EJECUTANDO") return "secondary";
  return "outline";
}

/** Timestamp del ERP sin segundos ni zona: es lo que se muestra en el PHP. */
function fechaHora(valor: string | null): string {
  if (!valor) return "—";
  return String(valor).replace("T", " ").slice(0, 16);
}

function EstadoBadge({ estado }: { estado: string }) {
  return <Badge variant={variante(estado)}>{ETIQUETA[estado] ?? estado}</Badge>;
}

function FilaReenvio({
  fila,
  resolviendo,
  onResolver,
}: {
  fila: IntelisisReenvioFila;
  resolviendo: number | null;
  onResolver: (fila: IntelisisReenvioFila) => void;
}) {
  return (
    <TableRow>
      <TableCell className="tabular-nums text-muted-foreground">
        {fila.ID}
      </TableCell>
      <TableCell className="tabular-nums">{fila.IDVenta}</TableCell>
      <TableCell>
        <Badge variant="outline">{fila.Tipo || "—"}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {fila.Procedimiento || "—"}
      </TableCell>
      <TableCell>
        <EstadoBadge estado={fila.Estado} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {fila.Usuario || "—"}
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {fechaHora(fila.Creado)}
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {fechaHora(fila.Fin)}
      </TableCell>
      <TableCell className="max-w-56 truncate text-muted-foreground">
        <span title={fila.Revision || fila.Detalle || fila.Motivo || undefined}>
          {fila.Revision || fila.Detalle || fila.Motivo || "—"}
        </span>
      </TableCell>
      <TableCell className="text-right">
        {fila.Estado === "NO_CONFIRMADO" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={resolviendo === fila.ID}
            onClick={() => onResolver(fila)}
          >
            {resolviendo === fila.ID ? "Cerrando…" : "Resolver"}
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function TablaReenvios({
  filas,
  vacio,
  resolviendo,
  onResolver,
}: {
  filas: IntelisisReenvioFila[];
  vacio: string;
  resolviendo: number | null;
  onResolver: (fila: IntelisisReenvioFila) => void;
}) {
  if (!filas.length) {
    return (
      <p className="py-3 text-sm text-muted-foreground" role="status">
        {vacio}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">#</TableHead>
            <TableHead scope="col">Venta</TableHead>
            <TableHead scope="col">Tipo</TableHead>
            <TableHead scope="col">Generador</TableHead>
            <TableHead scope="col">Estado</TableHead>
            <TableHead scope="col">Usuario</TableHead>
            <TableHead scope="col">Creado</TableHead>
            <TableHead scope="col">Fin</TableHead>
            <TableHead scope="col">Detalle</TableHead>
            <TableHead scope="col" className="text-right">
              Acción
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filas.map((fila) => (
            <FilaReenvio
              key={fila.ID}
              fila={fila}
              resolviendo={resolviendo}
              onResolver={onResolver}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface IntelisisUfeReenvioPanelProps {
  panel: IntelisisReenvioCola | null;
  loading: boolean;
  error: string | null;
  filtro: string;
  resolviendo: number | null;
  onFiltro: (estado: string) => void;
  onRecargar: () => void;
  onResolver: (fila: IntelisisReenvioFila) => void;
}

/**
 * Panel de la cola del ERP (`feop_queue`).
 *
 * Muestra el heartbeat del worker PHP (`dbo.FE_Worker`), lo que está en curso,
 * lo que quedó sin confirmar y el historial. Mientras haya trabajo se refresca
 * solo; sin trabajo no consulta nada.
 */
export function IntelisisUfeReenvioPanel({
  panel,
  loading,
  error,
  filtro,
  resolviendo,
  onFiltro,
  onRecargar,
  onResolver,
}: IntelisisUfeReenvioPanelProps) {
  const worker = panel?.worker ?? null;
  const activos = panel?.activos ?? [];
  const historial = panel?.historial ?? [];
  const resumen = panel?.resumen ?? {};
  const enCola = resumen.EN_COLA ?? panel?.pendientes ?? 0;
  const ejecutando = resumen.EJECUTANDO ?? 0;

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
        {error ? (
          <Alert variant="destructive">
            <HugeiconsIcon icon={TriangleAlertIcon} strokeWidth={2} />
            <AlertTitle>No fue posible leer la cola</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

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
          <TablaReenvios
            filas={activos}
            vacio="No hay reenvíos activos."
            resolviendo={resolviendo}
            onResolver={onResolver}
          />
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Historial</h3>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Estado{" "}
              <NativeSelect
                size="sm"
                value={filtro}
                onChange={(event) => onFiltro(event.target.value)}
                aria-label="Filtrar el historial por estado"
              >
                <NativeSelectOption value="">Todos</NativeSelectOption>
                {ESTADOS.map((estado) => (
                  <NativeSelectOption key={estado.value} value={estado.value}>
                    {estado.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          </div>
          <TablaReenvios
            filas={historial}
            vacio="Todavía no hay reenvíos en el historial."
            resolviendo={resolviendo}
            onResolver={onResolver}
          />
        </section>
      </CardContent>
    </Card>
  );
}
