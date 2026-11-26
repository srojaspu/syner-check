import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  InformationCircleIcon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import { AuthError, RequestAbortedError } from "../api/client";
import { getPosAnalysis, getPosEvent } from "../api/posLogs";
import type { PosAnalysis, PosEventoDetalle } from "../api/types";
import { EventoDetalleSheet } from "../components/pos/EventoDetalleSheet";
import { TODAS, type EventosScope } from "../components/pos/eventos";
import {
  analyzePosLogs,
  extractClientLogsFromAnalysis,
  type PosKpiCardId,
} from "../components/pos/posAnalytics";
import { formatLimaIso } from "../components/pos/posCatalog";
import { PosEventosWorkspace } from "../components/pos/PosEventosWorkspace";
import {
  horasDeRango,
  RANGO_POR_DEFECTO,
  type RangoId,
} from "../components/pos/rangos";
import { TerminalesGraficos } from "../components/pos/TerminalesGraficos";
import { TerminalesHeader } from "../components/pos/TerminalesHeader";
import { TerminalesIndicadores } from "../components/pos/TerminalesIndicadores";
import { TerminalesToolbar } from "../components/pos/TerminalesToolbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface TerminalesPageProps {
  onAuthFailure: () => void;
}

function calcularVentana(horas: number): { desde: string; hasta: string } {
  const hasta = new Date();
  hasta.setSeconds(0, 0); // minuto exacto: comparte caché con otras peticiones
  const desde = new Date(hasta.getTime() - horas * 3_600_000);
  return { desde: formatLimaIso(desde), hasta: formatLimaIso(hasta) };
}

