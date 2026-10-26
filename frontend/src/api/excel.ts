import { formatDateTime, formatMoney, toISODate } from "../api/format";
import { ERP_ESTADO_LABEL } from "../components/IntelisisUfeEstados";
import type { IntelisisUfeRow, UfeEstatusErp, Voucher } from "../api/types";

function canceladoONConcluido(doc: Voucher): string {
  const raw = doc.intelisis;
  const est =
    typeof raw === "object" && raw !== null
      ? String(
          (raw as Record<string, unknown>).EstatusIntelisis ?? "",
        )
          .trim()
          .toUpperCase()
      : "";
  if (est === "CONCLUIDO") return "COMPLETO";
  if (est === "CANCELADO") return "CANCELADO";
  return "PENDIENTE";
}

/** Excel export of the current rows (client-side, no backend change). */
export async function exportExcel(rows: Voucher[]): Promise<void> {
  // Lazy-load the write-only mini build: same utils/writeFile API as the full
  // bundle (~273 kB vs ~985 kB source), and it stays out of the initial chunk.
  const XLSX = await import("xlsx/dist/xlsx.mini.min.js");
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
        "Estatus Intelisis":
          typeof doc.intelisis === "object" && doc.intelisis !== null
            ? String(
                (doc.intelisis as Record<string, unknown>).EstatusIntelisis ?? "",
              )
            : "",
        SUNAT: doc.sunat?.estado ?? "",
        "Fecha SUNAT": doc.sunat?.fecha_consulta ?? "",
        Flujo:
          doc.in_intelisis === undefined
            ? doc.in_sql
              ? "EN_MOV"
              : "FALTA_MOV"
            : doc.in_sql && doc.in_intelisis
              ? canceladoONConcluido(doc)
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
    { wch: 14 },
    { wch: 12 },
    { wch: 19 },
    { wch: 22 },
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Comprobantes");
  XLSX.writeFile(book, `syner-check-${toISODate(new Date())}.xlsx`);
}

export function formatMoneyCell(value: unknown, currency?: string): string {
  return formatMoney(value, currency ?? "PEN");
}

/**
 * Excel export de la grilla Intelisis UFE (mismas columnas que la pantalla).
 *
 * Si el listado vino recortado (tope de filas del servidor), el archivo lo
 * dice: un Excel parcial sin aviso es peor que no exportarlo.
 */
export async function exportIntelisisUfeExcel(
  rows: IntelisisUfeRow[],
  opciones: { truncado?: boolean; filtradosTotal?: number } = {},
): Promise<void> {
  const XLSX = await import("xlsx/dist/xlsx.mini.min.js");
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((row) => ({
      Comprobante: row.comprobante || row.documento,
      "Documento en bitácora": row.documento,
      "Estimado": row.documento_estimado ? "SI" : "NO",
      Tipo: row.tipo,
      "Fecha emision": row.fecha_emision,
      Sucursal: row.sucursal,
      Tienda: row.sucursal_nombre,
      Cliente: row.cliente,
      "Estatus ERP": row.estatus_erp,
      "Estatus ERP (texto)":
        ERP_ESTADO_LABEL[row.estatus_erp as UfeEstatusErp] ?? row.estatus_erp,
      Total: row.importe_sunat ?? row.total,
      Generador: row.generador,
      "Estado generacion": row.estado_generacion,
      Intentos: row.intentos,
      "Ultimo intento": row.ultimo_intento,
      SUNAT: row.estado_sunat,
      "Fecha SUNAT": row.sunat?.consultado ?? "",
      Revision: row.resultado,
      Incidencias: (row.incidencias ?? []).join(", "),
      Detalle: row.detalle_incidencia ?? "",
      "Documento que acredita": row.referencia,
      "ID ERP": row.id_venta,
      "¿Es documento?": row.comprobante || row.documento ? "Sí" : "No",
    })),
  );
  if (opciones.truncado) {
    // La ultima fila deja constancia de que el archivo esta incompleto.
    const total = opciones.filtradosTotal ?? rows.length;
    XLSX.utils.sheet_add_aoa(sheet, [
      [
        `LISTADO RECORTADO: ${rows.length} de ${total} documentos que pasan el filtro`,
      ],
    ]);
  }
  sheet["!cols"] = [
    { wch: 20 },
    { wch: 20 },
    { wch: 10 },
    { wch: 16 },
    { wch: 14 },
    { wch: 10 },
    { wch: 28 },
    { wch: 32 },
    { wch: 14 },
    { wch: 18 },
    { wch: 14 },
    { wch: 16 },
    { wch: 20 },
    { wch: 10 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
    { wch: 12 },
    { wch: 34 },
    { wch: 40 },
    { wch: 24 },
    { wch: 12 },
    { wch: 14 },
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Intelisis UFE");
  XLSX.writeFile(book, `syner-check-ufe-${toISODate(new Date())}.xlsx`);
}
