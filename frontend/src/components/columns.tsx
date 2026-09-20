import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, XCircle } from "lucide-react";
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

export function voucherColumns(): ColumnDef<Voucher>[] {
  return [
    {
      id: "documento",
      header: "Documento",
      accessorFn: (doc) => `${doc.number ?? ""} ${doc.seller ?? ""}`,
      meta: { filter: { variant: "text", placeholder: "Nº o vendedor…" } },
      cell: ({ row }) => {
        const doc = row.original;
        return (
          <span className="doc-cell">
            <span className="docnum">{doc.number || "—"}</span>
            {doc.seller ? <small>{doc.seller}</small> : null}
          </span>
        );
      },
    },
    {
      accessorKey: "oid",
      header: "OID",
      meta: { filter: { variant: "text", placeholder: "OID…" } },
      cell: ({ row }) => (
        <code className="oid">{row.original.oid || "—"}</code>
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
        <span className="type">{TIPO_LABEL[row.original.tipo]}</span>
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
          <span className="datetime" title={iso}>
            {text}
            {hasTime ? null : <small className="no-time">s/h</small>}
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
        <span>{row.original.contactName || row.original.contact?.name || "—"}</span>
      ),
    },
    {
      accessorKey: "crossTotal",
      header: "Total",
      cell: ({ row }) => (
        <span className="amount">
          {formatMoney(
            row.original.crossTotal,
            row.original.currency?.isoCode,
          )}
        </span>
      ),
    },
    {
      id: "enSql",
      header: "SQL",
      accessorFn: (doc) => (doc.in_sql ? "SI" : "NO"),
      filterFn: "equalsString",
      meta: {
        filter: {
          variant: "select",
          options: [
            { value: "SI", label: "Encontrado" },
            { value: "NO", label: "No encontrado" },
          ],
        },
      },
      cell: ({ row }) =>
        row.original.in_sql ? (
          <span className="status ok">
            <CheckCircle2 size={14} aria-hidden /> Encontrado
          </span>
        ) : (
          <span className="status missing">
            <XCircle size={14} aria-hidden /> No encontrado
          </span>
        ),
    },
  ];
}
