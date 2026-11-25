import type { PosSerie } from "../../api/types";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

const horaFmt = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const diaFmt = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  day: "2-digit",
  month: "2-digit",
});

function etiqueta(iso: string, grano: "hour" | "day"): string {
  const fecha = new Date(iso);
  return grano === "hour" ? horaFmt.format(fecha) : diaFmt.format(fecha);
}

/**
 * Barras apiladas por bucket, sin librería de gráficos.
 *
 * La altura de cada segmento es relativa al bucket más cargado, así que la
 * forma se lee igual en 1 h que en 30 días. El detalle exacto va en el
 * `title` de cada barra y en el `aria-label` del bloque.
 */
export function PosTimeline({
  series,
  granularity,
}: {
  series: PosSerie[];
  granularity: "hour" | "day";
}) {
  const total = series.reduce(
    (sum, item) => sum + item.info + item.warn + item.error + item.unknown,
    0,
  );

  if (series.length === 0 || total === 0) {
    return (
      <Empty className="border-0 p-6">
        <EmptyTitle>Sin eventos</EmptyTitle>
        <EmptyDescription>
          No hay registros en esta ventana. Prueba con un rango más amplio.
        </EmptyDescription>
      </Empty>
    );
  }

  const max = Math.max(
    1,
    ...series.map(
      (item) => item.info + item.warn + item.error + item.unknown,
    ),
  );
  const labelEvery = Math.max(1, Math.ceil(series.length / 8));

  const alto = (value: number) => `${(value / max) * 100}%`;

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex h-40 items-end gap-1"
        role="img"
        aria-label={`Eventos por ${granularity === "hour" ? "hora" : "día"}: ${total} en total`}
      >
        {series.map((item) => {
          const suma = item.info + item.warn + item.error + item.unknown;
          const fallos = item.warn + item.error;
          return (
            <div
              key={item.bucket}
              className="flex h-full min-w-0 flex-1 flex-col justify-end overflow-hidden rounded-sm"
              title={`${etiqueta(item.bucket, granularity)} · ${suma} eventos · ${fallos} fallos`}
            >
              {item.unknown > 0 ? (
                <div
                  className="w-full bg-muted-foreground/30"
                  style={{ height: alto(item.unknown) }}
                />
              ) : null}
              {item.error > 0 ? (
                <div
                  className="w-full bg-destructive"
                  style={{ height: alto(item.error) }}
                />
              ) : null}
              {item.warn > 0 ? (
                <div
                  className="w-full bg-chart-4"
                  style={{ height: alto(item.warn) }}
                />
              ) : null}
              {item.info > 0 ? (
                <div
                  className="w-full bg-chart-2"
                  style={{ height: alto(item.info) }}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <div
        className="grid gap-1 text-[10px] text-muted-foreground"
        style={{ gridTemplateColumns: `repeat(${series.length}, minmax(0, 1fr))` }}
        aria-hidden
      >
        {series.map((item, index) => (
          <span key={item.bucket} className="whitespace-nowrap text-center">
            {index % labelEvery === 0 || index === series.length - 1
              ? etiqueta(item.bucket, granularity)
              : ""}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <Leyenda color="bg-chart-2" texto="Info" />
        <Leyenda color="bg-chart-4" texto="Advertencia" />
        <Leyenda color="bg-destructive" texto="Error" />
        <Leyenda color="bg-muted-foreground/30" texto="Desconocido" />
      </div>
    </div>
  );
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2 rounded-sm ${color}`} aria-hidden />
      {texto}
    </span>
  );
}
