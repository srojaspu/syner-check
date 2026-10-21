import type { ColumnDef, FilterFn } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatMoney } from "../api/format";
import type {
  IntelisisUfeRow,
  UfeEstadoGeneracion,
  UfeEstadoSunat,
  UfeGenerador,
} from "../api/types";

const TIPO_LABEL: Record<string, string> = {
  FA: "Factura",
  BO: "Boleta",
  NC: "Nota de crédito",
  ND: "Nota de débito",
};

const ESTADO_GENERACION_LABEL: Record<UfeEstadoGeneracion, string> = {
  generado: "Generado",
  error_validacion: "Error de validación",
  omitido_validacion: "Omitido en validación",
  sin_bloque: "Sin bloque de tipo",
  en_proceso: "En proceso",
  sin_registro: "Sin registro",
  fuera_de_bitacora: "Fuera de bitácora",
};

const ESTADO_SUNAT_LABEL: Record<UfeEstadoSunat, string> = {
  ACEPTADO: "Aceptado",
  "SUNAT NO ENCONTRADO": "No encontrado",
  "SUNAT NO ACEPTADO": "No aceptado",
  "SUNAT SIN CONSULTA": "Sin consulta",
};

type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

/** Filtra por incidencia aunque el documento tenga mas de una. */
const incluyeIncidencia: FilterFn<IntelisisUfeRow> = (
  row,
  _columnId,
  filterValue,
) => {
  const needle = String(filterValue ?? "").trim().toUpperCase();
  if (!needle) return true;
  return (row.original.incidencias ?? []).some(
    (item) => item.trim().toUpperCase() === needle,
  );
};

function generadorVariant(generador: UfeGenerador): BadgeVariant {
  if (generador === "OK REGISTRADO") return "default";
  if (generador === "SIN OK") return "destructive";
  return "outline";
}

function sunatVariant(estado: UfeEstadoSunat): BadgeVariant {
  if (estado === "ACEPTADO") return "default";
  if (estado === "SUNAT NO ACEPTADO" || estado === "SUNAT NO ENCONTRADO") {
    return "destructive";
  }
  return "outline";
}

