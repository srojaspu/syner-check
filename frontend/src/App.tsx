import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FileDownIcon,
  Loading02Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
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

  return (
    <AppShell topbar={<TopBar actions={<Account user={user} />} />}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex max-w-xl flex-col gap-2">
            <Badge variant="outline" className="w-fit">
              CENTRO DE CONSULTA
            </Badge>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Encuentra un comprobante en segundos
            </h1>
            <p className="text-muted-foreground">
              Consulta por rango de fechas o busca directamente por número.
            </p>
          </div>
          <Badge variant="secondary" className="gap-1.5">
            <span className="relative flex size-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <HugeiconsIcon icon={ZapIcon} size={14} strokeWidth={2} aria-hidden /> Conexión protegida
          </Badge>
        </div>

        <Tabs mode={mode} onChange={setMode} />

        <section>
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

        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <CardTitle>Resultados</CardTitle>
              <CardDescription>
                {vouchers.error ?? vouchers.subtitle}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={!vouchers.rows.length}
                onClick={() => void exportExcel(vouchers.rows)}
              >
                <HugeiconsIcon icon={FileDownIcon} size={16} strokeWidth={2} aria-hidden /> Exportar Excel
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
            <DataTable.Root
              data={vouchers.rows}
              columns={columns}
              onRowClick={showDetail}
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
