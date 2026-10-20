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
import type { Voucher } from "./api/types";
import { Account, AppShell, LoginCard, Tabs, TopBar } from "./components/AppShell";
import { DataTable } from "./components/DataTable";
import { DetailDrawer } from "./components/DetailDrawer";
import { FlowBar } from "./components/FlowBar";
import { NumberPanel, RangePanel } from "./components/SearchPanels";
import { StatsBar } from "./components/StatsBar";
import { SunatProgress } from "./components/SunatProgress";
import { voucherColumns } from "./components/columns";
import { useDocument } from "./hooks/useDocument";
import { useSession } from "./hooks/useSession";
import { useSunat } from "./hooks/useSunat";
import { useVouchers, type SearchMode } from "./hooks/useVouchers";
import { ThemeProvider } from "./theme/ThemeContext";

function Workspace() {
  const { user, ready, onAuthFailure } = useSession();
  const vouchers = useVouchers(onAuthFailure);
  const detail = useDocument(onAuthFailure);
  const sunat = useSunat(onAuthFailure);
  const [mode, setMode] = useState<SearchMode>("range");
  const [copied, setCopied] = useState(false);
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
  const effectiveRows = filteredRows ?? vouchers.rows;
  const isFiltered =
    filteredRows !== null && filteredRows.length !== vouchers.rows.length;
  const columns = useMemo(
    () => voucherColumns({ intelisisEnabled: vouchers.intelisisEnabled }),
    [vouchers.intelisisEnabled],
  );

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
    // batch and would clear the final progress the user just saw.
    if (mode === "range" && lastRange) {
      void vouchers.runRange(lastRange.start, lastRange.end, lastRange.types);
    } else if (mode === "number" && lastNumber) {
      void vouchers.runNumber(lastNumber);
    }
  };

  const sunatDisabled = !vouchers.rows.length || vouchers.loading || sunat.busy;

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
                setFilteredRows(null);
                void vouchers.runNumber(number);
              }}
            />
          )}
        </section>

        {vouchers.searched && vouchers.flow ? (
          <FlowBar
            totals={vouchers.flow.totals}
            intelisisEnabled={vouchers.intelisisEnabled}
            intelisisCount={vouchers.intelisisCount}
            intelisisWarning={vouchers.intelisisWarning}
          />
        ) : null}

        {vouchers.searched ? (
          <StatsBar
            rows={vouchers.rows}
            intelisisEnabled={vouchers.intelisisEnabled}
          />
        ) : null}

        <Card>
          <CardHeader className="gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="flex flex-col gap-1">
              <CardTitle>Resultados</CardTitle>
              <CardDescription>
                {vouchers.error ?? vouchers.subtitle}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 sm:justify-self-end">
              <Button
                type="button"
                variant="outline"
                disabled={sunatDisabled || !effectiveRows.length}
                onClick={() => void sunat.runBatch(effectiveRows, refreshRows)}
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
                  Consultando…
                </span>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
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
              data={vouchers.rows}
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
