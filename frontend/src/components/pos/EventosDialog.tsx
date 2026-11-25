import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
import { AuthError, RequestAbortedError } from "../../api/client";
import { getPosAnalysis } from "../../api/posLogs";
import type { PosAnalysis, PosClave } from "../../api/types";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EventosFiltros } from "./EventosFiltros";
import { EventosTable } from "./EventosTable";
import { FadeScroll } from "./FadeScroll";
import { numeroFmt } from "./format";
import { TODAS, TODOS, type EventosScope } from "./eventos";

export type { EventosScope } from "./eventos";

const LIMIT = 50;

/**
 * Modal de eventos con filtros por instancia, nivel, clave y texto.
 *
 * Reutiliza el snapshot cacheado del backend (misma ventana), así que cambiar
 * filtros o página no vuelve a consultar SynerCOM.
 */
export function EventosDialog({
  open,
  onOpenChange,
  ventana,
  instancias,
  claves,
  scope,
  onScopeChange,
  onAuthFailure,
  onDetalle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ventana: { desde: string; hasta: string; dias: number };
  instancias: string[];
  claves: PosClave[];
  scope: EventosScope;
  onScopeChange: (scope: EventosScope) => void;
  onAuthFailure: () => void;
  onDetalle: (evento: { oid: string; fecha: string }) => void;
}) {
  const [nivel, setNivel] = useState<string>(TODOS);
  const [clave, setClave] = useState<string>(TODAS);
  const [q, setQ] = useState("");
  const qDebounced = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PosAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    getPosAnalysis(
      {
        desde: ventana.desde,
        hasta: ventana.hasta,
        nivel: nivel === TODOS ? undefined : nivel,
        clave: clave === TODAS ? undefined : clave,
        instancia: scope.instancia ?? undefined,
        serial: scope.serial ?? undefined,
        q: qDebounced.trim() || undefined,
        page,
        limit: LIMIT,
      },
      controller.signal,
    )
      .then((next) => setData(next))
      .catch((err: unknown) => {
        if (err instanceof AuthError) {
          onAuthFailure();
          onOpenChange(false);
          return;
        }
        if (err instanceof RequestAbortedError) return;
        setError(
          err instanceof Error
            ? err.message
            : "No se pudieron consultar los eventos.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [
    open,
    ventana,
    scope,
    nivel,
    clave,
    qDebounced,
    page,
    refresh,
    onAuthFailure,
    onOpenChange,
  ]);

  useEffect(() => {
    if (open) setPage(1);
  }, [open, scope.instancia, scope.serial]);

  const paginas = data
    ? Math.max(1, Math.ceil(data.eventos.total / data.eventos.limit))
    : 1;

  function limpiarFiltros() {
    setNivel(TODOS);
    setClave(TODAS);
    setQ("");
    setPage(1);
  }

  function cambiarScope(next: EventosScope) {
    onScopeChange(next);
    setPage(1);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        // Solo se cierra con la X o Escape; un clic fuera no pierde el filtro.
        if (eventDetails?.reason === "outside-press") return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] max-w-6xl! max-h-[90vh]! gap-0 overflow-hidden! p-0">
        <DialogHeader className="border-b p-4 text-left">
          <DialogTitle>Eventos</DialogTitle>
          <DialogDescription>
            {scope.instancia
              ? `Instancia ${scope.instancia}${scope.serial ? ` · ${scope.serial}` : ""}`
              : "Todas las instancias"}{" "}
            · ventana de {ventana.dias} día(s)
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-3 p-4">
          <EventosFiltros
            scope={scope}
            instancias={instancias}
            claves={data?.claves ?? claves}
            nivel={nivel}
            clave={clave}
            q={q}
            loading={loading}
            onScopeChange={cambiarScope}
            onNivel={(value) => {
              setNivel(value);
              setPage(1);
            }}
            onClave={(value) => {
              setClave(value);
              setPage(1);
            }}
            onQ={(value) => {
              setQ(value);
              setPage(1);
            }}
            onLimpiar={limpiarFiltros}
            onActualizar={() => setRefresh((current) => current + 1)}
          />

          {error ? (
            <Alert variant="destructive">
              <HugeiconsIcon
                icon={TriangleAlertIcon}
                size={16}
                strokeWidth={2}
              />
              <AlertTitle>No se pudieron cargar los eventos</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <FadeScroll
            className="max-h-[55vh] rounded-md border"
            fadeFrom="popover"
          >
            <EventosTable
              items={data?.eventos.items ?? []}
              loading={loading && !data}
              onDetalle={onDetalle}
            />
          </FadeScroll>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {data
                ? `${numeroFmt.format(data.eventos.total)} eventos · página ${data.eventos.page} de ${paginas}`
                : "—"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading || (data?.eventos.page ?? 1) <= 1}
                onClick={() =>
                  setPage((current) => Math.max(1, current - 1))
                }
              >
                <HugeiconsIcon
                  icon={ArrowLeftIcon}
                  size={14}
                  strokeWidth={2}
                  aria-hidden
                />
                Anterior
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading || !(data?.eventos.hayMas ?? false)}
                onClick={() => setPage((current) => current + 1)}
              >
                Siguiente
                <HugeiconsIcon
                  icon={ArrowRightIcon}
                  size={14}
                  strokeWidth={2}
                  aria-hidden
                />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
