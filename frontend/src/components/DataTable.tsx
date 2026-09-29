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
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FilterRemoveIcon,
  Loading02Icon,
  SearchXIcon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table as UiTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

/** Per-column filter configuration read from columnDef.meta.filter. */
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
      <div className="w-full">{children}</div>
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
    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 py-2">
      {active > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => table.resetColumnFilters()}
        >
          <HugeiconsIcon icon={FilterRemoveIcon} size={15} strokeWidth={2} aria-hidden /> Limpiar filtros ({active})
        </Button>
      ) : (
        <span />
      )}
      {action}
    </div>
  );
}

/** Sentinel for the "all values" option: Base UI items need a real value. */
const ALL = "__all";

function ColumnFilter<T>({ column }: { column: Column<T> }) {
  const config = (
    column.columnDef.meta as { filter?: ColumnFilterConfig } | undefined
  )?.filter;
  if (!config) return null;
  const label = `Filtrar por ${String(column.id)}`;
  if (config.variant === "select") {
    const value = (column.getFilterValue() ?? "") as string;
    return (
      <Select
        value={value || ALL}
        onValueChange={(next) =>
          column.setFilterValue(next === ALL ? undefined : next)
        }
      >
        <SelectTrigger
          size="sm"
          className="h-8 w-full min-w-28"
          aria-label={label}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos</SelectItem>
          {(config.options ?? []).map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      value={(column.getFilterValue() ?? "") as string}
      onChange={(event) =>
        column.setFilterValue(event.target.value || undefined)
      }
      onClick={(event) => event.stopPropagation()}
      placeholder={config.placeholder ?? "Filtrar…"}
      aria-label={label}
      className="h-8"
    />
  );
}

const SKELETON_ROWS = 8;

function SkeletonRows<T>({ table }: { table: Table<T> }) {
  const colCount = table.getAllLeafColumns().length;
  return (
    <div role="status" aria-busy="true" aria-label="Cargando resultados">
      <UiTable>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {Array.from({ length: SKELETON_ROWS }).map((_, r) => (
            <TableRow key={r} aria-hidden="true">
              {Array.from({ length: colCount }).map((_, c) => (
                <TableCell key={c}>
                  <Skeleton className="h-4 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </UiTable>
    </div>
  );
}

function sortDirection<T>(column: Column<T>): "ascending" | "descending" | "none" {
  if (column.getIsSorted() === "asc") return "ascending";
  if (column.getIsSorted() === "desc") return "descending";
  return "none";
}

function View<T>({ loading }: { loading?: boolean }) {
  const table = useTableInstance<T>();
  if (loading) {
    return <SkeletonRows table={table} />;
  }
  const rows = table.getRowModel().rows;
  if (!rows.length) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={SearchXIcon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>No encontramos comprobantes</EmptyTitle>
          <EmptyDescription>
            Prueba otro rango, tipo o número.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const onRowClick = (table.options.meta as { onRowClick?: (row: T) => void })
    ?.onRowClick;
  return (
    <UiTable>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => (
              <TableHead
                key={header.id}
                onClick={
                  header.column.getCanSort()
                    ? header.column.getToggleSortingHandler()
                    : undefined
                }
                aria-sort={
                  header.column.getCanSort()
                    ? sortDirection(header.column)
                    : undefined
                }
                className={
                  header.column.getCanSort()
                    ? "cursor-pointer select-none"
                    : undefined
                }
                title={header.column.getCanSort() ? "Ordenar" : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                  {header.column.getCanSort() ? (
                    <span aria-hidden>
                      {header.column.getIsSorted() === "asc" ? (
                        <HugeiconsIcon icon={ArrowUp01Icon} size={13} strokeWidth={2} />
                      ) : header.column.getIsSorted() === "desc" ? (
                        <HugeiconsIcon icon={ArrowDown01Icon} size={13} strokeWidth={2} />
                      ) : (
                        <HugeiconsIcon icon={UnfoldMoreIcon} size={13} strokeWidth={2} />
                      )}
                    </span>
                  ) : null}
                </span>
              </TableHead>
            ))}
          </TableRow>
        ))}
        <TableRow>
          {table.getHeaderGroups()[0]?.headers.map((header) => (
            <TableHead key={`filter-${header.id}`}>
              <ColumnFilter column={header.column} />
            </TableHead>
          )) ?? null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            onClick={onRowClick ? () => onRowClick(row.original) : undefined}
            className={onRowClick ? "cursor-pointer" : undefined}
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </UiTable>
  );
}

function Pagination({ loading }: { loading?: boolean }) {
  const table = useTableInstance();
  if (loading) {
    return (
      <div
        className="flex items-center gap-2 py-2 text-sm text-muted-foreground"
        aria-busy="true"
      >
        <HugeiconsIcon
          icon={Loading02Icon}
          size={16}
          strokeWidth={2}
          className="animate-spin"
          aria-hidden
        />
        <span>Cargando resultados…</span>
      </div>
    );
  }
  const { pageIndex, pageSize } = table.getState().pagination;
  const total = table.getFilteredRowModel().rows.length;
  const from = total === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(from + table.getRowModel().rows.length - 1, total);
  return (
    <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm text-muted-foreground">
        Mostrando {from}–{to} de {total}
      </span>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Filas{" "}
          <Select
            value={String(pageSize)}
            onValueChange={(next) => table.setPageSize(Number(next))}
          >
            <SelectTrigger size="sm" className="h-8" aria-label="Filas">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Button
          variant="outline"
          size="icon"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          aria-label="Anterior"
        >
          <HugeiconsIcon icon={ChevronLeftIcon} size={16} strokeWidth={2} />
        </Button>
        <span className="text-sm font-medium tabular-nums">
          {table.getPageCount() === 0 ? 0 : pageIndex + 1} /{" "}
          {table.getPageCount()}
        </span>
        <Button
          variant="outline"
          size="icon"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          aria-label="Siguiente"
        >
          <HugeiconsIcon icon={ChevronRightIcon} size={16} strokeWidth={2} />
        </Button>
      </div>
    </div>
  );
}

/** Compound table: Root composes Toolbar + View + Pagination. */
export const DataTable = { Root, Toolbar, View, Pagination };
