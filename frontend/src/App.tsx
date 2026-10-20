import { useCallback, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FileDownIcon,
  Loading02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { exportExcel } from "./api/excel";
import { formatMoney } from "./api/format";
import type { FlowStageKey, Voucher } from "./api/types";
import { Account, AppShell, LoginCard, Tabs, TopBar } from "./components/AppShell";
import { DataTable } from "./components/DataTable";
import { DetailDrawer } from "./components/DetailDrawer";
import { FlowBar } from "./components/FlowBar";
import { NumberPanel, RangePanel } from "./components/SearchPanels";
import { SunatConfirmDialog } from "./components/SunatConfirmDialog";
import { SunatProgress } from "./components/SunatProgress";
import { voucherColumns } from "./components/columns";
import { useDocument } from "./hooks/useDocument";
import { useSession } from "./hooks/useSession";
import { useSunat } from "./hooks/useSunat";
import { useVouchers, type SearchMode } from "./hooks/useVouchers";
import { ThemeProvider } from "./theme/ThemeContext";

interface FlowSelection {
  stage: FlowStageKey;
  state: string;
  label: string;
  rows: Voucher[];
}

function Workspace() {
  const { user, ready, onAuthFailure } = useSession();
  const vouchers = useVouchers(onAuthFailure);
  const detail = useDocument(onAuthFailure);
  const sunat = useSunat(onAuthFailure);
  const [mode, setMode] = useState<SearchMode>("range");
  const [copied, setCopied] = useState(false);
  const [sunatDialogOpen, setSunatDialogOpen] = useState(false);
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

  if (!ready) {
    return (
      <AppShell topbar={<TopBar actions={null} />}>
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <HugeiconsIcon
            icon={Loading02Icon}
            size={22}
            strokeWidth={2}
            className="animate-spin"
            aria-hidden
          />
          <b>Cargando…</b>
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell topbar={<TopBar actions={null} />}>
        <LoginCard />
      </AppShell>
    );
  }

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

  return (
    <AppShell topbar={<TopBar actions={<Account user={user} />} />}>
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
                setSunatDialogOpen(false);
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
                setSunatDialogOpen(false);
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

        <Card>
          <CardHeader className="gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <CardTitle>Resultados</CardTitle>
                <CardDescription>
                  {vouchers.error ?? resultsSubtitle}
                </CardDescription>
              </div>
              {vouchers.searched ? (
                <p className="text-sm text-muted-foreground">
                  Total mostrado:{" "}
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatMoney(resultsTotal, resultsCurrency)}
                  </span>
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2 sm:justify-self-end">
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
            </div>
          </CardHeader>
          <CardContent>
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
            {sunat.progress || sunat.notice || sunat.warning || sunat.error ? (
              <div className="mb-4">
                <SunatProgress
                  progress={sunat.progress}
                  notice={sunat.notice}
                  warning={sunat.warning}
                  error={sunat.error}
                />
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
          </CardContent>
        </Card>

        <DetailDrawer
          open={detail.open}
          document={detail.document}
          loading={detail.loading}
          error={detail.error}
          copied={copied}
          onCopy={() => void copyNumber()}
          onClose={detail.close}
        />

        <SunatConfirmDialog
          open={sunatDialogOpen}
          onOpenChange={setSunatDialogOpen}
          rows={effectiveRows}
          onConfirm={(scope) => {
            void sunat.runBatch(effectiveRows, refreshRows, scope);
          }}
        />
      </div>
    </AppShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Workspace />
    </ThemeProvider>
  );
}
