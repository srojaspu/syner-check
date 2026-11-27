import {
  memo,
  useCallback,
  useState,
  type FormEvent,
} from "react";
import { es } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Calendar03Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RuedaHora, type HoraMinuto } from "./RuedaHora";
import {
  diaHoraLimaAIso,
  hoyLima,
  isoADiaLima,
  isoAHoraMinutoLima,
  validarVentana,
} from "./ventana";

const ERROR_ID = "pos-ventana-error";

/**
 * El calendario no depende de las horas: se memoiza para que mover la rueda
 * no vuelva a renderizar todo el mes en cada paso.
 */
const CalendarioRango = memo(function CalendarioRango({
  rango,
  hoy,
  onSelect,
}: {
  rango: DateRange | undefined;
  hoy: Date;
  onSelect: (next: DateRange | undefined) => void;
}) {
  return (
    <Calendar
      mode="range"
      locale={es}
      numberOfMonths={1}
      selected={rango}
      onSelect={onSelect}
      defaultMonth={rango?.from ?? hoy}
      disabled={{ after: hoy }}
      className="mx-auto"
    />
  );
});

/**
 * Selector de ventana personalizada.
 *
 * Calendario a la izquierda para el rango de días y rueda estilo iOS a la
 * derecha para la hora. El segmento Inicio/Fin decide qué extremo edita la
 * rueda. El borrador solo se aplica al enviar el formulario.
 */
export function VentanaPersonalizada({
  activa,
  desde,
  hasta,
  onAplicar,
}: {
  activa: boolean;
  desde: string;
  hasta: string;
  onAplicar: (desde: string, hasta: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rango, setRango] = useState<DateRange | undefined>(undefined);
  const [extremo, setExtremo] = useState<"inicio" | "fin">("inicio");
  const [inicio, setInicio] = useState<HoraMinuto>({ hora: "00", minuto: "00" });
  const [fin, setFin] = useState<HoraMinuto>({ hora: "23", minuto: "59" });
  const [error, setError] = useState<string | null>(null);
  const [hoy, setHoy] = useState(() => hoyLima());

  const cambiarRango = useCallback((next: DateRange | undefined) => {
    setRango(next);
    setError(null);
  }, []);

  function cambiarOpen(next: boolean) {
    if (next) {
      setHoy(hoyLima());
      setRango({
        from: isoADiaLima(desde) ?? undefined,
        to: isoADiaLima(hasta) ?? undefined,
      });
      const horaInicio = isoAHoraMinutoLima(desde);
      const horaFin = isoAHoraMinutoLima(hasta);
      if (horaInicio) setInicio(horaInicio);
      if (horaFin) setFin(horaFin);
      setExtremo("inicio");
      setError(null);
    }
    setOpen(next);
  }

  function limpiar() {
    setRango(undefined);
    setError(null);
  }

  function cambiarHora(next: HoraMinuto) {
    if (extremo === "inicio") setInicio(next);
    else setFin(next);
    setError(null);
  }

  function usarAhora() {
    const ahora = isoAHoraMinutoLima(new Date().toISOString());
    const dia = hoyLima();
    setRango((previo) => ({ from: previo?.from ?? dia, to: dia }));
    if (ahora) setFin(ahora);
    setExtremo("fin");
    setError(null);
  }

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rango?.from) {
      setError("Elige el día de inicio en el calendario.");
      return;
    }

    // Con un solo clic en el calendario, inicio y fin comparten el mismo día.
    const diaFin = rango.to ?? rango.from;
    const desdeIso = diaHoraLimaAIso(rango.from, inicio.hora, inicio.minuto);
    const hastaIso = diaHoraLimaAIso(diaFin, fin.hora, fin.minuto);
    if (!desdeIso || !hastaIso) {
      setError("Usa una fecha y hora válidas.");
      return;
    }

    const resultado = validarVentana(desdeIso, hastaIso);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }

    onAplicar(resultado.ventana.desde, resultado.ventana.hasta);
    setOpen(false);
  }

  const horaActiva = extremo === "inicio" ? inicio : fin;

  return (
    <Popover open={open} onOpenChange={cambiarOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant={activa ? "default" : "outline"}
          />
        }
      >
        <HugeiconsIcon
          icon={Calendar03Icon}
          size={15}
          strokeWidth={2}
          aria-hidden
        />
        Personalizado
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={14}
          strokeWidth={2}
          className="text-muted-foreground"
          aria-hidden
        />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-1.5rem))] gap-3 overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-2">
          <PopoverHeader>
            <PopoverTitle>Rango personalizado</PopoverTitle>
            <PopoverDescription>
              Fecha y hora de Perú (GMT-5). Máximo 31 días.
            </PopoverDescription>
          </PopoverHeader>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-auto shrink-0 px-1.5 text-xs"
            onClick={limpiar}
          >
            Limpiar
          </Button>
        </div>

        <form className="flex flex-col gap-3" onSubmit={enviar} noValidate>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
            <div className="shrink-0 rounded-2xl border border-border/60">
              <CalendarioRango
                rango={rango}
                hoy={hoy}
                onSelect={cambiarRango}
              />
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 rounded-2xl border border-border/60 p-3">
              <div
                role="group"
                aria-label="Extremo a editar"
                className="grid grid-cols-2 gap-0.5 rounded-full bg-muted p-0.5"
              >
                {([
                  { lado: "inicio" as const, texto: "Inicio", valor: inicio },
                  { lado: "fin" as const, texto: "Fin", valor: fin },
                ]).map(({ lado, texto, valor }) => {
                  const activo = extremo === lado;
                  return (
                    <button
                      key={lado}
                      type="button"
                      aria-label={`Editar hora de ${lado}`}
                      aria-pressed={activo}
                      onClick={() => {
                        setExtremo(lado);
                        setError(null);
                      }}
                      className={cn(
                        "flex items-center justify-center gap-1 rounded-full px-1.5 py-1.5 text-xs transition-colors",
                        activo
                          ? "bg-background font-medium text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span>{texto}</span>
                      <span className="font-mono tabular-nums">
                        {valor.hora}:{valor.minuto}
                      </span>
                    </button>
                  );
                })}
              </div>

              <RuedaHora
                etiqueta={extremo}
                valor={horaActiva}
                onChange={cambiarHora}
              />

              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-[11px] text-muted-foreground">
                  Hora de Perú
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-auto px-0 text-xs"
                  onClick={usarAhora}
                >
                  Ahora
                </Button>
              </div>
            </div>
          </div>

          {error ? (
            <p id={ERROR_ID} role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm">
              Aplicar
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
