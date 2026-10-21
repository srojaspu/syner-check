import { useCallback, useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FileDownIcon,
  InformationCircleIcon,
  Loading02Icon,
  Search01Icon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/DataTable";
import { intelisisUfeColumns } from "@/components/IntelisisUfeColumns";
import { IntelisisUfeDetalle } from "@/components/IntelisisUfeDetalle";
import { DateRangePicker } from "@/components/search/DateRangePicker";
import { exportIntelisisUfeExcel } from "../api/excel";
import { toISODate } from "../api/format";
import type { IntelisisUfeRow } from "../api/types";
import { useIntelisisUfe } from "../hooks/useIntelisisUfe";

const MAX_DIAS = 31;

function rangoInicial(): DateRange {
  const hoy = new Date();
  const desde = new Date(hoy);
  desde.setDate(hoy.getDate() - 6);
  return { from: desde, to: hoy };
}

function KpiTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "neutral" | "alert";
}) {
  return (
    <div className="rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/10">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "alert" && "text-destructive",
        )}
      >
        {value.toLocaleString("es-PE")}
      </p>
      {hint ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function coincide(row: IntelisisUfeRow, needle: string): boolean {
  if (!needle) return true;
  const bajos = needle.toLowerCase();
  return [
    row.documento,
    row.cliente,
    row.mov_id,
    row.mov,
    row.sucursal_nombre,
    String(row.sucursal),
    String(row.id_venta),
  ].some((campo) => campo.toLowerCase().includes(bajos));
}

/**
 * Pantalla Intelisis UFE: comprobantes de origen Intelisis y el estado del
 * generador (`SPPUFE_UBL21`), el estado SUNAT y las incidencias.
 *
 * El vocabulario es el de la pestana FE del PHP: `resultado`
 * (CONFORME/REVISAR), `generador` (SIN TRAZA/OK REGISTRADO/SIN OK) e
 * `incidencias`. El estado tecnico queda en la ultima columna.
 */
export default function IntelisisUfePage({
  onAuthFailure,
}: {
  onAuthFailure: () => void;
}) {
  const ufe = useIntelisisUfe(onAuthFailure);
  const [range, setRange] = useState<DateRange | undefined>(rangoInicial);
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filteredRows, setFilteredRows] = useState<IntelisisUfeRow[] | null>(
    null,
  );

  const consultar = useCallback(
    (desde: string, hasta: string) => {
      setFormError(null);
      setFilteredRows(null);
      setQuery("");
      void ufe.run(desde, hasta);
    },
    [ufe],
  );

  // Primera carga: el periodo por defecto (ultimos 7 dias) ya es util.
  useEffect(() => {
    const inicial = rangoInicial();
    void ufe.run(
      toISODate(inicial.from ?? new Date()),
      toISODate(inicial.to ?? new Date()),
    );
    // Solo al montar: las consultas posteriores son explicitas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSearch = () => {
    if (!range?.from || !range?.to) {
      setFormError("Selecciona el periodo completo (inicio y fin).");
      return;
    }
    const dias =
      Math.round(
        (range.to.getTime() - range.from.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1;
    if (dias > MAX_DIAS) {
      setFormError(`El periodo maximo es de ${MAX_DIAS} dias.`);
      return;
    }
    consultar(toISODate(range.from), toISODate(range.to));
  };

  const rows = useMemo(
    () => (ufe.rows ?? []).filter((row) => coincide(row, query.trim())),
    [ufe.rows, query],
  );
  const columns = useMemo(() => intelisisUfeColumns(rows), [rows]);
  const kpis = ufe.kpis;
  const visibles = filteredRows ?? rows;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold tracking-tight">
            Intelisis · UFE
          </h1>
          <span className="text-sm text-muted-foreground">
            Comprobantes de origen Intelisis y el estado del generador
          </span>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Revisa que el generador de comprobantes electronicos produjo el
          archivo de cada venta y si SUNAT lo acepto. El estado SUNAT se
          consulta en SUNAT; la conciliacion del portal de Carvajal no aplica.
        </p>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4">
          <DateRangePicker
            value={range}
            onChange={setRange}
            label="Periodo"
          />
          <Button
            type="button"
            onClick={onSearch}
            disabled={ufe.loading}
            className="sm:ml-auto"
          >
            {ufe.loading ? (
              <HugeiconsIcon
                icon={Loading02Icon}
                size={16}
                strokeWidth={2}
                className="animate-spin"
                aria-hidden
              />
            ) : null}{" "}
            Consultar
          </Button>
        </CardContent>
      </Card>

      {formError ? (
        <Alert variant="destructive">
          <HugeiconsIcon icon={TriangleAlertIcon} strokeWidth={2} />
          <AlertTitle>Revisa el periodo</AlertTitle>
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}

      {ufe.error ? (
        <Alert variant="destructive">
          <HugeiconsIcon icon={TriangleAlertIcon} strokeWidth={2} />
          <AlertTitle>No fue posible consultar</AlertTitle>
          <AlertDescription>{ufe.error}</AlertDescription>
        </Alert>
      ) : null}

      {ufe.searched && !ufe.intelisisEnabled ? (
        <Alert>
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
          <AlertTitle>Intelisis no disponible</AlertTitle>
          <AlertDescription>
            No hay conexion configurada a la base de Intelisis. La pantalla
            queda sin datos hasta que se configure la lectura.
          </AlertDescription>
        </Alert>
      ) : null}

      {kpis ? (
        <section
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
          aria-label="Resumen del periodo"
        >
          <KpiTile label="Emitidos" value={kpis.total} />
          <KpiTile
            label="Conformes"
            value={kpis.conformes}
            hint={`${kpis.con_incidencia} por revisar`}
          />
          <KpiTile
            label="Con incidencia"
            value={kpis.con_incidencia}
            tone={kpis.con_incidencia > 0 ? "alert" : "neutral"}
          />
          <KpiTile
            label="Sin traza"
            value={kpis.sin_traza}
            hint={`${kpis.en_espera} en espera · ${kpis.no_aplica} no aplica`}
          />
          <KpiTile
            label="Sin cobertura SUNAT"
            value={kpis.sin_cobertura_sunat}
            hint="sin consultar"
          />
        </section>
      ) : null}

      <Card>
        <CardHeader className="gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-base font-medium">Comprobantes</h2>
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {ufe.searched
                  ? `${visibles.length} de ${ufe.rows.length} documentos${
                      ufe.desde ? ` · ${ufe.desde} a ${ufe.hasta}` : ""
                    }`
                  : "Selecciona un periodo para comenzar."}
              </span>
            </div>
            {kpis && kpis.por_incidencia.length ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {kpis.por_incidencia.map((item) => (
                  <Badge key={item.key} variant="outline">
                    {item.key}: {item.count}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2 sm:justify-self-end">
            <Button
              type="button"
              variant="secondary"
              disabled={!visibles.length}
              onClick={() => void exportIntelisisUfeExcel(visibles)}
              title="Exporta los documentos mostrados"
            >
              <HugeiconsIcon
                icon={FileDownIcon}
                size={16}
                strokeWidth={2}
                aria-hidden
              />{" "}
              Exportar Excel
              {visibles.length ? ` (${visibles.length})` : ""}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <HugeiconsIcon
                icon={Search01Icon}
                size={16}
                strokeWidth={2}
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por documento, cliente o sucursal…"
                aria-label="Buscar comprobantes"
                className="pl-9"
              />
            </div>
          </div>
          <DataTable.Root
            key={`${ufe.desde}-${ufe.hasta}`}
            data={rows}
            columns={columns}
            onRowClick={(row) => void ufe.abrirDetalle(row.id_venta)}
            onFilteredRowsChange={setFilteredRows}
          >
            <DataTable.Toolbar />
            <DataTable.View<IntelisisUfeRow> loading={ufe.loading} />
            <DataTable.Pagination loading={ufe.loading} />
          </DataTable.Root>
        </CardContent>
      </Card>

      <IntelisisUfeDetalle
        open={Boolean(ufe.detalle) || ufe.detalleLoading}
        detalle={ufe.detalle}
        loading={ufe.detalleLoading}
        error={ufe.error}
        validando={ufe.validando}
        aviso={ufe.aviso}
        errorValidacion={ufe.errorValidacion}
        onValidar={(idVenta) => void ufe.validar(idVenta)}
        onClose={ufe.cerrarDetalle}
      />
    </div>
  );
}
