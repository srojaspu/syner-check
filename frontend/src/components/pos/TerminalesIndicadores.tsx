import type { PosKpis } from "../../api/types";
import { PosKpiCard } from "./PosKpiCard";
import { numeroFmt } from "./format";

export function TerminalesIndicadores({ kpis }: { kpis: PosKpis }) {
  return (
    <section
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
      aria-label="Indicadores"
    >
      <PosKpiCard
        label="Eventos"
        value={numeroFmt.format(kpis.eventos)}
        hint={
          kpis.terminalesSinSerial !== null
            ? `${kpis.terminales} terminales · ${kpis.instancias} instancias`
            : `${kpis.instancias} instancias`
        }
      />
      <PosKpiCard
        label="Errores"
        value={numeroFmt.format(kpis.error)}
        hint={`${numeroFmt.format(kpis.warn)} advertencias`}
        alerta={kpis.error > 0}
      />
      <PosKpiCard
        label="Cajas con falla"
        value={numeroFmt.format(kpis.cajasConFalla)}
        hint="ventas bloqueadas hasta reintentar"
        alerta={kpis.cajasConFalla > 0}
      />
      <PosKpiCard
        label="Emisiones inconclusas"
        value={numeroFmt.format(kpis.emisionesInconclusas)}
        hint={
          kpis.montoEnRiesgo !== null
            ? `S/ ${kpis.montoEnRiesgo} en riesgo`
            : "monto no disponible"
        }
        alerta={kpis.emisionesInconclusas > 0}
      />
      <PosKpiCard
        label="Cobros con tarjeta"
        value={numeroFmt.format(kpis.cobrosTarjeta)}
        hint={`${numeroFmt.format(kpis.emisionesOk)} emisiones OK`}
      />
      <PosKpiCard
        label="Terminales"
        value={numeroFmt.format(kpis.terminales)}
        hint={
          kpis.terminalesSinSerial !== null
            ? `${kpis.terminalesSinSerial} sin serial`
            : "identidad por instancia"
        }
      />
      <p className="col-span-full text-[11px] text-muted-foreground">
        Indicadores de toda la ventana. Los filtros se aplican a la tabla de
        eventos.
      </p>
    </section>
  );
}
