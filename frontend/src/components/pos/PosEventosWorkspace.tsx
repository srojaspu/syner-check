import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import type { PosClave, PosEvento } from "../../api/types";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EventosFiltros } from "./EventosFiltros";
import { EventosTable } from "./EventosTable";
import { FadeScroll } from "./FadeScroll";
import { numeroFmt } from "./format";
import { TODAS, TODOS, type EventosScope } from "./eventos";
import { KPI_CARD_TITLES } from "./TerminalesIndicadores";
import {
  filterPosLogs,
  type KpiSubGroup,
  type PosAnalyticsModel,
  type PosKpiCardId,
} from "./posAnalytics";

const PAGE_SIZE = 50;

/**
 * Espacio de trabajo reutilizable de eventos (usado tanto en la pestaña
 * principal de Terminales como en el modal ampliado `EventosDialog`).
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
  nivel,
  onNivelChange,
  q,
  onQChange,
  subGrupo,
  onSubGrupoChange,
  loading,
  fadeFrom = "card",
  maxHeightClass = "max-h-[30rem]",
  onDetalle,
  onVerPedido,
  onActualizar,
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
  nivel: string;
  onNivelChange: (value: string) => void;
  q: string;
  onQChange: (value: string) => void;
  subGrupo: string | null;
  onSubGrupoChange: (value: string | null) => void;
  loading: boolean;
  fadeFrom?: "card" | "popover";
  maxHeightClass?: string;
  onDetalle: (evento: PosEvento) => void;
  onVerPedido?: (numero: string) => void;
  onActualizar?: () => void;
}) {
  const [page, setPage] = useState(1);
  const qDebounced = useDebouncedValue(q, 150);
  const effectiveQ = q === "" ? "" : qDebounced;

  useEffect(() => {
    setPage(1);
  }, [activeCard, subGrupo, scope.instancia, scope.serial, clave, nivel, effectiveQ]);

  const filtered = useMemo(
    () =>
      filterPosLogs(model, {
        card: activeCard,
        subGrupo,
        instancia: scope.instancia,
        serial: scope.serial,
        nivel: nivel === TODOS ? null : nivel,
        clave: clave === TODAS ? null : clave,
        q: effectiveQ,
      }),
    [model, activeCard, subGrupo, scope.instancia, scope.serial, nivel, clave, effectiveQ],
  );

  const paginas = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, paginas);
  const slice = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  const hasActiveFilter = Boolean(
    activeCard ||
      subGrupo ||
      scope.instancia ||
      scope.serial ||
      nivel !== TODOS ||
      clave !== TODAS ||
      q.trim(),
  );

  function limpiarTodo() {
    onSelectCard(null);
    onSubGrupoChange(null);
    onScopeChange({ instancia: null, serial: null });
    onNivelChange(TODOS);
    onClaveChange(TODAS);
    onQChange("");
    setPage(1);
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
        nivel={nivel}
        clave={clave}
        q={q}
        loading={loading}
        hasActiveFilter={hasActiveFilter}
        onScopeChange={onScopeChange}
        onNivel={onNivelChange}
        onClave={onClaveChange}
        onQ={onQChange}
        onLimpiar={limpiarTodo}
        onActualizar={onActualizar}
      />

      <FadeScroll
        className={`${maxHeightClass} rounded-md border`}
        fadeFrom={fadeFrom}
      >
        <EventosTable
          items={slice}
          loading={loading && model.items.length === 0}
          onDetalle={onDetalle}
          onVerPedido={onVerPedido}
        />
      </FadeScroll>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {numeroFmt.format(filtered.length)} de{" "}
          {numeroFmt.format(model.items.length)} eventos · página {safePage} de{" "}
          {paginas}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading || safePage <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <HugeiconsIcon
              icon={ArrowLeftIcon}
              size={14}
              strokeWidth={2}
              aria-hidden
            />
            Anterior
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading || safePage >= paginas}
            onClick={() => setPage((current) => Math.min(paginas, current + 1))}
          >
            Siguiente
            <HugeiconsIcon
              icon={ArrowRightIcon}
              size={14}
              strokeWidth={2}
              aria-hidden
            />
          </Button>
        </div>
      </div>
    </div>
  );
}
