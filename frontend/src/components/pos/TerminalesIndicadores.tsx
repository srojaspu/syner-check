import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Database01Icon,
  Store01Icon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { numeroFmt } from "./format";
import { PosKpiCard } from "./PosKpiCard";
import type { PosKpiCardId, PosOperationalCards } from "./posAnalytics";

export const KPI_CARD_TITLES: Record<PosKpiCardId, string> = {
  ventas_exitosas: "Ventas 100% Exitosas",
  ventas_resueltas: "Ventas con Incidencias Resueltas",
  ventas_fallidas: "Ventas Fallidas o Inconclusas",
  incidentes_caja: "Incidentes de Caja",
  errores_instancia: "Errores de Instancia / NUC",
};

export function TerminalesIndicadores({
  cards,
  activeCard,
  onSelectCard,
  onClearFilter,
  parcial = false,
  compact = false,
}: {
  cards: PosOperationalCards;
  activeCard: PosKpiCardId | null;
  onSelectCard: (card: PosKpiCardId | null) => void;
  onClearFilter?: () => void;
  parcial?: boolean;
  compact?: boolean;
}) {
  function toggle(id: PosKpiCardId) {
    onSelectCard(activeCard === id ? null : id);
  }

  const fallidasHint = parcial
    ? "monto no disponible (ventana > 7 días)"
    : cards.ventasFallidas.count > 0 && cards.ventasFallidas.montoRiesgo !== null
      ? `S/ ${cards.ventasFallidas.montoRiesgo} en riesgo · ${cards.ventasFallidas.inconclusas} inconclusas`
      : cards.ventasFallidas.count > 0
        ? `${cards.ventasFallidas.inconclusas} inconclusas · ${cards.ventasFallidas.cobroSinEmision} sin comprobante`
        : "Sin pedidos inconclusos";

  const cajaHint =
    cards.incidentesCaja.count === 0
      ? "Sin incidentes de caja"
      : `${cards.incidentesCaja.grupos.length} caja(s) · ${cards.incidentesCaja.bloqueantes} bloquean ventas`;

  const nucHint =
    cards.erroresInstancia.count === 0
      ? "Sin timeouts ni caídas de servidor local"
      : `${cards.erroresInstancia.instanciasAfectadas} instancia(s) afectada(s)`;

  return (
    <section
      className="flex flex-col gap-2"
      aria-label="Indicadores operativos"
    >
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <PosKpiCard
          label={KPI_CARD_TITLES.ventas_exitosas}
          value={numeroFmt.format(cards.ventasExitosas.count)}
          hint={
            cards.ventasExitosas.count > 0
              ? `${numeroFmt.format(cards.ventasExitosas.conTarjeta)} con tarjeta · sin advertencias`
              : "Sin pedidos completados"
          }
          tone="ok"
          compact={compact}
          active={activeCard === "ventas_exitosas"}
          onClick={() => toggle("ventas_exitosas")}
          icon={
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={compact ? 14 : 15}
              strokeWidth={2}
            />
          }
        />

        <PosKpiCard
          label={KPI_CARD_TITLES.ventas_resueltas}
          value={numeroFmt.format(cards.ventasResueltas.count)}
          hint={
            cards.ventasResueltas.count > 0
              ? `${numeroFmt.format(cards.ventasResueltas.advertenciasCount)} advertencia(s) superada(s)`
              : "Sin advertencias en ventas emitidas"
          }
          tone="warn"
          compact={compact}
          active={activeCard === "ventas_resueltas"}
          onClick={() => toggle("ventas_resueltas")}
          icon={
            <HugeiconsIcon
              icon={Alert02Icon}
              size={compact ? 14 : 15}
              strokeWidth={2}
            />
          }
        />

        <PosKpiCard
          label={KPI_CARD_TITLES.ventas_fallidas}
          value={numeroFmt.format(cards.ventasFallidas.count)}
          hint={fallidasHint}
          tone="critical"
          alerta={cards.ventasFallidas.count > 0}
          compact={compact}
          active={activeCard === "ventas_fallidas"}
          onClick={() => toggle("ventas_fallidas")}
          icon={
            <HugeiconsIcon
              icon={TriangleAlertIcon}
              size={compact ? 14 : 15}
              strokeWidth={2}
            />
          }
        />

        <PosKpiCard
          label={KPI_CARD_TITLES.incidentes_caja}
          value={numeroFmt.format(cards.incidentesCaja.count)}
          hint={cajaHint}
          tone="caja"
          alerta={cards.incidentesCaja.bloqueantes > 0}
          compact={compact}
          active={activeCard === "incidentes_caja"}
          onClick={() => toggle("incidentes_caja")}
          icon={
            <HugeiconsIcon
              icon={Store01Icon}
              size={compact ? 14 : 15}
              strokeWidth={2}
            />
          }
        />

        <PosKpiCard
          label={KPI_CARD_TITLES.errores_instancia}
          value={numeroFmt.format(cards.erroresInstancia.count)}
          hint={nucHint}
          tone="nuc"
          alerta={cards.erroresInstancia.count > 0}
          compact={compact}
          active={activeCard === "errores_instancia"}
          onClick={() => toggle("errores_instancia")}
          icon={
            <HugeiconsIcon
              icon={Database01Icon}
              size={compact ? 14 : 15}
              strokeWidth={2}
            />
          }
        />
      </div>

      {!compact ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            Haz clic en una tarjeta para filtrar el registro de eventos; vuelve
            a hacer clic para ver todos.
          </span>
          {activeCard ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => (onClearFilter ? onClearFilter() : onSelectCard(null))}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
              Limpiar filtro
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
