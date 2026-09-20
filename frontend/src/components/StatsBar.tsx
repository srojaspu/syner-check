import { Database, FileCheck2, FileX2, Files, Wallet } from "lucide-react";
import { formatMoney } from "../api/format";
import type { Voucher } from "../api/types";

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="stat">
      <span className="stat-icon" aria-hidden>
        {icon}
      </span>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function StatsBar({ rows }: { rows: Voucher[] }) {
  const total = rows.length;
  const found = rows.filter((row) => row.in_sql).length;
  const amount = rows.reduce(
    (sum, row) => sum + (Number(row.crossTotal) || 0),
    0,
  );
  return (
    <section className="stats" aria-live="polite">
      <Stat icon={<Files size={16} />} label="Documentos" value={total} />
      <Stat
        icon={<FileCheck2 size={16} />}
        label="Encontrados en SQL"
        value={found}
      />
      <Stat
        icon={<FileX2 size={16} />}
        label="No encontrados en SQL"
        value={total - found}
      />
      <Stat
        icon={<Wallet size={16} />}
        label="Total mostrado"
        value={formatMoney(amount, rows[0]?.currency?.isoCode ?? "PEN")}
      />
      <Stat
        icon={<Database size={16} />}
        label="Fuente"
        value={found > 0 ? "SQL + GraphQL" : "GraphQL"}
      />
    </section>
  );
}
