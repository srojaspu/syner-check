import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DatabaseIcon,
  FileCheckIcon,
  FileXIcon,
  FilesIcon,
  WalletIcon,
} from "@hugeicons/core-free-icons";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "../api/format";
import type { Voucher } from "../api/types";

function Stat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        aria-hidden
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <b className="truncate text-base leading-tight">{value}</b>
      </span>
    </div>
  );
}

export function StatsBar({
  rows,
  intelisisEnabled,
}: {
  rows: Voucher[];
  intelisisEnabled?: boolean;
}) {
  const total = rows.length;
  const found = rows.filter((row) => row.in_sql).length;
  const inIntelisis = rows.filter((row) => row.in_intelisis).length;
  const amount = rows.reduce(
    (sum, row) => sum + (Number(row.crossTotal) || 0),
    0,
  );
  return (
    <Card aria-live="polite">
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          icon={<HugeiconsIcon icon={FilesIcon} size={16} strokeWidth={2} />}
          label="Documentos"
          value={total}
        />
        <Stat
          icon={<HugeiconsIcon icon={FileCheckIcon} size={16} strokeWidth={2} />}
          label="En MovSynerPos"
          value={found}
        />
        <Stat
          icon={<HugeiconsIcon icon={DatabaseIcon} size={16} strokeWidth={2} />}
          label="En Intelisis"
          value={intelisisEnabled ? inIntelisis : "—"}
        />
        <Stat
          icon={<HugeiconsIcon icon={FileXIcon} size={16} strokeWidth={2} />}
          label="Faltan en Intelisis"
          value={intelisisEnabled ? total - inIntelisis : "—"}
        />
        <Stat
          icon={<HugeiconsIcon icon={WalletIcon} size={16} strokeWidth={2} />}
          label="Total mostrado"
          value={formatMoney(amount, rows[0]?.currency?.isoCode ?? "PEN")}
        />
      </CardContent>
    </Card>
  );
}
