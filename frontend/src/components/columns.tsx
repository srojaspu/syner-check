import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatMoney } from "../api/format";
import type { TipoDocumento, Voucher } from "../api/types";
import type { ColumnFilterConfig } from "./DataTable";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    filter?: ColumnFilterConfig;
  }
}

const TIPO_LABEL: Record<TipoDocumento, string> = {
  FACTURA: "Factura",
  BOLETA: "Boleta",
  "NOTA DE CREDITO": "Nota de crédito",
};

export function voucherColumns(
  opts: { intelisisEnabled?: boolean } = {},
): ColumnDef<Voucher>[] {
  const intelisisEnabled = opts.intelisisEnabled ?? true;
  return [
    {
      id: "documento",
      header: "Documento",
      accessorFn: (doc) => `${doc.number ?? ""} ${doc.seller ?? ""}`,
      meta: { filter: { variant: "text", placeholder: "Nº o vendedor…" } },
      cell: ({ row }) => {
        const doc = row.original;
        return (
          <span className="flex flex-col">
            <span className="docnum font-medium">{doc.number || "—"}</span>
            {doc.seller ? (
              <small className="text-muted-foreground">{doc.seller}</small>
            ) : null}
          </span>
        );
      },
    },
    {
      accessorKey: "oid",
      header: "OID",
      meta: { filter: { variant: "text", placeholder: "OID…" } },
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
      meta: { filter: { variant: "text", placeholder: "AAAA-MM-DD…" } },
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
      meta: { filter: { variant: "text", placeholder: "Cliente…" } },
      cell: ({ row }) => (
        <span>
          {row.original.contactName || row.original.contact?.name || "—"}
        </span>
      ),
    },
    {
      accessorKey: "crossTotal",
      header: "Total",
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
        // en Intelisis implica en Mov: 3 estados bastan (sin "Solo Intelisis").
        if (doc.in_intelisis === undefined || !intelisisEnabled) {
          return doc.in_sql ? "EN_MOV" : "FALTA_MOV";
        }
        if (doc.in_sql && doc.in_intelisis) return "COMPLETO";
        if (doc.in_sql) return "FALTA_INTELISIS";
        return "FALTA_MOV";
      },
      filterFn: "equalsString",
      meta: {
        filter: {
          variant: "select",
          options: [
            { value: "COMPLETO", label: "Completo" },
            { value: "FALTA_INTELISIS", label: "Falta en Intelisis" },
            { value: "FALTA_MOV", label: "Falta en Mov" },
            { value: "EN_MOV", label: "En Mov (sin Intelisis)" },
          ],
        },
      },
      cell: ({ row }) => {
        const doc = row.original;
        if (doc.in_intelisis === undefined || !intelisisEnabled) {
          return (
            <Badge variant="secondary">
              {doc.in_sql ? "En Mov" : "Falta en Mov"}
            </Badge>
          );
        }
        if (doc.in_sql && doc.in_intelisis) {
          return <Badge variant="default">Completo</Badge>;
        }
        if (doc.in_sql) {
          return <Badge variant="outline">Falta en Intelisis</Badge>;
        }
        return <Badge variant="outline">Falta en Mov</Badge>;
      },
    },
  ];
}
