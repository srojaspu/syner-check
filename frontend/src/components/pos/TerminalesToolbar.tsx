import { HugeiconsIcon } from "@hugeicons/react";
import { CalendarDaysIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RANGOS, type RangoId } from "./rangos";
import {
  duracionLegible,
  etiquetaVentana,
  type SeleccionVentana,
  type Ventana,
} from "./ventana";
import { VentanaPersonalizada } from "./VentanaPersonalizada";

export function TerminalesToolbar({
  seleccion,
  ventana,
  onPreset,
  onPersonalizada,
}: {
  seleccion: SeleccionVentana;
  ventana: Ventana;
  onPreset: (rango: RangoId) => void;
  onPersonalizada: (desde: string, hasta: string) => void;
}) {
  const duracion = duracionLegible(ventana.desde, ventana.hasta);

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <HugeiconsIcon
            icon={CalendarDaysIcon}
            size={16}
            strokeWidth={2}
            className="mr-1 text-muted-foreground"
            aria-hidden
          />
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="Rangos rápidos"
          >
            {RANGOS.map((item) => {
              const activo =
                seleccion.tipo === "preset" && seleccion.rango === item.id;
              return (
                <Button
                  key={item.id}
                  type="button"
                  size="sm"
                  variant={activo ? "default" : "outline"}
                  aria-pressed={activo}
                  onClick={() => onPreset(item.id)}
                >
                  {item.label}
                </Button>
              );
            })}
          </div>

          <span
            aria-hidden
            className="mx-1 hidden h-5 w-px bg-border sm:block"
          />

          <VentanaPersonalizada
            activa={seleccion.tipo === "personalizada"}
            desde={ventana.desde}
            hasta={ventana.hasta}
            onAplicar={onPersonalizada}
          />
        </div>

        <p className="w-full text-xs text-muted-foreground sm:ml-auto sm:w-auto sm:text-right">
          <span className="font-medium text-foreground">
            {etiquetaVentana(ventana)}
          </span>
          {duracion ? (
            <>
              <span aria-hidden> · </span>
              <span>{duracion}</span>
            </>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}
