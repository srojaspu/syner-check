import type { ReactNode } from "react";
import type { Column, ColumnDef } from "@tanstack/react-table";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CalendarDaysIcon,
  FileDownIcon,
  Loading02Icon,
} from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { DataTable } from "@/components/DataTable";
import { ResultsCard } from "@/components/ResultsCard";
import type { IntelisisUfeRow } from "../api/types";

interface IncidenciaCount {
  key: string;
  count: number;
}

interface IntelisisUfeResultadosProps {
  filas: IntelisisUfeRow[];
  columns: ColumnDef<IntelisisUfeRow>[];
  renderFiltro: (column: Column<IntelisisUfeRow>) => ReactNode;
  loading: boolean;
  /** Ya se pulso Consultar o Buscar al menos una vez. */
  hayConsulta: boolean;
  modo: "range" | "number";
  periodo: { desde: string; hasta: string };
  /** Filas que quedan despues de los filtros de la tabla. */
  visibles: number;
  incidencias: IncidenciaCount[];
  seleccionados: number;
  filtros: { activos: number; onLimpiar: () => void };
  reenvio: { habilitado: boolean; total: number; onReenviar: () => void };
  sunat: {
    total: number;
    excedido: boolean;
    busy: boolean;
    /** Hay otra operación larga en curso: no se puede iniciar esta. */
    disabled: boolean;
    limite: number;
    onValidar: () => void;
  };
  exportar: { total: number; truncado: boolean; onExportar: () => void };
  onRowClick: (row: IntelisisUfeRow) => void;
  onFilteredRowsChange: (rows: IntelisisUfeRow[]) => void;
}

/**
 * Card de resultados de Intelisis UFE: conteo, incidencias, acciones
 * (reenviar, validar en SUNAT, exportar) y la grilla.
 *
 * Separado de la pagina para que esta se quede con el estado y las consultas;
 * las acciones llegan como callbacks y el conteo de SUNAT ya viene acotado.
 */
export function IntelisisUfeResultados({
  filas,
  columns,
  renderFiltro,
  loading,
  hayConsulta,
  modo,
  periodo,
  visibles,
  incidencias,
  seleccionados,
  filtros,
  reenvio,
  sunat,
  exportar,
  onRowClick,
  onFilteredRowsChange,
}: IntelisisUfeResultadosProps) {
  const limite = sunat.limite.toLocaleString("es-PE");

  const tituloSunat = sunat.excedido
    ? `El tope por solicitud es de ${limite} documentos: selecciona o filtra`
    : !sunat.total
      ? "No hay documentos mostrados que se puedan validar en SUNAT"
      : seleccionados
        ? `Consulta en SUNAT los ${sunat.total} documentos seleccionados`
        : "Consulta en SUNAT los documentos mostrados";

  return (
    <ResultsCard
      title="Comprobantes"
      summary={
        hayConsulta
          ? `${visibles} documento${visibles === 1 ? "" : "s"}${
              modo === "range" && periodo.desde
                ? ` · ${periodo.desde} a ${periodo.hasta}`
                : ""
            }`
          : "Selecciona un periodo para comenzar."
      }
      details={
        incidencias.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {incidencias.map((item) => (
              <Badge key={item.key} variant="outline">
                {item.key}: {item.count}
              </Badge>
            ))}
          </div>
        ) : null
      }
      actions={
        <>
          {reenvio.habilitado ? (
            <Button
              type="button"
              disabled={!reenvio.total}
              onClick={reenvio.onReenviar}
              title="Encola los documentos marcados en la cola del ERP"
            >
              Reenviar selección{reenvio.total ? ` (${reenvio.total})` : ""}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={!sunat.total || sunat.busy || sunat.disabled || sunat.excedido}
            onClick={sunat.onValidar}
            title={tituloSunat}
          >
            {sunat.busy ? (
              <HugeiconsIcon
                icon={Loading02Icon}
                size={16}
                strokeWidth={2}
                className="animate-spin"
                aria-hidden
              />
            ) : null}{" "}
            Validar en SUNAT{sunat.total ? ` (${sunat.total})` : ""}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!exportar.total}
            onClick={exportar.onExportar}
            title={
              exportar.truncado
                ? "El listado esta recortado: el archivo lo deja constancia"
                : "Exporta los documentos mostrados"
            }
          >
            <HugeiconsIcon
              icon={FileDownIcon}
              size={16}
              strokeWidth={2}
              aria-hidden
            />{" "}
            Exportar Excel{exportar.total ? ` (${exportar.total})` : ""}
          </Button>
        </>
      }
    >
      <>
        {!hayConsulta ? (
          loading ? (
            <div
              className="flex flex-col items-center gap-2 py-12"
              role="status"
              aria-live="polite"
            >
              <HugeiconsIcon
                icon={Loading02Icon}
                size={22}
                strokeWidth={2}
                className="animate-spin text-muted-foreground"
                aria-hidden
              />
              <p className="text-sm text-muted-foreground">
                {modo === "range"
                  ? "Consultando el período…"
                  : "Buscando el comprobante…"}
              </p>
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={CalendarDaysIcon} strokeWidth={2} />
                </EmptyMedia>
                <EmptyTitle>Aun no hay consulta</EmptyTitle>
                <EmptyDescription>
                  {modo === "range" ? (
                    <>
                      Elige el periodo y pulsa <b>Consultar</b>. No se consulta
                      nada hasta que lo pidas.
                    </>
                  ) : (
                    <>
                      Escribe el numero de comprobante y pulsa <b>Buscar</b>.
                    </>
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        ) : (
          <DataTable.Root
            key={`${modo}-${periodo.desde}-${periodo.hasta}`}
            data={filas}
            columns={columns}
            renderFilter={renderFiltro}
            onRowClick={onRowClick}
            onFilteredRowsChange={onFilteredRowsChange}
          >
            <DataTable.Toolbar
              active={filtros.activos}
              onClear={filtros.onLimpiar}
            />
            <DataTable.View<IntelisisUfeRow> loading={loading} />
            <DataTable.Pagination loading={loading} />
          </DataTable.Root>
        )}
      </>
    </ResultsCard>
  );
}
