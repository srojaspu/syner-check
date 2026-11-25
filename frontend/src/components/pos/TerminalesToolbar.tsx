import { HugeiconsIcon } from "@hugeicons/react";
import {
  CalendarDaysIcon,
  Loading02Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RANGOS, type RangoId } from "./rangos";

export function TerminalesToolbar({
  rango,
  onRango,
  pedidoNumero,
  onPedidoNumero,
  onBuscarPedido,
  pedidoLoading,
}: {
  rango: RangoId;
  onRango: (rango: RangoId) => void;
  pedidoNumero: string;
  onPedidoNumero: (value: string) => void;
  onBuscarPedido: () => void;
  pedidoLoading: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Rango de la ventana"
        >
          <HugeiconsIcon
            icon={CalendarDaysIcon}
            size={16}
            strokeWidth={2}
            className="mr-1 text-muted-foreground"
            aria-hidden
          />
          {RANGOS.map((item) => (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={item.id === rango ? "default" : "outline"}
              aria-pressed={item.id === rango}
              onClick={() => onRango(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onBuscarPedido();
          }}
        >
          <Input
            value={pedidoNumero}
            onChange={(event) => onPedidoNumero(event.target.value)}
            placeholder="Buscar pedido (ej. 03902)"
            inputMode="numeric"
            aria-label="Número de pedido"
            className="w-48"
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={pedidoLoading || !pedidoNumero.trim()}
          >
            <HugeiconsIcon
              icon={pedidoLoading ? Loading02Icon : Search01Icon}
              size={15}
              strokeWidth={2}
              className={pedidoLoading ? "animate-spin" : undefined}
              aria-hidden
            />
            Buscar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
