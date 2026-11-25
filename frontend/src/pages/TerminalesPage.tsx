import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  InformationCircleIcon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import { AuthError, RequestAbortedError } from "../api/client";
import { getPosAnalysis, getPosEvent, searchPosOrder } from "../api/posLogs";
import type {
  PosAnalysis,
  PosEvento,
  PosEventoDetalle,
  PosFalla,
  PosPedidoResponse,
  PosTerminal,
} from "../api/types";
import { EventoDetalleSheet } from "../components/pos/EventoDetalleSheet";
import {
  EventosDialog,
  type EventosScope,
} from "../components/pos/EventosDialog";
import { FallasTable } from "../components/pos/FallasTable";
import { PedidoSheet } from "../components/pos/PedidoSheet";
import {
  horasDeRango,
  RANGO_POR_DEFECTO,
  type RangoId,
} from "../components/pos/rangos";
import { TerminalesGraficos } from "../components/pos/TerminalesGraficos";
import { TerminalesHeader } from "../components/pos/TerminalesHeader";
import { TerminalesIndicadores } from "../components/pos/TerminalesIndicadores";
import { TerminalesTable } from "../components/pos/TerminalesTable";
import { TerminalesToolbar } from "../components/pos/TerminalesToolbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface TerminalesPageProps {
  onAuthFailure: () => void;
}

function calcularVentana(horas: number): { desde: string; hasta: string } {
  const hasta = new Date();
  hasta.setSeconds(0, 0); // minuto exacto: comparte caché con otras peticiones
  const desde = new Date(hasta.getTime() - horas * 3_600_000);
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

export default function TerminalesPage({ onAuthFailure }: TerminalesPageProps) {
  const [rango, setRango] = useState<RangoId>(RANGO_POR_DEFECTO);
  const [ventana, setVentana] = useState(() =>
    calcularVentana(horasDeRango(RANGO_POR_DEFECTO)),
  );

  const [data, setData] = useState<PosAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [eventosAbierto, setEventosAbierto] = useState(false);
  const [eventosScope, setEventosScope] = useState<EventosScope>({
    instancia: null,
    serial: null,
  });

  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const [detalleLoading, setDetalleLoading] = useState(false);
  const [detalle, setDetalle] = useState<PosEventoDetalle | null>(null);

  const [pedidoNumero, setPedidoNumero] = useState("");
  const [pedidoAbierto, setPedidoAbierto] = useState(false);
  const [pedidoLoading, setPedidoLoading] = useState(false);
  const [pedido, setPedido] = useState<PosPedidoResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    // La pantalla principal solo necesita agregados y tablas; los eventos se
    // consultan en el modal con sus propios filtros.
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

  const instancias = useMemo(() => {
    const unicas = new Set<string>();
    for (const terminal of data?.terminales ?? []) {
      unicas.add(terminal.instancia);
    }
    return Array.from(unicas).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const granularity: "hour" | "day" =
    (data?.ventana.dias ?? 1) <= 3 ? "hour" : "day";

  const ventanaDialogo = data?.ventana ?? {
    desde: ventana.desde,
    hasta: ventana.hasta,
    tz: "America/Lima",
    dias: horasDeRango(rango),
  };

  function cambiarRango(next: RangoId) {
    setRango(next);
    setVentana(calcularVentana(horasDeRango(next)));
  }

  function actualizar() {
    setVentana(calcularVentana(horasDeRango(rango)));
  }

  function abrirEventos(
    scope: { instancia?: string | null; serial?: string | null } = {},
  ) {
    setEventosScope({
      instancia: scope.instancia ?? null,
      serial: scope.serial ?? null,
    });
    setEventosAbierto(true);
  }

  function verTerminal(terminal: PosTerminal) {
    abrirEventos({
      instancia: terminal.instancia,
      serial: terminal.serial,
    });
  }

  function verFalla(falla: PosFalla) {
    abrirEventos({ instancia: falla.instancia });
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

  async function buscarPedido() {
    const numero = pedidoNumero.trim();
    if (!/^\d{1,12}$/.test(numero)) {
      toast.error("El número de pedido debe tener solo dígitos.");
      return;
    }
    setPedidoAbierto(true);
    setPedido(null);
    setPedidoLoading(true);
    try {
      const response = await searchPosOrder(numero, calcularVentana(24 * 7));
      setPedido(response);
    } catch (err: unknown) {
      if (err instanceof AuthError) {
        onAuthFailure();
        return;
      }
      const message =
        err instanceof Error ? err.message : "No se pudo buscar el pedido.";
      toast.error(message);
      setPedidoAbierto(false);
    } finally {
      setPedidoLoading(false);
    }
  }

  function verEventoDePedido(evento: PosEvento) {
    setPedidoAbierto(false);
    void abrirDetalle(evento);
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6">
      <TerminalesHeader
        data={data}
        loading={loading}
        onVerEventos={() => abrirEventos()}
        onActualizar={actualizar}
      />

      <TerminalesToolbar
        rango={rango}
        onRango={cambiarRango}
        pedidoNumero={pedidoNumero}
        onPedidoNumero={setPedidoNumero}
        onBuscarPedido={() => void buscarPedido()}
        pedidoLoading={pedidoLoading}
      />

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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : null}

      {data ? (
        <div className="flex flex-col gap-6" aria-busy={loading}>
          <span className="sr-only" aria-live="polite">
            {loading ? "Actualizando el monitoreo…" : ""}
          </span>

          <TerminalesIndicadores kpis={data.kpis} />

          <TerminalesGraficos
            series={data.series}
            claves={data.claves}
            versiones={data.versiones}
            granularity={granularity}
          />

          <TerminalesTable
            terminales={data.terminales}
            hayEventos={data.kpis.eventos > 0}
            onVerEventos={verTerminal}
          />

          <FallasTable
            fallas={data.fallas}
            onFiltrar={verFalla}
            onVerMuestra={(falla) =>
              void abrirDetalle({
                oid: falla.oidMuestra,
                fecha: falla.ultima,
              })
            }
          />

          <p className="text-xs text-muted-foreground">{data.aviso}</p>
        </div>
      ) : null}

      <EventosDialog
        open={eventosAbierto}
        onOpenChange={setEventosAbierto}
        ventana={ventanaDialogo}
        instancias={instancias}
        claves={data?.claves ?? []}
        scope={eventosScope}
        onScopeChange={setEventosScope}
        onAuthFailure={onAuthFailure}
        onDetalle={abrirDetalle}
      />

      <EventoDetalleSheet
        open={detalleAbierto}
        onOpenChange={setDetalleAbierto}
        loading={detalleLoading}
        evento={detalle}
      />

      <PedidoSheet
        open={pedidoAbierto}
        onOpenChange={setPedidoAbierto}
        numero={pedidoNumero}
        loading={pedidoLoading}
        pedido={pedido}
        onVerDetalle={verEventoDePedido}
      />
    </div>
  );
}
