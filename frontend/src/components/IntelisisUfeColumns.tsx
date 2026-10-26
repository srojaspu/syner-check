import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate, formatMoney } from "../api/format";
import {
  ERP_ESTADO_DESC,
  ERP_ESTADO_LABEL,
  ESTADO_GENERACION_LABEL,
  ESTADO_SUNAT_LABEL,
} from "./IntelisisUfeEstados";
import type {
  IntelisisUfeRow,
  UfeEstadoSunat,
  UfeEstatusErp,
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

/** Estilo del badge ERP: el texto en español va siempre, el color acompaña. */
const ERP_BADGE: Record<
  UfeEstatusErp,
  { variant: BadgeVariant; className?: string }
> = {
  CONCLUIDO: { variant: "default" },
  PENDIENTE: {
    variant: "outline",
    className: "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  SINAFECTAR: { variant: "secondary" },
  CANCELADO: { variant: "outline", className: "text-muted-foreground" },
};

/**
 * Solo un comprobante concluido se puede reenviar. El backend lo rechaza
 * igual (`validar_encolado`): deshabilitar el checkbox evita el viaje inútil.
 */
function puedeReenviar(fila: IntelisisUfeRow): boolean {
  return fila.estatus_erp === "CONCLUIDO";
}

function ErpBadge({ fila }: { fila: IntelisisUfeRow }) {
  const estatus = fila.estatus_erp as UfeEstatusErp;
  const estilo = ERP_BADGE[estatus];
  const etiqueta = ERP_ESTADO_LABEL[estatus] ?? fila.estatus_erp ?? "—";
  return (
    <Badge
      variant={estilo?.variant ?? "outline"}
      className={estilo?.className}
      title={ERP_ESTADO_DESC[estatus] ?? `Estatus ERP: ${fila.estatus_erp}`}
    >
      {etiqueta}
    </Badge>
  );
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
 * La columna Generador concentra el estado del generador: el badge usa el
 * vocabulario del negocio y, debajo, se muestra el detalle tecnico solo
 * cuando el badge no lo distingue (error de validacion, sin bloque de tipo,
 * fuera de bitacora). Los filtros de la fila superior se aplican al instante
 * en el navegador.
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
      cell: ({ row }) => <ErpBadge fila={row.original} />,
    },
    {
      id: "total",
      header: "Total ERP",
      // Se muestra el importe declarado a SUNAT por el generador; si la
      // bitacora no lo trae, la suma de importe + IGV como antes.
      accessorFn: (doc) => doc.importe_sunat ?? doc.total,
      meta: { priority: "lg" },
      cell: ({ row }) => {
        const suma = row.original.total;
        const importe = row.original.importe_sunat ?? suma;
        return (
          <span
            className="amount text-right font-medium tabular-nums"
            title={
              importe !== suma
                ? "Importe declarado a SUNAT por el generador."
                : "Suma de importe + IGV del ERP."
            }
          >
            {formatMoney(importe, "PEN")}
          </span>
        );
      },
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
        // El badge ya resume el estado. El detalle tecnico solo se muestra
        // cuando "SIN OK" / "SIN TRAZA" no distinguen la causa real
        // (error de validacion, sin bloque de tipo, fuera de bitacora, ...).
        const detalle =
          doc.generador === "SIN OK" ||
          doc.estado_generacion === "fuera_de_bitacora"
            ? ESTADO_GENERACION_LABEL[doc.estado_generacion]
            : null;
        return (
          <span className="flex flex-col items-start gap-0.5">
            <Badge variant={generadorVariant(doc.generador)} title={title}>
              {doc.generador}
            </Badge>
            {detalle ? (
              <small className="text-muted-foreground">{detalle}</small>
            ) : null}
          </span>
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
  ];

  if (selection) {
    const columnaSeleccion: ColumnDef<IntelisisUfeRow> = {
      id: "seleccion",
      header: ({ table }) => {
        const pagina = table.getRowModel().rows.map((row) => row.original);
        // Solo los concluidos se pueden reenviar: la cabecera no marca los
        // que luego el backend rechazaria.
        const elegibles = pagina.filter(puedeReenviar);
        const marcados = elegibles.filter((fila) =>
          selection.seleccionados.has(fila.id_venta),
        ).length;
        const todos = elegibles.length > 0 && marcados === elegibles.length;
        return (
          <Checkbox
            checked={todos}
            indeterminate={marcados > 0 && !todos}
            disabled={elegibles.length === 0}
            aria-label={
              todos
                ? "Quitar la selección de esta página"
                : "Seleccionar los documentos de esta página"
            }
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={(checked) =>
              selection.onTogglePagina(elegibles, checked === true)
            }
          />
        );
      },
      enableSorting: false,
      meta: { priority: "always" },
      cell: ({ row }) => {
        const doc = row.original;
        const habilitado = puedeReenviar(doc);
        return (
          <span
            className="flex items-center"
            onClick={(event) => event.stopPropagation()}
          >
            <Checkbox
              checked={
                habilitado && selection.seleccionados.has(doc.id_venta)
              }
              disabled={!habilitado}
              aria-label={`Seleccionar ${doc.comprobante || doc.documento}`}
              title={
                habilitado
                  ? undefined
                  : "Solo se pueden reenviar comprobantes concluidos"
              }
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
