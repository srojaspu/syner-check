import type { ColumnDef } from "@tanstack/react-table";
import type { PosTerminal } from "../../api/types";
import { fmtFecha, numeroFmt } from "./format";
import { EVENT_DICTIONARY, shortEventLabel } from "./posCatalog";
import { PosHealthBadge } from "./PosLevelBadge";

/** Columnas de la tabla de instancias/terminales (DataTable compartido). */
export function terminalColumns(): ColumnDef<PosTerminal, unknown>[] {
  return [
    {
      accessorKey: "instancia",
      header: "Instancia",
      meta: { priority: "always", width: "grow" },
      cell: ({ row }) => (
        <span className="block max-w-56 truncate font-medium">
          {row.original.instancia}
        </span>
      ),
    },
    {
      accessorKey: "serial",
      header: "Serial",
      meta: { priority: "always" },
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.serial ?? "—"}</span>
      ),
    },
    {
      accessorKey: "salud",
      header: "Salud",
      enableSorting: false,
      meta: { priority: "always" },
      cell: ({ row }) => <PosHealthBadge salud={row.original.salud} />,
    },
    {
      accessorKey: "errores",
      header: "Errores",
      meta: { priority: "always" },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {numeroFmt.format(row.original.errores)}
        </span>
      ),
    },
    {
      accessorKey: "eventos",
      header: "Eventos",
      meta: { priority: "always" },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {numeroFmt.format(row.original.eventos)}
        </span>
      ),
    },
    {
      accessorKey: "version",
      header: "Versión",
      meta: { priority: "always" },
      cell: ({ row }) => (
        <span className="text-xs">{row.original.version ?? "—"}</span>
      ),
    },
    {
      accessorKey: "ultimaActividad",
      header: "Última actividad",
      meta: { priority: "always" },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {fmtFecha(row.original.ultimaActividad)}
        </span>
      ),
    },
    {
      id: "ultimaFalla",
      header: "Última falla",
      accessorFn: (terminal) => terminal.ultimaFalla ?? "",
      meta: { priority: "always" },
      cell: ({ row }) => {
        const { ultimaFalla, ultimaFallaFecha } = row.original;
        if (!ultimaFalla) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        const fullMsg = EVENT_DICTIONARY[ultimaFalla]?.mensaje ?? ultimaFalla;
        return (
          <div className="flex flex-col" title={fullMsg}>
            <span className="max-w-56 truncate text-xs font-medium">
              {shortEventLabel(ultimaFalla)}
            </span>
            <span className="max-w-56 truncate font-mono text-[10px] text-muted-foreground">
              {ultimaFalla}
              {ultimaFallaFecha ? ` · ${fmtFecha(ultimaFallaFecha)}` : ""}
            </span>
          </div>
        );
      },
    },
  ];
}
