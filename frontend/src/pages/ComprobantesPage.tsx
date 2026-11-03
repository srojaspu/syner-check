import { useCallback, useMemo, useState } from "react";
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
import { MovSynerPosProgress } from "@/components/MovSynerPosProgress";
import {
  NotificationAlert,
  NotificationHost,
  type NotificationItem,
} from "@/components/NotificationCenter";
import { OperationProgressDialog } from "@/components/OperationProgressDialog";
import { NumberPanel, RangePanel } from "@/components/SearchPanels";
import { ResultsCard } from "@/components/ResultsCard";
import { SunatConfirmDialog } from "@/components/SunatConfirmDialog";
import { SunatProgress } from "@/components/SunatProgress";
import { Tabs } from "@/components/Tabs";
import { voucherColumns } from "@/components/columns";
import { useDocument } from "@/hooks/useDocument";
import { useMovSynerPos } from "@/hooks/useMovSynerPos";
import { useSunat } from "@/hooks/useSunat";
import { useVouchers, type SearchMode } from "@/hooks/useVouchers";

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
  const sunat = useSunat(onAuthFailure);
  const movsynerpos = useMovSynerPos(onAuthFailure);
  const [mode, setMode] = useState<SearchMode>("range");
  const [copied, setCopied] = useState(false);
  const [sunatDialogOpen, setSunatDialogOpen] = useState(false);
  const [movSynerPosDialogOpen, setMovSynerPosDialogOpen] = useState(false);
  const [movSynerPosTarget, setMovSynerPosTarget] = useState<Voucher[] | null>(
    null,
  );
  const [movSynerPosReparar, setMovSynerPosReparar] = useState(false);
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
  const handleFilteredRowsChange = useCallback((rows: Voucher[]) => {
    setFilteredRows(rows);
  }, []);
  const tableRows = flowSelection?.rows ?? vouchers.rows;
  const effectiveRows = filteredRows ?? tableRows;
  const hasTableFilter =
    filteredRows !== null && filteredRows.length !== tableRows.length;
  const isFiltered = flowSelection !== null || hasTableFilter;
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
  const columns = useMemo(
    () => voucherColumns({ intelisisEnabled: vouchers.intelisisEnabled }),
    [vouchers.intelisisEnabled],
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
    if (mode === "range" && lastRange) {
      return vouchers.runRange(lastRange.start, lastRange.end, lastRange.types);
    }
    if (mode === "number" && lastNumber) {
      return vouchers.runNumber(lastNumber);
    }
    return Promise.resolve();
  };

  const sunatDisabled =
    !effectiveRows.length ||
    vouchers.loading ||
    sunat.busy ||
    sunat.refreshing;

  const movSynerPosDisabled =
    !effectiveRows.length ||
    vouchers.loading ||
    movsynerpos.busy ||
    movsynerpos.refreshing;

  const notificationItems = useMemo<NotificationItem[]>(() => {
    const list: NotificationItem[] = [];

    if (vouchers.error) {
      list.push({
        id: "synerpos-query-error",
        signature: `query-error:${vouchers.error}`,
        tone: "error",
        content: (
          <NotificationAlert
            tone="error"
            title="Error de consulta"
            description={vouchers.error}
          />
        ),
      });
    }

    if (sunat.error) {
      list.push({
        id: "synerpos-sunat-error",
        signature: `sunat-error:${sunat.error}`,
        tone: "error",
        content: (
          <NotificationAlert
            tone="error"
            title="No se pudo validar en SUNAT"
            description={sunat.error}
          />
        ),
      });
    }

    if (sunat.warning) {
      list.push({
        id: "synerpos-sunat-warning",
        signature: `sunat-warning:${sunat.warning}`,
        tone: "warning",
        content: (
          <NotificationAlert
            tone="warning"
            title="Validación en SUNAT"
            description={sunat.warning}
          />
        ),
      });
    }

    if (sunat.notice && !sunat.busy && !sunat.refreshing) {
      list.push({
        id: "synerpos-sunat-notice",
        signature: `sunat-notice:${sunat.notice}`,
        tone: "info",
        content: (
          <NotificationAlert
            tone="info"
            title="Validación en SUNAT"
            description={sunat.notice}
          />
        ),
      });
    }

    if (movsynerpos.error) {
      list.push({
        id: "synerpos-mov-error",
        signature: `mov-error:${movsynerpos.error}`,
        tone: "error",
        content: (
          <NotificationAlert
            tone="error"
            title="No se pudo enviar a MovSynerPos"
            description={movsynerpos.error}
          />
        ),
      });
    }

    if (movsynerpos.warning || movsynerpos.failed.length > 0) {
      list.push({
        id: "synerpos-mov-warning",
        signature: `mov-warning:${movsynerpos.warning ?? ""}:${movsynerpos.failed.length}`,
        tone: "warning",
        content: (
          <NotificationAlert
            tone="warning"
            title="Observaciones en MovSynerPos"
            description={
              <span className="flex flex-col gap-1.5">
                {movsynerpos.warning ? <span>{movsynerpos.warning}</span> : null}
                {movsynerpos.failed.length > 0 ? (
                  <button
                    type="button"
                    className="w-fit font-medium underline underline-offset-2"
                    onClick={() =>
                      void movsynerpos.retry(refreshRows, movSynerPosReparar)
                    }
                  >
                    Reintentar solo los {movsynerpos.failed.length} fallidos
                  </button>
                ) : null}
              </span>
            }
          />
        ),
      });
    }

    if (
      movsynerpos.notice &&
      !movsynerpos.busy &&
      !movsynerpos.refreshing
    ) {
      list.push({
        id: "synerpos-mov-notice",
        signature: `mov-notice:${movsynerpos.notice}`,
        tone: "info",
        content: (
          <NotificationAlert
            tone="info"
            title="Envío a MovSynerPos"
            description={movsynerpos.notice}
          />
        ),
      });
    }

    return list;
  }, [
    vouchers.error,
    sunat.error,
    sunat.warning,
    sunat.notice,
    sunat.busy,
    sunat.refreshing,
    movsynerpos,
    movSynerPosReparar,
    refreshRows,
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Tabs mode={mode} onChange={setMode} />

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
        summary={vouchers.error ?? resultsSubtitle}
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
              disabled={sunatDisabled || !effectiveRows.length}
              onClick={() => setSunatDialogOpen(true)}
              title={
                isFiltered
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
              Validar en SUNAT{isFiltered ? ` (${effectiveRows.length})` : ""}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={movSynerPosDisabled}
              onClick={() => {
                setMovSynerPosTarget(null);
                setMovSynerPosDialogOpen(true);
              }}
              title={
                isFiltered
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
              {effectiveRows.length ? ` (${effectiveRows.length})` : ""}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!effectiveRows.length}
              onClick={() => void exportExcel(effectiveRows)}
              title={
                isFiltered
                  ? `Exporta solo las ${effectiveRows.length} filas filtradas`
                  : "Exporta los documentos mostrados"
              }
            >
              <HugeiconsIcon icon={FileDownIcon} size={16} strokeWidth={2} aria-hidden /> Exportar Excel{isFiltered ? ` (${effectiveRows.length})` : ""}
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
        validatingSunat={sunat.busy || sunat.refreshing}
        sendingMovSynerPos={movsynerpos.busy || movsynerpos.refreshing}
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

      <OperationProgressDialog
        open={Boolean(sunat.progress)}
        running={sunat.busy || sunat.refreshing}
        title="Progreso de validación en SUNAT"
        description="Consultando el estado de los comprobantes seleccionados contra SUNAT."
        riskDescription="Si cancelas ahora, se detendrá el envío de lotes pendientes y el seguimiento en pantalla. Los lotes que ya fueron registrados en el servidor seguirán procesándose en segundo plano para evitar inconsistencias o cobros duplicados de cuota."
        onCancel={() => {
          void sunat.cancel();
        }}
        onClose={sunat.dismissProgress}
      >
        <SunatProgress
          progress={sunat.progress}
          notice={null}
          warning={null}
          error={null}
        />
      </OperationProgressDialog>

      <OperationProgressDialog
        open={Boolean(movsynerpos.progress)}
        running={movsynerpos.busy || movsynerpos.refreshing}
        title="Progreso de envío a MovSynerPos"
        description="Reconsultando documentos en SynerCom e insertando líneas en MovSynerPos."
        riskDescription="Si cancelas ahora, los documentos de los lotes que ya fueron insertados en MovSynerPos permanecerán guardados (la operación no se revierte) y los documentos restantes quedarán pendientes de envío."
        onCancel={() => {
          void movsynerpos.cancel();
        }}
        onClose={movsynerpos.dismissProgress}
      >
        <MovSynerPosProgress
          progress={movsynerpos.progress}
          notice={null}
          warning={null}
          error={null}
          failedCount={movsynerpos.failed.length}
          onRetry={() =>
            void movsynerpos.retry(refreshRows, movSynerPosReparar)
          }
        />
      </OperationProgressDialog>

      <NotificationHost sourceId="synerpos" items={notificationItems} />

      <SunatConfirmDialog
        open={sunatDialogOpen}
        onOpenChange={setSunatDialogOpen}
        rows={effectiveRows}
        onConfirm={(scope) => {
          void sunat.runBatch(effectiveRows, refreshRows, scope);
        }}
      />

      <MovSynerPosConfirmDialog
        open={movSynerPosDialogOpen}
        onOpenChange={(open) => {
          setMovSynerPosDialogOpen(open);
          if (!open) setMovSynerPosTarget(null);
        }}
        rows={movSynerPosTarget ?? effectiveRows}
        onConfirm={(reparar) => {
          const rowsToSend = movSynerPosTarget ?? effectiveRows;
          setMovSynerPosReparar(reparar);
          void movsynerpos.run(rowsToSend, refreshRows, reparar);
        }}
      />
    </div>
  );
}

