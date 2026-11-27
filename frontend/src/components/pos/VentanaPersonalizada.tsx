import { useState, type FormEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Calendar03Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  isoAHoraLocal,
  resolverVentanaPersonalizada,
} from "./ventana";

const DESDE_ID = "pos-ventana-desde";
const HASTA_ID = "pos-ventana-hasta";
const ERROR_ID = "pos-ventana-error";

/**
 * Selector de ventana personalizada (fecha y hora de inicio y fin).
 *
 * Mantiene un borrador local: mientras el usuario edita no se consulta nada.
 * Solo al enviar el formulario se valida y se entrega la ventana en ISO con
 * offset de Perú. El popover se cierra sin aplicar con Cancelar o Escape.
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
  const [borradorDesde, setBorradorDesde] = useState("");
  const [borradorHasta, setBorradorHasta] = useState("");
  const [error, setError] = useState<string | null>(null);

  function cambiarOpen(next: boolean) {
    if (next) {
      setBorradorDesde(isoAHoraLocal(desde));
      setBorradorHasta(isoAHoraLocal(hasta));
      setError(null);
    }
    setOpen(next);
  }

  function cambiarBorrador(
    setter: (valor: string) => void,
    valor: string,
  ) {
    setter(valor);
    setError(null);
  }

  function usarAhora() {
    cambiarBorrador(
      setBorradorHasta,
      isoAHoraLocal(new Date().toISOString()),
    );
  }

  function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const resultado = resolverVentanaPersonalizada(
      borradorDesde,
      borradorHasta,
    );
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    onAplicar(resultado.ventana.desde, resultado.ventana.hasta);
    setOpen(false);
  }

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
        className="w-[min(22rem,calc(100vw-1.5rem))] gap-3"
      >
        <PopoverHeader>
          <PopoverTitle>Rango personalizado</PopoverTitle>
          <PopoverDescription>
            Fecha y hora de Perú (GMT-5). Máximo 31 días.
          </PopoverDescription>
        </PopoverHeader>

        <form className="flex flex-col gap-3" onSubmit={enviar} noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={DESDE_ID}>Desde</Label>
            <Input
              id={DESDE_ID}
              type="datetime-local"
              step={60}
              value={borradorDesde}
              max={borradorHasta || undefined}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? ERROR_ID : undefined}
              autoFocus
              onChange={(event) =>
                cambiarBorrador(setBorradorDesde, event.target.value)
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={HASTA_ID}>Hasta</Label>
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
            <Input
              id={HASTA_ID}
              type="datetime-local"
              step={60}
              value={borradorHasta}
              min={borradorDesde || undefined}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? ERROR_ID : undefined}
              onChange={(event) =>
                cambiarBorrador(setBorradorHasta, event.target.value)
              }
            />
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
