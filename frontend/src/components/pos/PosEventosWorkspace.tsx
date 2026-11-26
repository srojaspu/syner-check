import { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { PosClave, PosEvento } from "../../api/types";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EventosFiltros } from "./EventosFiltros";
import { EventosTable } from "./EventosTable";
import { TODAS, type EventosScope } from "./eventos";
import { KPI_CARD_TITLES } from "./TerminalesIndicadores";
import {
  filterPosLogs,
  type KpiSubGroup,
  type PosAnalyticsModel,
  type PosKpiCardId,
} from "./posAnalytics";

/**
 * Espacio de trabajo de eventos de la pestaña Terminales: filtros, desgloses
 * contextuales de las tarjetas KPI y tabla con ordenamiento y paginación.
 */
export function PosEventosWorkspace({
  model,
  claves,
  instancias,
  activeCard,
  onSelectCard,
  scope,
  onScopeChange,
  clave,
  onClaveChange,
  q,
  onQChange,
  subGrupo,
  onSubGrupoChange,
  loading,
  maxHeightClass = "max-h-[30rem]",
  onDetalle,
}: {
  model: PosAnalyticsModel;
  claves: PosClave[];
  instancias: string[];
  activeCard: PosKpiCardId | null;
  onSelectCard: (card: PosKpiCardId | null) => void;
  scope: EventosScope;
  onScopeChange: (scope: EventosScope) => void;
  clave: string;
  onClaveChange: (value: string) => void;
  q: string;
  onQChange: (value: string) => void;
  subGrupo: string | null;
  onSubGrupoChange: (value: string | null) => void;
  loading: boolean;
  maxHeightClass?: string;
  onDetalle: (evento: PosEvento) => void;
}) {
  const qDebounced = useDebouncedValue(q, 150);
  const effectiveQ = q === "" ? "" : qDebounced;

  const filtered = useMemo(
    () =>
      filterPosLogs(model, {
        card: activeCard,
        subGrupo,
        instancia: scope.instancia,
        serial: scope.serial,
        clave: clave === TODAS ? null : clave,
        q: effectiveQ,
      }),
    [
      model,
      activeCard,
      subGrupo,
      scope.instancia,
      scope.serial,
      clave,
      effectiveQ,
    ],
  );

  const hasActiveFilter = Boolean(
    activeCard ||
      subGrupo ||
      scope.instancia ||
      scope.serial ||
      clave !== TODAS ||
      q.trim(),
  );

  function limpiarTodo() {
    onSelectCard(null);
    onSubGrupoChange(null);
    onScopeChange({ instancia: null, serial: null });
    onClaveChange(TODAS);
    onQChange("");
  }

  // Sub-agrupaciones contextuales para Card 3 (pedidos), Card 4 (cajas) y Card 5 (instancias)
  let contextualGroups: KpiSubGroup[] = [];
  let contextualTitle = "";
  if (activeCard === "incidentes_caja") {
    contextualGroups = model.cards.incidentesCaja.grupos;
    contextualTitle = "Agrupado por caja:";
  } else if (activeCard === "errores_instancia") {
    contextualGroups = model.cards.erroresInstancia.grupos;
    contextualTitle = "Agrupado por instancia / NUC:";
  } else if (activeCard === "ventas_fallidas") {
    contextualGroups = model.cards.ventasFallidas.pedidos;
    contextualTitle = "Pedidos por verificar:";
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {activeCard ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <span>{KPI_CARD_TITLES[activeCard]}</span>
              <button
                type="button"
                onClick={() => {
                  onSelectCard(null);
                  onSubGrupoChange(null);
                }}
                aria-label={`Quitar filtro ${KPI_CARD_TITLES[activeCard]}`}
                className="rounded-full p-0.5 hover:bg-foreground/10"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
              </button>
            </Badge>

            {contextualGroups.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground">{contextualTitle}</span>
                {contextualGroups.slice(0, 8).map((group) => {
                  const isInstanciaCard = activeCard === "errores_instancia";
                  const selected = isInstanciaCard
                    ? scope.instancia === group.key
                    : subGrupo === group.key;
                  return (
                    <button
                      key={group.key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        if (isInstanciaCard) {
                          onScopeChange({
                            instancia: selected ? null : group.key,
                            serial: null,
                          });
                        } else {
                          onSubGrupoChange(selected ? null : group.key);
                        }
                      }}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                        selected
                          ? "border-primary/50 bg-primary text-primary-foreground"
                          : "border-border bg-background hover:bg-muted"
                      }`}
                    >
                      <span>{group.label}</span>
                      <span className="tabular-nums opacity-75">
                        ({group.count})
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={limpiarTodo}
          >
            Ver todos los registros
          </Button>
        </div>
      ) : null}

      <EventosFiltros
        scope={scope}
        instancias={instancias}
        claves={claves}
        clave={clave}
        q={q}
        hasActiveFilter={hasActiveFilter}
        onScopeChange={onScopeChange}
        onClave={onClaveChange}
        onQ={onQChange}
        onLimpiar={limpiarTodo}
      />

      <EventosTable
        items={filtered}
        loading={loading && model.items.length === 0}
        onDetalle={onDetalle}
        maxHeightClass={maxHeightClass}
      />
    </div>
  );
}