export function intelisisUfeColumns(
  rows: IntelisisUfeRow[],
): ColumnDef<IntelisisUfeRow>[] {
  const sucursales = Array.from(
    new Map(
      rows.map((row) => [
        row.sucursal,
        `${row.sucursal} · ${row.sucursal_nombre || "Sin nombre"}`,
      ]),
    ).entries(),
  ).sort((a, b) => a[0] - b[0]);
  const incidencias = Array.from(
    new Set(rows.flatMap((row) => row.incidencias ?? [])),
  ).sort();
  const estados = Array.from(
    new Set(rows.map((row) => row.estado_generacion)),
  ).sort();

  return [
    {
      id: "documento",
      header: "Comprobante",
      accessorFn: (doc) => doc.comprobante || doc.documento,
      meta: {
        filter: { variant: "text", placeholder: "Documento…" },
        priority: "always",
      },
      cell: ({ row }) => {
        const doc = row.original;
        return (
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5">
              <span className="docnum font-medium">
                {doc.comprobante || doc.documento}
              </span>
              {doc.documento_estimado ? (
                <Badge variant="outline" title="Numero estimado: no hay registro en la bitácora">
                  estimado
                </Badge>
              ) : null}
            </span>
            <small className="text-muted-foreground">
              {doc.mov} {doc.mov_id}
            </small>
          </span>
        );
      },
    },
    {
      id: "tipo",
      header: "Tipo",
      accessorFn: (doc) => doc.tipo,
      filterFn: "equalsString",
      meta: {
        filter: {
          variant: "select",
          options: Object.entries(TIPO_LABEL).map(([value, label]) => ({
            value,
            label,
          })),
        },
        priority: "sm",
      },
      cell: ({ row }) => (
        <Badge variant="secondary">
          {TIPO_LABEL[row.original.tipo] ?? row.original.tipo}
        </Badge>
      ),
    },
    {
      id: "fecha",
      header: "Fecha",
      accessorFn: (doc) => doc.fecha_emision,
      meta: {
        filter: { variant: "text", placeholder: "AAAA-MM-DD…" },
        priority: "md",
      },
      cell: ({ row }) => (
        <span className="tabular-nums">{formatDate(row.original.fecha_emision)}</span>
      ),
    },
    {
      id: "sucursal",
      header: "Sucursal",
      accessorFn: (doc) => String(doc.sucursal),
      filterFn: "equalsString",
      meta: {
        filter: {
          variant: "select",
          options: sucursales.map(([value, label]) => ({ value: String(value), label })),
        },
        priority: "lg",
        width: "grow",
      },
      cell: ({ row }) => {
        const doc = row.original;
        return (
          <span
            className="block w-full truncate [contain:inline-size]"
            title={`${doc.sucursal} · ${doc.sucursal_nombre}`}
          >
            <span className="font-medium">{doc.sucursal}</span>{" "}
            <span className="text-muted-foreground">
              {doc.sucursal_nombre || "Sin nombre"}
            </span>
          </span>
        );
      },
    },
    {
      id: "estatus",
      header: "ERP",
      accessorFn: (doc) => doc.estatus_erp,
      filterFn: "equalsString",
      meta: {
        filter: {
          variant: "select",
          options: [
            { value: "CONCLUIDO", label: "Concluido" },
            { value: "PENDIENTE", label: "Pendiente" },
          ],
        },
        priority: "2xl",
      },
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.estatus_erp || "—"}</Badge>
      ),
    },
    {
      id: "total",
      header: "Total ERP",
      accessorFn: (doc) => doc.total,
      meta: { priority: "lg" },
      cell: ({ row }) => (
        <span className="amount text-right font-medium tabular-nums">
          {formatMoney(row.original.total, "PEN")}
        </span>
      ),
    },
    {
      id: "generador",
      header: "Generador",
      accessorFn: (doc) => doc.generador,
      filterFn: "equalsString",
      meta: {
        filter: {
          variant: "select",
          options: [
            { value: "OK REGISTRADO", label: "OK registrado" },
            { value: "SIN OK", label: "Sin OK" },
            { value: "SIN TRAZA", label: "Sin traza" },
            { value: "NO APLICA", label: "No aplica" },
          ],
        },
        priority: "always",
      },
      cell: ({ row }) => {
        const doc = row.original;
        const title =
          doc.en_espera
            ? "Emitido hoy: dentro de la ventana de gracia, aún no es un fallo"
            : ESTADO_GENERACION_LABEL[doc.estado_generacion];
        return (
          <Badge variant={generadorVariant(doc.generador)} title={title}>
            {doc.generador}
          </Badge>
        );
      },
    },
    {
      id: "intentos",
      header: "Intentos",
      accessorFn: (doc) => doc.intentos,
      meta: { priority: "xl" },
      cell: ({ row }) => {
        const doc = row.original;
        return (
          <span
            className="tabular-nums"
            title={`${doc.ok_registrados} con OK · último ${doc.ultimo_intento || "—"}`}
          >
            {doc.intentos}
          </span>
        );
      },
    },
    {
      id: "sunat",
      header: "SUNAT",
      accessorFn: (doc) => doc.estado_sunat,
      filterFn: "equalsString",
      meta: {
        filter: {
          variant: "select",
          options: [
            { value: "ACEPTADO", label: "Aceptado" },
            { value: "SUNAT NO ENCONTRADO", label: "No encontrado" },
            { value: "SUNAT NO ACEPTADO", label: "No aceptado" },
            { value: "SUNAT SIN CONSULTA", label: "Sin consulta" },
          ],
        },
        priority: "always",
      },
      cell: ({ row }) => {
        const doc = row.original;
        return (
          <Badge
            variant={sunatVariant(doc.estado_sunat)}
            title={
              doc.sunat?.consultado
                ? `Consultado el ${doc.sunat.consultado}`
                : "Todavía no se consultó SUNAT"
            }
          >
            {ESTADO_SUNAT_LABEL[doc.estado_sunat] ?? doc.estado_sunat}
          </Badge>
        );
      },
    },
    {
      id: "resultado",
      header: "Revisión",
      accessorFn: (doc) => doc.resultado,
      filterFn: "equalsString",
      meta: {
        filter: {
          variant: "select",
          options: [
            { value: "CONFORME", label: "Conforme" },
            { value: "REVISAR", label: "Revisar" },
          ],
        },
        priority: "always",
      },
      cell: ({ row }) => (
        <Badge
          variant={row.original.resultado === "REVISAR" ? "destructive" : "secondary"}
        >
          {row.original.resultado}
        </Badge>
      ),
    },
    {
      id: "incidencias",
      header: "Incidencias",
      accessorFn: (doc) => (doc.incidencias ?? []).join(", "),
      filterFn: incluyeIncidencia,
      meta: {
        filter: {
          variant: "select",
          options: incidencias.map((value) => ({ value, label: value })),
        },
        priority: "2xl",
      },
      cell: ({ row }) => {
        const doc = row.original;
        if (!doc.incidencias?.length) {
          return (
            <span className="text-muted-foreground">
              {doc.exento_generador ? "No aplica el generador" : "—"}
            </span>
          );
        }
        return (
          <span
            className="flex flex-col gap-0.5"
            title={doc.detalle_incidencia ?? undefined}
          >
            {doc.incidencias.map((item) => (
              <span key={item} className="text-xs font-medium">
                {item}
              </span>
            ))}
          </span>
        );
      },
    },
    {
      id: "estado_generacion",
      header: "Estado",
      accessorFn: (doc) => doc.estado_generacion,
      filterFn: "equalsString",
      meta: {
        filter: {
          variant: "select",
          options: estados.map((value) => ({
            value,
            label: ESTADO_GENERACION_LABEL[value] ?? value,
          })),
        },
        priority: "2xl",
      },
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {ESTADO_GENERACION_LABEL[row.original.estado_generacion] ??
            row.original.estado_generacion}
        </span>
      ),
    },
  ];
}
