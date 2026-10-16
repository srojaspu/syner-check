import { formatDateTime, formatMoney, toISODate } from "../api/format";
import type { Voucher } from "../api/types";

/** Excel export of the current rows (client-side, no backend change). */
export async function exportExcel(rows: Voucher[]): Promise<void> {
  // Lazy-load xlsx so it lands in its own chunk instead of the initial bundle.
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((doc) => {
      const emitted = formatDateTime(doc.createdDate, doc.date);
      return {
        Tipo: doc.tipo,
        Numero: doc.number ?? "",
        "Fecha emision": emitted.text,
        "Fecha emision ISO": emitted.iso,
        Cliente: doc.contactName ?? doc.contact?.name ?? "",
        Total: doc.crossTotal ?? "",
        Moneda: doc.currency?.isoCode ?? "",
        Vendedor: doc.seller ?? "",
        "En Mov": doc.in_sql ? "SI" : "NO",
        "En Intelisis":
          doc.in_intelisis === undefined ? "" : doc.in_intelisis ? "SI" : "NO",
        Flujo:
          doc.in_intelisis === undefined
            ? doc.in_sql
              ? "EN_MOV"
              : "FALTA_MOV"
            : doc.in_sql && doc.in_intelisis
              ? "COMPLETO"
              : doc.in_sql
                ? "FALTA_INTELISIS"
                : "FALTA_MOV",
        OID: doc.oid,
      };
    }),
  );
  sheet["!cols"] = [
    { wch: 16 },
    { wch: 20 },
    { wch: 20 },
    { wch: 22 },
    { wch: 30 },
    { wch: 14 },
    { wch: 8 },
    { wch: 16 },
    { wch: 8 },
    { wch: 12 },
    { wch: 14 },
    { wch: 22 },
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Comprobantes");
  XLSX.writeFile(book, `syner-check-${toISODate(new Date())}.xlsx`);
}

export function formatMoneyCell(value: unknown, currency?: string): string {
  return formatMoney(value, currency ?? "PEN");
}
