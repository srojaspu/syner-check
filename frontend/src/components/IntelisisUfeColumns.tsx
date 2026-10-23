import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate, formatMoney } from "../api/format";
import {
  ESTADO_GENERACION_LABEL,
  ESTADO_SUNAT_LABEL,
} from "./IntelisisUfeEstados";
import type {
  IntelisisUfeRow,
  UfeEstadoSunat,
  UfeGenerador,
} from "../api/types";

const TIPO_LABEL: Record<string, string> = {
  FA: "Factura",
  BO: "Boleta",
  NC: "Nota de crédito",
  ND: "Nota de débito",
};

type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

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

/**
 * Seleccion de filas para el reenvio.
 *
 * Vive en la pagina (no en la tabla) para conservarse al cambiar de pagina y
 * se limpia al lanzar una consulta nueva: un id de otra busqueda no debe
 * viajar en la solicitud.
 */
export interface IntelisisUfeSelection {
  seleccionados: ReadonlySet<number>;
  onToggle: (idVenta: number, seleccionado: boolean) => void;
  onTogglePagina: (filas: IntelisisUfeRow[], seleccionado: boolean) => void;
}

/**
 * Columnas de la grilla UFE.
 *
 * Sin filtros por columna: los filtros viven en un panel que va al servidor
 * (con 31 dias el universo son ~18.000 documentos y filtrarlos en el
 * navegador no era viable).
 */
export function intelisisUfeColumns(
  selection?: IntelisisUfeSelection,
): ColumnDef<IntelisisUfeRow>[] {
  const columnas: ColumnDef<IntelisisUfeRow>[] = [
    {
      id: "documento",
      header: "Comprobante",
      accessorFn: (doc) => doc.comprobante || doc.documento,
      meta: { priority: "always" },
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
              {/* Unica incidencia que no se deduce de Generador ni de SUNAT. */}
              {doc.incidencias?.includes("CRUCE AMBIGUO") ? (
                <Badge
                  variant="destructive"
                  title="Otra venta del periodo tiene el mismo documento"
                >
                  cruce ambiguo
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
      meta: { priority: "sm" },
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
      meta: { priority: "md" },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatDate(row.original.fecha_emision)}
        </span>
      ),
    },
    {
      id: "sucursal",
      header: "Sucursal",
      accessorFn: (doc) => String(doc.sucursal),
      meta: { priority: "lg", width: "grow" },
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
      meta: { priority: "lg" },
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
      meta: { priority: "always" },
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
            title={`último ${doc.ultimo_intento || "—"}`}
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
      meta: { priority: "always" },
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
      id: "estado_generacion",
      header: "Estado",
      accessorFn: (doc) => doc.estado_generacion,
      meta: { priority: "2xl" },
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {ESTADO_GENERACION_LABEL[row.original.estado_generacion] ??
            row.original.estado_generacion}
        </span>
      ),
    },
  ];

  if (selection) {
    const columnaSeleccion: ColumnDef<IntelisisUfeRow> = {
      id: "seleccion",
      header: ({ table }) => {
        const pagina = table.getRowModel().rows.map((row) => row.original);
        const marcados = pagina.filter((fila) =>
          selection.seleccionados.has(fila.id_venta),
        ).length;
        const todos = pagina.length > 0 && marcados === pagina.length;
        return (
          <Checkbox
            checked={todos}
            indeterminate={marcados > 0 && !todos}
            aria-label={
              todos
                ? "Quitar la selección de esta página"
                : "Seleccionar los documentos de esta página"
            }
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={(checked) =>
              selection.onTogglePagina(pagina, checked === true)
            }
          />
        );
      },
      enableSorting: false,
      meta: { priority: "always" },
      cell: ({ row }) => {
        const doc = row.original;
        return (
          <span
            className="flex items-center"
            onClick={(event) => event.stopPropagation()}
          >
            <Checkbox
              checked={selection.seleccionados.has(doc.id_venta)}
              aria-label={`Seleccionar ${doc.comprobante || doc.documento}`}
              onCheckedChange={(checked) =>
                selection.onToggle(doc.id_venta, checked === true)
              }
            />
          </span>
        );
      },
    };
    columnas.unshift(columnaSeleccion);
  }

  return columnas;
}
