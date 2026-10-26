import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ColumnFilterConfig,
  ResponsivePriority,
} from "@/components/DataTable";
import type {
  IntelisisReenvioEstado,
  IntelisisReenvioFila,
} from "../api/types";

/** Estados de `CK_FE_Reenvio_Estado`, en el orden del ciclo de vida. */
export const ESTADOS_REENVIO: { value: IntelisisReenvioEstado; label: string }[] =
  [
    { value: "EN_COLA", label: "En cola" },
    { value: "EJECUTANDO", label: "Ejecutando" },
    { value: "FINALIZADO_OK", label: "Finalizado OK" },
    { value: "FINALIZADO_REVISAR", label: "Finalizado · revisar" },
    { value: "NO_EJECUTADO", label: "No ejecutado" },
    { value: "NO_CONFIRMADO", label: "Sin confirmar" },
    { value: "REVISADO_MANUAL", label: "Revisado a mano" },
  ];

const ETIQUETA: Record<string, string> = Object.fromEntries(
  ESTADOS_REENVIO.map((estado) => [estado.value, estado.label]),
);

type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

function variante(estado: string): BadgeVariant {
  if (estado === "FINALIZADO_OK") return "default";
  if (estado === "FINALIZADO_REVISAR" || estado === "NO_CONFIRMADO") {
    return "destructive";
  }
  if (estado === "EN_COLA" || estado === "EJECUTANDO") return "secondary";
  return "outline";
}

/** Timestamp del ERP sin segundos ni zona: es lo que se muestra en el PHP. */
export function fechaHora(valor: string | null): string {
  if (!valor) return "—";
  return String(valor).replace("T", " ").slice(0, 16);
}

function EstadoBadge({ estado }: { estado: string }) {
  return <Badge variant={variante(estado)}>{ETIQUETA[estado] ?? estado}</Badge>;
}

const TIPOS: { value: string; label: string }[] = [
  { value: "01", label: "Factura" },
  { value: "03", label: "Boleta" },
  { value: "07", label: "Nota de crédito" },
  { value: "08", label: "Nota de débito" },
];

const texto = (placeholder: string): ColumnFilterConfig => ({
  variant: "text",
  placeholder,
});

const seleccion = (options: { value: string; label: string }[]): ColumnFilterConfig => ({
  variant: "select",
  options,
});

/** Columnas de la cola del ERP, compartidas por "En curso" e "Historial". */
export function intelisisReenvioColumns({
  resolviendo,
  onResolver,
}: {
  resolviendo: number | null;
  onResolver: (fila: IntelisisReenvioFila) => void;
}): ColumnDef<IntelisisReenvioFila>[] {
  const prioridad = (value: ResponsivePriority) => ({ priority: value });

  return [
    {
      id: "venta",
      header: "Venta",
      accessorFn: (fila) => fila.IDVenta,
      // La columna es numerica: sin esto TanStack resuelve `auto` como
      // `inNumberRange` y el texto del filtro se lee como rango, por lo que
      // ninguna venta coincide. `includesString` busca por subcadena.
      filterFn: "includesString",
      meta: { priority: "always", filter: texto("Buscar venta") },
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.IDVenta}</span>
      ),
    },
    {
      id: "tipo",
      header: "Tipo",
      accessorFn: (fila) => fila.Tipo,
      filterFn: "equals",
      meta: { priority: "sm", filter: seleccion(TIPOS) },
      cell: ({ row }) => (
        <Badge variant="outline">{row.original.Tipo || "—"}</Badge>
      ),
    },
    {
      id: "generador",
      header: "Generador",
      accessorFn: (fila) => fila.Procedimiento,
      filterFn: "equals",
      meta: {
        priority: "lg",
        filter: seleccion([
          { value: "SPPUFE_UBL21", label: "SPPUFE_UBL21" },
          { value: "SPPUFE_UBL21_NCND", label: "SPPUFE_UBL21_NCND" },
        ]),
      },
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.Procedimiento || "—"}
        </span>
      ),
    },
    {
      id: "estado",
      header: "Estado",
      accessorFn: (fila) => fila.Estado,
      filterFn: "equals",
      meta: {
        priority: "always",
        filter: seleccion(
          ESTADOS_REENVIO.map((estado) => ({
            value: estado.value,
            label: estado.label,
          })),
        ),
      },
      cell: ({ row }) => <EstadoBadge estado={row.original.Estado} />,
    },
    {
      id: "usuario",
      header: "Usuario",
      accessorFn: (fila) => fila.Usuario,
      meta: { priority: "md", filter: texto("Buscar usuario") },
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.Usuario || "—"}
        </span>
      ),
    },
    {
      id: "creado",
      header: "Creado",
      accessorFn: (fila) => fila.Creado ?? "",
      meta: prioridad("md"),
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">
          {fechaHora(row.original.Creado)}
        </span>
      ),
    },
    {
      id: "fin",
      header: "Fin",
      accessorFn: (fila) => fila.Fin ?? "",
      meta: prioridad("xl"),
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">
          {fechaHora(row.original.Fin)}
        </span>
      ),
    },
    {
      id: "detalle",
      header: "Detalle",
      accessorFn: (fila) => fila.Revision || fila.Detalle || fila.Motivo || "",
      meta: { priority: "lg", filter: texto("Buscar detalle") },
      cell: ({ row }) => {
        const fila = row.original;
        const texto = fila.Revision || fila.Detalle || fila.Motivo || "—";
        return (
          <span className="block max-w-56 truncate text-muted-foreground" title={texto}>
            {texto}
          </span>
        );
      },
    },
    {
      id: "accion",
      header: "Acción",
      enableSorting: false,
      meta: prioridad("always"),
      cell: ({ row }) => {
        const fila = row.original;
        if (fila.Estado !== "NO_CONFIRMADO") return null;
        return (
          <div className="text-right">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={resolviendo === fila.ID}
              onClick={() => onResolver(fila)}
            >
              {resolviendo === fila.ID ? "Cerrando…" : "Resolver"}
            </Button>
          </div>
        );
      },
    },
  ];
}
