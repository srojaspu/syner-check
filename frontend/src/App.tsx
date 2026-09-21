import { useMemo, useState } from "react";
import { FileDown, Loader2, Zap } from "lucide-react";
import { exportExcel } from "./api/excel";
import type { Voucher } from "./api/types";
import { Account, AppShell, LoginCard, Tabs, TopBar } from "./components/AppShell";
import { DataTable } from "./components/DataTable";
import { DetailDrawer } from "./components/DetailDrawer";
import { NumberPanel, RangePanel } from "./components/SearchPanels";
import { StatsBar } from "./components/StatsBar";
import { voucherColumns } from "./components/columns";
import { useDocument } from "./hooks/useDocument";
import { useSession } from "./hooks/useSession";
import { useVouchers, type SearchMode } from "./hooks/useVouchers";
import { ThemeProvider } from "./theme/ThemeContext";

function Workspace() {
  const { user, ready, onAuthFailure } = useSession();
  const vouchers = useVouchers(onAuthFailure);
  const detail = useDocument(onAuthFailure);
  const [mode, setMode] = useState<SearchMode>("range");
  const [copied, setCopied] = useState(false);
  const columns = useMemo(() => voucherColumns(), []);

  if (!ready) {
    return (
      <AppShell topbar={<TopBar actions={null} />}>
        <div className="empty">
          <Loader2 size={22} className="spin" aria-hidden />
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

  return (
    <AppShell topbar={<TopBar actions={<Account user={user} />} />}>
      <div className="hero">
        <div>
          <div className="eyebrow">CENTRO DE CONSULTA</div>
          <h1>Encuentra un comprobante en segundos</h1>
          <p>Consulta por rango de fechas o busca directamente por número.</p>
        </div>
        <div className="hero-badge">
          <span className="pulse" aria-hidden />
          <Zap size={14} aria-hidden /> Conexión protegida
        </div>
      </div>

      <Tabs mode={mode} onChange={setMode} />

      <section className="panel">
        {mode === "range" ? (
          <RangePanel
            disabled={vouchers.loading}
            onSearch={(start, end, types) => void vouchers.runRange(start, end, types)}
          />
        ) : (
          <NumberPanel
            disabled={vouchers.loading}
            onSearch={(number) => void vouchers.runNumber(number)}
          />
        )}
      </section>

      {vouchers.searched ? <StatsBar rows={vouchers.rows} /> : null}

      <section className="panel results-panel">
        <div className="section-head">
          <div>
            <h2>Resultados</h2>
            <p>{vouchers.error ?? vouchers.subtitle}</p>
          </div>
          <div className="result-tools">
            <button
              type="button"
              className="btn secondary"
              disabled={!vouchers.rows.length}
              onClick={() => void exportExcel(vouchers.rows)}
            >
              <FileDown size={16} aria-hidden /> Exportar Excel
            </button>
            {vouchers.loading ? (
              <div className="loader">
                <Loader2 size={16} className="spin" aria-hidden /> Consultando…
              </div>
            ) : null}
          </div>
        </div>
        <DataTable.Root
          data={vouchers.rows}
          columns={columns}
          onRowClick={showDetail}
        >
          <DataTable.Toolbar />
          <DataTable.View<Voucher> loading={vouchers.loading} />
          <DataTable.Pagination loading={vouchers.loading} />
        </DataTable.Root>
      </section>

      <DetailDrawer
        open={detail.open}
        document={detail.document}
        loading={detail.loading}
        error={detail.error}
        copied={copied}
        onCopy={() => void copyNumber()}
        onClose={detail.close}
      />
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