export default function TerminalesPage({ onAuthFailure }: TerminalesPageProps) {
  const [rango, setRango] = useState<RangoId>(RANGO_POR_DEFECTO);
  const [ventana, setVentana] = useState(() =>
    calcularVentana(horasDeRango(RANGO_POR_DEFECTO)),
  );

  const [data, setData] = useState<PosAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estado compartido de clasificación/filtrado entre KPIs, tabla en página y modal
  const [activeCard, setActiveCard] = useState<PosKpiCardId | null>(null);
  const [subGrupo, setSubGrupo] = useState<string | null>(null);
  const [eventosScope, setEventosScope] = useState<EventosScope>({
    instancia: null,
    serial: null,
  });
  const [claveFiltro, setClaveFiltro] = useState<string>(TODAS);
  const [textoFiltro, setTextoFiltro] = useState("");

  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const [detalleLoading, setDetalleLoading] = useState(false);
  const [detalle, setDetalle] = useState<PosEventoDetalle | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    getPosAnalysis(
      { desde: ventana.desde, hasta: ventana.hasta, page: 1, limit: 1 },
      controller.signal,
    )
      .then((next) => setData(next))
      .catch((err: unknown) => {
        if (err instanceof AuthError) {
          onAuthFailure();
          return;
        }
        if (err instanceof RequestAbortedError) return;
        const message =
          err instanceof Error
            ? err.message
            : "No se pudo consultar los logs de terminales.";
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [ventana, onAuthFailure]);

  const analyticsModel = useMemo(
    () => analyzePosLogs(extractClientLogsFromAnalysis(data)),
    [data],
  );

  const instancias = useMemo(() => {
    const unicas = new Set<string>();
    for (const item of analyticsModel.items) {
      unicas.add(item.instancia);
    }
    return Array.from(unicas).sort((a, b) => a.localeCompare(b));
  }, [analyticsModel]);

  const granularity: "hour" | "day" =
    (data?.ventana.dias ?? 1) <= 3 ? "hour" : "day";

  function cambiarRango(next: RangoId) {
    setRango(next);
    setVentana(calcularVentana(horasDeRango(next)));
  }

  function actualizar() {
    setVentana(calcularVentana(horasDeRango(rango)));
  }

  function limpiarFiltros() {
    setActiveCard(null);
    setSubGrupo(null);
    setEventosScope({ instancia: null, serial: null });
    setClaveFiltro(TODAS);
    setTextoFiltro("");
  }

  function toggleClaveFrecuente(clave: string) {
    setActiveCard(null);
    setSubGrupo(null);
    setClaveFiltro((prev) => (prev === clave ? TODAS : clave));
  }

  async function abrirDetalle(evento: { oid: string; fecha: string }) {
    setDetalleAbierto(true);
    setDetalle(null);
    setDetalleLoading(true);
    try {
      const response = await getPosEvent({
        oid: evento.oid,
        at: evento.fecha,
        desde: ventana.desde,
        hasta: ventana.hasta,
      });
      setDetalle(response.evento);
    } catch (err: unknown) {
      if (err instanceof AuthError) {
        onAuthFailure();
        return;
      }
      const message =
        err instanceof Error ? err.message : "No se pudo cargar el detalle.";
      toast.error(message);
      setDetalleAbierto(false);
    } finally {
      setDetalleLoading(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6">
      <TerminalesHeader
        data={data}
        loading={loading}
        onActualizar={actualizar}
      />

      <TerminalesToolbar rango={rango} onRango={cambiarRango} />

      {error ? (
        <Alert variant="destructive">
          <HugeiconsIcon icon={TriangleAlertIcon} size={16} strokeWidth={2} />
          <AlertTitle>No se pudo cargar el monitoreo</AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-2">
              <span>{error}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={actualizar}
              >
                Reintentar
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {data?.fuente.parcial ? (
        <Alert>
          <HugeiconsIcon
            icon={InformationCircleIcon}
            size={16}
            strokeWidth={2}
          />
          <AlertTitle>Ventana larga: detalle técnico no descargado</AlertTitle>
          <AlertDescription>
            Para ventanas mayores a 7 días no se trae el detalle de cada evento.
            El monto en riesgo y el serial no están disponibles; abre un evento
            para consultarlo.
          </AlertDescription>
        </Alert>
      ) : null}

      {loading && !data ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : null}

      {data ? (
        <div className="flex flex-col gap-6" aria-busy={loading}>
          <span className="sr-only" aria-live="polite">
            {loading ? "Actualizando el monitoreo…" : ""}
          </span>

          <TerminalesIndicadores
            cards={analyticsModel.cards}
            activeCard={activeCard}
            onSelectCard={(next) => {
              setActiveCard(next);
              setSubGrupo(null);
            }}
            onClearFilter={limpiarFiltros}
            parcial={data.fuente.parcial}
          />

          <Card>
            <CardHeader>
              <CardTitle>Registro de eventos</CardTitle>
              <CardDescription>
                Traducción operativa de los eventos del periodo. Pasa el cursor
                sobre la descripción para ver el detalle técnico.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <PosEventosWorkspace
                model={analyticsModel}
                claves={data.claves}
                instancias={instancias}
                activeCard={activeCard}
                onSelectCard={(next) => {
                  setActiveCard(next);
                  setSubGrupo(null);
                }}
                scope={eventosScope}
                onScopeChange={setEventosScope}
                clave={claveFiltro}
                onClaveChange={setClaveFiltro}
                q={textoFiltro}
                onQChange={setTextoFiltro}
                subGrupo={subGrupo}
                onSubGrupoChange={setSubGrupo}
                loading={loading}
                maxHeightClass="max-h-[28rem]"
                onDetalle={abrirDetalle}
              />
            </CardContent>
          </Card>

          <TerminalesGraficos
            series={data.series}
            claves={data.claves}
            versiones={data.versiones}
            instancias={analyticsModel.instancias}
            cards={analyticsModel.cards}
            granularity={granularity}
            selectedClave={claveFiltro === TODAS ? undefined : claveFiltro}
            onSelectClave={toggleClaveFrecuente}
          />

          <p className="text-xs text-muted-foreground">{data.aviso}</p>
        </div>
      ) : null}

      <EventoDetalleSheet
        open={detalleAbierto}
        onOpenChange={setDetalleAbierto}
        loading={detalleLoading}
        evento={detalle}
      />

    </div>
  );
}
