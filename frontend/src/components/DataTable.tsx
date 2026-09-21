import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type Column,
  type Table,
} from "@tanstack/react-table";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ArrowUp,
  ArrowDown,
  FilterX,
} from "lucide-react";

const TableContext = createContext<{ table: Table<unknown> } | null>(null);

function useTableInstance<T>(): Table<T> {
  const ctx = useContext(TableContext);
  if (!ctx) throw new Error("DataTable compound must be used inside Root");
  return ctx.table as Table<T>;
}

interface RootProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  children: ReactNode;
  initialPageSize?: number;
  onRowClick?: (row: T) => void;
}

/** Per-column filter configuration read from columnDef.meta. */
export interface ColumnFilterConfig {
  variant: "text" | "select";
  placeholder?: string;
  options?: { value: string; label: string }[];
}

function Root<T>({
  data,
  columns,
  children,
  initialPageSize = 25,
  onRowClick,
}: RootProps<T>) {
  // All interactive table state is controlled here: nothing implicit,
  // nothing shared between searches, nothing that can go stale.
  const [columnFilters, setColumnFilters] = useState<
    { id: string; value: unknown }[]
  >([]);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: initialPageSize,
  });
  const table = useReactTable({
    data,
    columns,
    state: { columnFilters, pagination },
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    autoResetPageIndex: true,
    // Rows are data-only; clicks open the detail drawer.
    meta: { onRowClick },
  });

  useResetPageOnDataChange(data, setPagination);

  // The table instance is a stable mutable object (useReactTable stores it in a
  // ref). Passing it straight as the context value would never change reference,
  // so the compound children (Toolbar/View/Pagination) would never re-render on
  // sorting, filtering, or pagination changes. Wrapping it in a fresh object on
  // every render makes the context value change identity, which re-renders the
  // consumers while they still read the same underlying table.
  return (
    <TableContext.Provider value={{ table: table as Table<unknown> }}>
      <div className="datatable">{children}</div>
    </TableContext.Provider>
  );
}

/** New result sets always restart from the first page. */
function useResetPageOnDataChange<T>(
  data: T[],
  setPagination: Dispatch<
    SetStateAction<{ pageIndex: number; pageSize: number }>
  >,
) {
  const previous = useRef(data);
  useEffect(() => {
    if (previous.current !== data) {
      previous.current = data;
      setPagination((current) => ({ ...current, pageIndex: 0 }));
    }
  }, [data, setPagination]);
}

function Toolbar({ action }: { action?: ReactNode }) {
  const table = useTableInstance();
  const active = table.getState().columnFilters.length;
  if (!action && active === 0) return null;
  return (
    <div className="dt-toolbar">
      {active > 0 ? (
        <button
          type="button"
          className="quick"
          onClick={() => table.resetColumnFilters()}
        >
          <FilterX size={15} aria-hidden /> Limpiar filtros ({active})
        </button>
      ) : (
        <span />
      )}
      {action}
    </div>
  );
}

function ColumnFilter<T>({ column }: { column: Column<T> }) {
  const config = column.columnDef.meta as ColumnFilterConfig | undefined;
  if (!config) return null;
  const value = (column.getFilterValue() ?? "") as string;
  if (config.variant === "select") {
    return (
      <select
        value={value}
        onChange={(event) =>
          column.setFilterValue(event.target.value || undefined)
        }
        onClick={(event) => event.stopPropagation()}
        aria-label={`Filtrar por ${String(column.id)}`}
      >
        <option value="">Todos</option>
        {(config.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      value={value}
      onChange={(event) => column.setFilterValue(event.target.value || undefined)}
      onClick={(event) => event.stopPropagation()}
      placeholder={config.placeholder ?? "Filtrar…"}
      aria-label={`Filtrar por ${String(column.id)}`}
    />
  );
}

const SKELETON_ROWS = 8;

function SkeletonRows<T>({ table }: { table: Table<T> }) {
  const colCount = table.getAllLeafColumns().length;
  return (
    <div className="table-wrap" aria-busy="true" aria-label="Cargando resultados">
      <table className="table">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id}>
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {Array.from({ length: SKELETON_ROWS }).map((_, r) => (
            <tr key={r} className="skeleton-row" aria-hidden="true">
              {Array.from({ length: colCount }).map((_, c) => (
                <td key={c}>
                  <span className="skeleton" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function View<T>({ loading }: { loading?: boolean }) {
  const table = useTableInstance<T>();
  if (loading) {
    return <SkeletonRows table={table} />;
  }
  const rows = table.getRowModel().rows;
  if (!rows.length) {
    return (
      <div className="empty">
        <b>No encontramos comprobantes</b>
        <span>Prueba otro rango, tipo o número.</span>
      </div>
    );
  }
  const onRowClick = (table.options.meta as { onRowClick?: (row: T) => void })
    ?.onRowClick;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th
                  key={header.id}
                  onClick={
                    header.column.getCanSort()
                      ? header.column.getToggleSortingHandler()
                      : undefined
                  }
                  className={header.column.getCanSort() ? "sortable" : undefined}
                  title={header.column.getCanSort() ? "Ordenar" : undefined}
                >
                  <span className="th-label">
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                    {header.column.getCanSort() ? (
                      <span className="sort-icon" aria-hidden>
                        {header.column.getIsSorted() === "asc" ? (
                          <ArrowUp size={13} />
                        ) : header.column.getIsSorted() === "desc" ? (
                          <ArrowDown size={13} />
                        ) : (
                          <ChevronsUpDown size={13} />
                        )}
                      </span>
                    ) : null}
                  </span>
                </th>
              ))}
            </tr>
          ))}
          <tr className="filter-row">
            {table.getHeaderGroups()[0]?.headers.map((header) => (
              <th key={`filter-${header.id}`}>
                <ColumnFilter column={header.column} />
              </th>
            )) ?? null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={onRowClick ? "clickable" : undefined}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({ loading }: { loading?: boolean }) {
  const table = useTableInstance();
  if (loading) {
    return (
      <div className="pagination" aria-busy="true">
        <span>Cargando resultados…</span>
      </div>
    );
  }
  const { pageIndex, pageSize } = table.getState().pagination;
  const total = table.getFilteredRowModel().rows.length;
  const from = total === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(from + table.getRowModel().rows.length - 1, total);
  return (
    <div className="pagination">
      <span>
        Mostrando {from}–{to} de {total}
      </span>
      <div className="page-actions">
        <label>
          Filas{" "}
          <select
            value={pageSize}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <button
          className="page-btn"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          aria-label="Anterior"
        >
          <ChevronLeft size={16} />
        </button>
        <b>
          {table.getPageCount() === 0 ? 0 : pageIndex + 1} /{" "}
          {table.getPageCount()}
        </b>
        <button
          className="page-btn"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          aria-label="Siguiente"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

/** Compound table: Root composes Toolbar + View + Pagination. */
export const DataTable = { Root, Toolbar, View, Pagination };
