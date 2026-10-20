import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatMoney } from "../api/format";
import type { TipoDocumento, Voucher } from "../api/types";
import type {
  ColumnFilterConfig,
  ColumnWidth,
  ResponsivePriority,
} from "./DataTable";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    filter?: ColumnFilterConfig;
    priority?: ResponsivePriority;
    width?: ColumnWidth;
  }
}

const TIPO_LABEL: Record<TipoDocumento, string> = {
  FACTURA: "Factura",
  BOLETA: "Boleta",
  "NOTA DE CREDITO": "Nota de crédito",
};

type FlowBadgeVariant = "default" | "secondary" | "outline";

/** Short label on phones; the full status remains available from sm upward. */
function FlowBadge({
  variant,
  short,
  full,
}: {
  variant: FlowBadgeVariant;
  short: string;
  full: string;
}) {
  return (
    <Badge variant={variant} title={full} aria-label={full}>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{full}</span>
    </Badge>
  );
}

export function voucherColumns(
  opts: { intelisisEnabled?: boolean } = {},
): ColumnDef<Voucher>[] {
  const intelisisEnabled = opts.intelisisEnabled ?? true;
  return [
    {
      id: "documento",
      header: "Documento",
      accessorFn: (doc) => `${doc.number ?? ""} ${doc.seller ?? ""}`,
      meta: {
        filter: { variant: "text", placeholder: "Nº o vendedor…" },
        priority: "always",
      },
      cell: ({ row }) => {
        const doc = row.original;
        return (
          <span className="flex flex-col">
            <span className="docnum font-medium">{doc.number || "—"}</span>
            {doc.seller ? (
              <small className="hidden text-muted-foreground sm:block">
                {doc.seller}
              </small>
            ) : null}
          </span>
        );
      },
    },
    {
      accessorKey: "oid",
      header: "OID",
      meta: {
        filter: { variant: "text", placeholder: "OID…" },
        priority: "2xl",
      },
      cell: ({ row }) => (
        <code className="oid font-mono text-xs">
          {row.original.oid || "—"}
        </code>
      ),
    },
    {
      accessorKey: "tipo",
      header: "Tipo",
      filterFn: "equalsString",
      meta: {
        filter: {
          variant: "select",
          options: [
            { value: "FACTURA", label: "Factura" },
            { value: "BOLETA", label: "Boleta" },
            { value: "NOTA DE CREDITO", label: "Nota de crédito" },
          ],
        },
        priority: "lg",
      },
      cell: ({ row }) => (
        <Badge variant="secondary">{TIPO_LABEL[row.original.tipo]}</Badge>
      ),
    },
    {
      id: "fechaHora",
      header: "Fecha / hora",
      accessorFn: (doc) =>
        doc.createdDate || String(doc.date ?? "").slice(0, 10),
      meta: {
        filter: { variant: "text", placeholder: "AAAA-MM-DD…" },
        priority: "md",
      },
      sortingFn: (a, b) =>
        String(a.original.createdDate ?? a.original.date ?? "").localeCompare(
          String(b.original.createdDate ?? b.original.date ?? ""),
        ),
      cell: ({ row }) => {
        const doc = row.original;
        const { text, iso } = formatDateTime(doc.createdDate, doc.date);
        const hasTime = Boolean((doc.createdDate ?? "").trim());
        return (
          <span className="datetime tabular-nums" title={iso}>
            {text}
            {hasTime ? null : (
              <small className="no-time ml-1 text-muted-foreground">s/h</small>
            )}
          </span>
        );
      },
    },
    {
      id: "cliente",
      header: "Cliente",
      accessorFn: (doc) => doc.contactName ?? doc.contact?.name ?? "",
      meta: {
        filter: { variant: "text", placeholder: "Cliente…" },
        priority: "xl",
        width: "grow",
      },
      cell: ({ row }) => {
        const name = row.original.contactName || row.original.contact?.name;
        return (
          <span
            className="block w-full truncate [contain:inline-size]"
            title={name ?? undefined}
          >
            {name || "—"}
          </span>
        );
      },
    },
    {
      accessorKey: "crossTotal",
      header: "Total",
      meta: { priority: "lg" },
      cell: ({ row }) => (
        <span className="amount text-right font-medium tabular-nums">
          {formatMoney(
            row.original.crossTotal,
            row.original.currency?.isoCode,
          )}
        </span>
      ),
    },
    {
      id: "flujo",
      header: "Flujo",
      accessorFn: (doc) => {
        // Intelisis se alimenta solo desde Mov vía job, por lo que un doc
        // en Intelisis implica en Mov: sin estado "Solo Intelisis".
        // Con EstatusIntelisis se distingue concluido / pendiente de
        // conclusión / cancelado / ausente real.
        if (doc.in_intelisis === undefined || !intelisisEnabled) {
          return doc.in_sql ? "EN_MOV" : "FALTA_MOV";
        }
        if (doc.in_sql && doc.in_intelisis) {
          const est = intelisisEstatus(doc);
          if (est === "CONCLUIDO") return "COMPLETO";
          if (est === "CANCELADO") return "CANCELADO";
          return "PENDIENTE";
        }
        if (doc.in_sql) return "FALTA_INTELISIS";
        return "FALTA_MOV";
      },
      filterFn: "equalsString",
      meta: {
        filter: {
          variant: "select",
          options: [
            { value: "COMPLETO", label: "Completo" },
            { value: "PENDIENTE", label: "Pendiente en Intelisis" },
            { value: "CANCELADO", label: "Cancelado en Intelisis" },
            { value: "FALTA_INTELISIS", label: "Falta en Intelisis" },
            { value: "FALTA_MOV", label: "Falta en Mov" },
            { value: "EN_MOV", label: "En Mov (sin Intelisis)" },
          ],
        },
        priority: "always",
      },
      cell: ({ row }) => {
        const doc = row.original;
        if (doc.in_intelisis === undefined || !intelisisEnabled) {
          return doc.in_sql ? (
            <FlowBadge variant="secondary" short="En Mov" full="En Mov" />
          ) : (
            <FlowBadge
              variant="secondary"
              short="Falta Mov"
              full="Falta en Mov"
            />
          );
        }
        if (doc.in_sql && doc.in_intelisis) {
          const est = intelisisEstatus(doc);
          if (est === "CONCLUIDO") {
            return (
              <FlowBadge
                variant="default"
                short="Completo"
                full="Completo"
              />
            );
          }
          if (est === "CANCELADO") {
            return (
              <FlowBadge
                variant="outline"
                short="Cancelado"
                full="Cancelado en Intelisis"
              />
            );
          }
          return (
            <FlowBadge
              variant="secondary"
              short="Pendiente"
              full="Pendiente en Intelisis"
            />
          );
        }
        if (doc.in_sql) {
          return (
            <FlowBadge
              variant="outline"
              short="Falta Intelisis"
              full="Falta en Intelisis"
            />
          );
        }
        return (
          <FlowBadge
            variant="outline"
            short="Falta Mov"
            full="Falta en Mov"
          />
        );
      },
    },
    {
      id: "sunat",
      header: "SUNAT",
      accessorFn: (doc) => doc.sunat?.estado?.trim().toUpperCase() || "—",
      filterFn: "equalsString",
      meta: {
        filter: {
          variant: "select",
          options: [
            { value: "ACEPTADO", label: "Aceptado" },
            { value: "PENDIENTE", label: "Pendiente" },
            { value: "NO_EXISTE", label: "No existe" },
            { value: "ANULADO", label: "Anulado" },
            { value: "DESCONOCIDO", label: "Desconocido" },
            { value: "SIN_CONFIRMAR", label: "Sin confirmar" },
            { value: "ERROR", label: "Error" },
            { value: "—", label: "Sin consultar" },
          ],
        },
        priority: "always",
      },
      cell: ({ row }) => {
        const estado = (
          row.original.sunat?.estado ?? ""
        ).trim().toUpperCase();
        if (!estado) {
          return <Badge variant="outline">—</Badge>;
        }
        if (estado === "ACEPTADO") {
          return <Badge variant="default">Aceptado</Badge>;
        }
        if (estado === "PENDIENTE") {
          return <Badge variant="secondary">Pendiente</Badge>;
        }
        if (estado === "SIN_CONFIRMAR") {
          return <Badge variant="destructive">Sin confirmar</Badge>;
        }
        return <Badge variant="outline">{estado}</Badge>;
      },
    },
  ];
}

function intelisisEstatus(doc: Voucher): string {
  const raw = doc.intelisis;
  if (typeof raw !== "object" || raw === null) return "";
  return String(
    (raw as Record<string, unknown>).EstatusIntelisis ?? "",
  )
    .trim()
    .toUpperCase();
}
