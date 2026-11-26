import { useMemo } from "react";
import type { PosEvento } from "../../api/types";
import { DataTable } from "@/components/DataTable";
import { EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { TooltipProvider } from "@/components/ui/tooltip";
import { eventColumns } from "./eventColumns";
import { FadeScroll } from "./FadeScroll";
import { fmtFecha } from "./format";
import type { EnrichedPosLog } from "./posAnalytics";

/**
 * Registro de eventos con el DataTable compartido: ordenamiento por columna,
 * paginación y fila clickeable que abre el detalle del evento.
 */
export function EventosTable({
  items,
  loading,
  onDetalle,
  maxHeightClass = "max-h-[28rem]",
}: {
  items: EnrichedPosLog[];
  loading: boolean;
  onDetalle: (evento: PosEvento) => void;
  maxHeightClass?: string;
}) {
  const columns = useMemo(() => eventColumns(), []);

  return (
    <TooltipProvider delay={180}>
      <DataTable.Root
        data={items}
        columns={columns}
        initialPageSize={50}
        showFilters={false}
        onRowClick={onDetalle}
        rowActionLabel={(row) =>
          `Ver detalle del evento ${row.clave} del ${fmtFecha(row.fecha)}`
        }
      >
        <FadeScroll className={`${maxHeightClass} rounded-md border`}>
          <DataTable.View<EnrichedPosLog>
            loading={loading}
            label="Eventos"
            empty={
              <div className="flex flex-col items-center gap-1.5 py-6">
                <EmptyTitle>Sin eventos</EmptyTitle>
                <EmptyDescription>
                  No hay registros con estos filtros. Prueba limpiando la
                  búsqueda o ampliando la ventana.
                </EmptyDescription>
              </div>
            }
          />
        </FadeScroll>
        <DataTable.Pagination loading={loading} />
      </DataTable.Root>
    </TooltipProvider>
  );
}
