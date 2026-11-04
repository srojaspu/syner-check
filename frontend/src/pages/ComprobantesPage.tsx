import { useCallback, useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { FileDownIcon, Loading02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { exportExcel } from "../api/excel";
import { formatMoney } from "../api/format";
import type { FlowStageKey, Voucher } from "../api/types";
import { DataTable } from "@/components/DataTable";
import { DetailDrawer } from "@/components/DetailDrawer";
import { FlowBar } from "@/components/FlowBar";
import { MovSynerPosConfirmDialog } from "@/components/MovSynerPosConfirmDialog";
import {
  NotificationHost,
  type NotificationItem,
} from "@/components/NotificationCenter";
import { NumberPanel, RangePanel } from "@/components/SearchPanels";
import { ResultsCard } from "@/components/ResultsCard";
import { SunatConfirmDialog } from "@/components/SunatConfirmDialog";
import { Tabs } from "@/components/Tabs";
import {
  voucherColumns,
  voucherSelectionKey,
} from "@/components/columns";
import { useDocument } from "@/hooks/useDocument";
import { useVouchers, type SearchMode } from "@/hooks/useVouchers";
import { useOperations } from "@/operations/OperationsContext";

interface FlowSelection {
  stage: FlowStageKey;
  state: string;
  label: string;
  rows: Voucher[];
}

/**
 * Pantalla de comprobantes (origen SynerPOS).
 *
 * Extraccion pura de la pantalla que existia dentro de `App.tsx`: mismo
 * DOM, mismo comportamiento. La unica diferencia es que recibe
 * `onAuthFailure` por props en vez de llamar a `useSession` aqui.
 */
export default function ComprobantesPage({
  onAuthFailure,
}: {
  onAuthFailure: () => void;
}) {
  const vouchers = useVouchers(onAuthFailure);
  const detail = useDocument(onAuthFailure);
  const { sunat, movsynerpos, active: operationActive } = useOperations();
  const [mode, setMode] = useState<SearchMode>("range");
  const [copied, setCopied] = useState(false);
  const [sunatDialogOpen, setSunatDialogOpen] = useState(false);
  const [movSynerPosDialogOpen, setMovSynerPosDialogOpen] = useState(false);
  const [movSynerPosTarget, setMovSynerPosTarget] = useState<Voucher[] | null>(
    null,
  );
  const [flowSelection, setFlowSelection] = useState<FlowSelection | null>(
    null,
  );
  const [lastRange, setLastRange] = useState<{
    start: string;
    end: string;
    types: string;
  } | null>(null);
  const [lastNumber, setLastNumber] = useState<string | null>(null);
  // Filtered rows (all pages) reported up by the table; null = not yet
  // reported (e.g. right after a search) → fall back to all rows.
  const [filteredRows, setFilteredRows] = useState<Voucher[] | null>(null);
  /** Documentos marcados manualmente (sobrevive al cambio de página). */
  const [seleccion, setSeleccion] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const handleFilteredRowsChange = useCallback((rows: Voucher[]) => {
    setFilteredRows(rows);
  }, []);
  const tableRows = flowSelection?.rows ?? vouchers.rows;
  const effectiveRows = filteredRows ?? tableRows;
  const hasTableFilter =
    filteredRows !== null && filteredRows.length !== tableRows.length;
  const isFiltered = flowSelection !== null || hasTableFilter;

  const toggleSeleccion = useCallback((key: string, marcado: boolean) => {
    setSeleccion((prev) => {
      const siguiente = new Set(prev);
      if (marcado) siguiente.add(key);
      else siguiente.delete(key);
      return siguiente;
    });
  }, []);

  const togglePagina = useCallback(
    (pagina: Voucher[], marcado: boolean) => {
      setSeleccion((prev) => {
        const siguiente = new Set(prev);
        for (const fila of pagina) {
          const key = voucherSelectionKey(fila);
          if (marcado) siguiente.add(key);
          else siguiente.delete(key);
        }
        return siguiente;
      });
    },
    [],
  );

  // Si un filtro oculta un documento marcado, se desmarca: no se envía algo
  // que el usuario ya no ve en la tabla.
  useEffect(() => {
    setSeleccion((prev) => {
      if (!prev.size) return prev;
      const vigentes = new Set(effectiveRows.map(voucherSelectionKey));
      const siguiente = new Set(
        [...prev].filter((key) => vigentes.has(key)),
      );
      return siguiente.size === prev.size ? prev : siguiente;
    });
  }, [effectiveRows]);

  const selectedRows = useMemo(
    () =>
      effectiveRows.filter((row) => seleccion.has(voucherSelectionKey(row))),
    [effectiveRows, seleccion],
  );
  const hasSelection = selectedRows.length > 0;
  /** Manda la selección cuando existe; sin selección, todos los visibles. */
  const targetRows = hasSelection ? selectedRows : effectiveRows;
  const flowStageTitle =
    flowSelection?.stage === "intelisis" ? "Intelisis" : "SUNAT";
  const resultsTotal = useMemo(
    () =>
      effectiveRows.reduce(
        (sum, row) => sum + (Number(row.crossTotal) || 0),
        0,
      ),
    [effectiveRows],
  );
  const resultsCurrency =
    effectiveRows[0]?.currency?.isoCode ??
    vouchers.rows[0]?.currency?.isoCode ??
    "PEN";
  const resultsSubtitle = flowSelection
    ? `${effectiveRows.length} de ${vouchers.rows.length} documentos · ${flowStageTitle} · ${flowSelection.label}`
    : hasTableFilter
      ? `${effectiveRows.length} de ${vouchers.rows.length} documentos`
      : vouchers.subtitle;
  // El fallback de NC puede degradarse: el backend devuelve lo indexado con
  // `nc_warning` en vez de fallar, y el usuario debe saber que falta cubrir
  // esa verificación antes de concluir que el documento no existe.
  const ncWarningText = vouchers.ncWarning
    ? vouchers.ncWarning === "credit_notes_unavailable"
      ? "No se pudieron consultar las notas de crédito de este número; puede faltar algún resultado."
      : "La verificación de notas de crédito quedó incompleta."
    : null;
  const columns = useMemo(
    () =>
      voucherColumns({
        intelisisEnabled: vouchers.intelisisEnabled,
        selection: {
          seleccionados: seleccion,
          onToggle: toggleSeleccion,
          onTogglePagina: togglePagina,
        },
      }),
    [vouchers.intelisisEnabled, seleccion, toggleSeleccion, togglePagina],
  );
  const selectFlowState = useCallback(
    (stage: FlowStageKey, state: string) => {
      const summary = vouchers.flow?.stages?.[stage];
      const label =
        summary?.states.find((item) => item.key === state)?.label ?? state;
      const rows = vouchers.rows.filter(
        (row) => row.flow_states?.[stage] === state,
      );
      setFlowSelection({ stage, state, label, rows });
      setFilteredRows(null);
    },
    [vouchers.flow, vouchers.rows],
  );
  const clearFlowSelection = useCallback(() => {
    setFlowSelection(null);
    setFilteredRows(null);
  }, []);

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(String(detail.document?.number ?? ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const showDetail = (row: Voucher) => {
    setCopied(false);
    void detail.show(row);
  };

  const activeDetailDocument = useMemo(() => {
    if (!detail.document) return null;
    const freshRow = vouchers.rows.find(
      (row) =>
        row.oid === detail.document?.oid && row.tipo === detail.document?.tipo,
    );
    if (!freshRow) return detail.document;
    return {
      ...detail.document,
      in_sql: freshRow.in_sql,
      in_intelisis: freshRow.in_intelisis,
      intelisis: freshRow.intelisis ?? detail.document.intelisis,
      sunat: freshRow.sunat ?? detail.document.sunat,
      flow_states: freshRow.flow_states ?? detail.document.flow_states,
    };
  }, [detail.document, vouchers.rows]);

  const refreshRows = () => {
    // Do not reset SUNAT state here: this callback runs at the end of the
    // batch and would clear the final progress the user just saw. The flow
    // filter is cleared because a validated subset can change states.
    setFlowSelection(null);
    setFilteredRows(null);
    setSeleccion(new Set<string>());
    if (mode === "range" && lastRange) {
      return vouchers.runRange(lastRange.start, lastRange.end, lastRange.types);
    }
    if (mode === "number" && lastNumber) {
      return vouchers.runNumber(lastNumber);
    }
    return Promise.resolve();
  };

  // Un solo proceso a la vez: los botones de operación quedan bloqueados
  // mientras cualquiera esté corriendo, con el resultado abierto o refrescando.
  const operationsDisabled =
    !targetRows.length ||
    vouchers.loading ||
    operationActive ||
    sunat.refreshing ||
    movsynerpos.refreshing;

  // Los avisos de las operaciones (SUNAT / MovSynerPos) viven en
  // `OperationsHost` para que sobrevivan al cambio de pestaña. Aquí solo
  // quedan los de esta pantalla.
  const notificationItems = useMemo<NotificationItem[]>(() => {
    const list: NotificationItem[] = [];

    if (vouchers.error) {
      list.push({
        id: "synerpos-query-error",
        signature: `query-error:${vouchers.error}`,
        tone: "error",
        title: "Error de consulta",
        description: vouchers.error,
      });
    }

    if (ncWarningText) {
      list.push({
        id: "synerpos-nc-warning",
        signature: `nc-warning:${vouchers.ncWarning}`,
        tone: "warning",
        title: "Notas de crédito sin verificar",
        description: ncWarningText,
      });
    }

    if (vouchers.intelisisWarning) {
      list.push({
        id: "synerpos-intelisis-warning",
        signature: `intelisis-warning:${vouchers.intelisisWarning}`,
        tone: "warning",
        title: "Intelisis no disponible",
        description:
          "No se pudo consultar el estado en Intelisis; se muestran los comprobantes sin ese cruce.",
      });
    }

    if (detail.error) {
      list.push({
        id: "synerpos-detail-error",
        signature: `detail-error:${detail.error}`,
        tone: "error",
        onDismiss: detail.close,
        title: "No se pudo cargar el detalle",
        description: detail.error,
      });
    }

    return list;
  }, [
    vouchers.error,
    vouchers.ncWarning,
    vouchers.intelisisWarning,
    ncWarningText,
    detail.error,
    detail.close,
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Tabs
        mode={mode}
        onChange={(nextMode) => {
          setMode(nextMode);
          setSeleccion(new Set<string>());
        }}
      />

      <section>
        {mode === "range" ? (
          <RangePanel
            disabled={vouchers.loading}
            onSearch={(start, end, types) => {
              setLastRange({ start, end, types });
              setLastNumber(null);
              sunat.reset();
              movsynerpos.reset();
              setSunatDialogOpen(false);
              setMovSynerPosDialogOpen(false);
              setFlowSelection(null);
              setFilteredRows(null);
              setSeleccion(new Set<string>());
              void vouchers.runRange(start, end, types);
            }}
          />
        ) : (
          <NumberPanel
            disabled={vouchers.loading}
            onSearch={(number) => {
              setLastNumber(number);
              setLastRange(null);
              sunat.reset();
              movsynerpos.reset();
              setSunatDialogOpen(false);
              setMovSynerPosDialogOpen(false);
              setFlowSelection(null);
              setFilteredRows(null);
              setSeleccion(new Set<string>());
              void vouchers.runNumber(number);
            }}
          />
        )}
      </section>

      {vouchers.searched && vouchers.flow ? (
        <FlowBar
          flow={vouchers.flow}
          intelisisEnabled={vouchers.intelisisEnabled}
          intelisisCount={vouchers.intelisisCount}
          intelisisWarning={vouchers.intelisisWarning}
          sunatEnabled={vouchers.sunatEnabled}
          loading={vouchers.loading}
          selectedStage={flowSelection?.stage}
          selectedState={flowSelection?.state}
          onSelectState={selectFlowState}
          onClearSelection={clearFlowSelection}
        />
      ) : null}

      <ResultsCard
        title="Resultados"
        summary={resultsSubtitle}
        details={
          vouchers.searched ? (
            <p className="text-sm text-muted-foreground">
              Total mostrado:{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {formatMoney(resultsTotal, resultsCurrency)}
              </span>
            </p>
          ) : null
        }
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={operationsDisabled}
              onClick={() => setSunatDialogOpen(true)}
              title={
                hasSelection
                  ? `Valida en SUNAT los ${targetRows.length} documentos seleccionados`
                  : isFiltered
                    ? `Valida solo las ${effectiveRows.length} filas filtradas contra SUNAT`
                    : "Valida los documentos mostrados contra SUNAT en lotes"
              }
            >
              {sunat.busy ? (
                <HugeiconsIcon
                  icon={Loading02Icon}
                  size={16}
                  strokeWidth={2}
                  className="animate-spin"
                  aria-hidden
                />
              ) : null}{" "}
              Validar en SUNAT
              {hasSelection || isFiltered ? ` (${targetRows.length})` : ""}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={operationsDisabled}
              onClick={() => {
                setMovSynerPosTarget(null);
                setMovSynerPosDialogOpen(true);
              }}
              title={
                hasSelection
                  ? `Envía a MovSynerPos los ${targetRows.length} documentos seleccionados`
                  : isFiltered
                    ? `Envía a MovSynerPos solo las ${effectiveRows.length} filas filtradas`
                    : "Envía los documentos mostrados a MovSynerPos"
              }
            >
              {movsynerpos.busy ? (
                <HugeiconsIcon
                  icon={Loading02Icon}
                  size={16}
                  strokeWidth={2}
                  className="animate-spin"
                  aria-hidden
                />
              ) : null}{" "}
              Enviar a MovSynerPos
              {targetRows.length ? ` (${targetRows.length})` : ""}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!targetRows.length}
              onClick={() => void exportExcel(targetRows)}
              title={
                hasSelection
                  ? `Exporta los ${targetRows.length} documentos seleccionados`
                  : isFiltered
                    ? `Exporta solo las ${effectiveRows.length} filas filtradas`
                    : "Exporta los documentos mostrados"
              }
            >
              <HugeiconsIcon icon={FileDownIcon} size={16} strokeWidth={2} aria-hidden /> Exportar Excel
              {hasSelection || isFiltered ? ` (${targetRows.length})` : ""}
            </Button>
            {vouchers.loading ? (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <HugeiconsIcon
                  icon={Loading02Icon}
                  size={16}
                  strokeWidth={2}
                  className="animate-spin"
                  aria-hidden
                />
                {sunat.refreshing ? "Actualizando resultados…" : "Consultando…"}
              </span>
            ) : null}
          </>
        }
      >
        {flowSelection ? (
            <div
              className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-sm"
              aria-live="polite"
            >
              <span className="min-w-0">
                Mostrando{" "}
                <b>
                  {flowStageTitle} · {flowSelection.label}
                </b>{" "}
                <span className="text-muted-foreground">
                  ({tableRows.length} de {vouchers.rows.length} documentos)
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFlowSelection}
              >
                Quitar filtro
              </Button>
            </div>
          ) : null}
          <DataTable.Root
            key={
              flowSelection
                ? `${flowSelection.stage}:${flowSelection.state}`
                : "base"
            }
            data={tableRows}
            columns={columns}
            onRowClick={showDetail}
            onFilteredRowsChange={handleFilteredRowsChange}
          >
            <DataTable.Toolbar />
            <DataTable.View<Voucher> loading={vouchers.loading} />
            <DataTable.Pagination loading={vouchers.loading} />
          </DataTable.Root>
      </ResultsCard>

      <DetailDrawer
        open={detail.open}
        document={activeDetailDocument}
        loading={detail.loading}
        error={detail.error}
        copied={copied}
        validatingSunat={operationActive || sunat.refreshing}
        sendingMovSynerPos={operationActive || movsynerpos.refreshing}
        onCopy={() => void copyNumber()}
        onValidateSunat={(doc) => {
          void sunat.runBatch([doc], refreshRows, "todos");
        }}
        onSendMovSynerPos={(doc) => {
          setMovSynerPosTarget([doc]);
          setMovSynerPosDialogOpen(true);
        }}
        onClose={detail.close}
      />

      <NotificationHost items={notificationItems} />

      <SunatConfirmDialog
        open={sunatDialogOpen}
        onOpenChange={setSunatDialogOpen}
        rows={targetRows}
        onConfirm={(scope) => {
          if (operationActive) return;
          void sunat.runBatch(targetRows, refreshRows, scope);
        }}
      />

      <MovSynerPosConfirmDialog
        open={movSynerPosDialogOpen}
        onOpenChange={(open) => {
          setMovSynerPosDialogOpen(open);
          if (!open) setMovSynerPosTarget(null);
        }}
        rows={movSynerPosTarget ?? targetRows}
        onConfirm={(reparar) => {
          if (operationActive) return;
          const rowsToSend = movSynerPosTarget ?? targetRows;
          void movsynerpos.run(rowsToSend, refreshRows, reparar);
        }}
      />
    </div>
  );
}

