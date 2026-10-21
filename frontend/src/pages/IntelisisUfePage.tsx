import { useCallback, useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTable } from "@/components/DataTable";
import { intelisisUfeColumns } from "@/components/IntelisisUfeColumns";
import { IntelisisUfeDetalle } from "@/components/IntelisisUfeDetalle";
import { DateRangePicker } from "@/components/search/DateRangePicker";
import { exportIntelisisUfeExcel } from "../api/excel";
import { formatDate, toISODate } from "../api/format";
import type { IntelisisUfeFiltros, IntelisisUfeRow } from "../api/types";
import { useIntelisisUfe } from "../hooks/useIntelisisUfe";

const MAX_DIAS = 31;
const ALL = "__all";

function rangoInicial(): { desde: string; hasta: string } {
  const hoy = new Date();
  const desde = new Date(hoy);
  desde.setDate(hoy.getDate() - 6);
  return {
    desde: toISODate(desde),
    hasta: toISODate(hoy),
  };
}

function KpiTile({
  label,
  value,
  hint,
  tone = "neutral",
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "neutral" | "alert";
  active?: boolean;
  onClick?: () => void;
}) {
  const contenido = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "alert" && value > 0 && "text-destructive",
        )}
      >
        {value.toLocaleString("es-PE")}
      </p>
      {hint ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </>
  );
  if (!onClick) {
    return (
      <div className="rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/10">
        {contenido}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? "Quitar este filtro" : `Filtrar por ${label.toLowerCase()}`}
      className={cn(
        "rounded-2xl bg-card px-4 py-3 text-left ring-1 outline-none transition-shadow",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active ? "ring-2 ring-foreground/40" : "ring-foreground/10 hover:ring-foreground/25",
      )}
    >
      {contenido}
    </button>
  );
}

function FiltroSelect({
  label,
  value,
  placeholder,
  options,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select
        value={value || ALL}
        onValueChange={(next) =>
          onChange(!next || next === ALL ? "" : next)
        }
      >
        <SelectTrigger
          size="sm"
          className="h-8 w-full min-w-0"
          aria-label={label}
        >
          <SelectValue>
            {(current) =>
              !current || current === ALL
                ? placeholder
                : (options.find((option) => option.value === current)?.label ??
                  String(current))
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Pantalla Intelisis UFE: comprobantes de origen Intelisis y el estado del
 * generador (`SPPUFE_UBL21`), el estado SUNAT y las incidencias.
 *
 * El vocabulario es el de la pestana FE del PHP: `resultado`
 * (CONFORME/REVISAR), `generador` (SIN TRAZA/OK REGISTRADO/SIN OK) e
 * `incidencias`. Los filtros van al servidor: con 31 dias el universo
 * llega a ~18.000 documentos y filtrarlos en el navegador no era viable.
 */
export default function IntelisisUfePage({
  onAuthFailure,
}: {
  onAuthFailure: () => void;
}) {
  const ufe = useIntelisisUfe(onAuthFailure);
  const [periodo, setPeriodo] = useState(rangoInicial);
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const hoy = new Date();
    const desde = new Date(hoy);
    desde.setDate(hoy.getDate() - 6);
    return { from: desde, to: hoy };
  });
  const [filtros, setFiltros] = useState<IntelisisUfeFiltros>({});
  const [busqueda, setBusqueda] = useState("");
  const [qAplicada, setqAplicada] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [coberturaAbierta, setCoberturaAbierta] = useState(false);
  const [filteredRows, setFilteredRows] = useState<IntelisisUfeRow[] | null>(
    null,
  );

  const filtrosKey = JSON.stringify({ ...filtros, q: qAplicada });

  // La busqueda se aplica con retardo: no tiene sentido pegarle al ERP en
  // cada tecla.
  useEffect(() => {
    const timer = setTimeout(() => setqAplicada(busqueda.trim()), 350);
    return () => clearTimeout(timer);
  }, [busqueda]);

  // Una sola consulta gobierna periodo y filtros.
  useEffect(() => {
    void ufe.run(periodo.desde, periodo.hasta, filtros);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo.desde, periodo.hasta, filtrosKey]);

  const consultar = useCallback(() => {
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
    setFormError(null);
    setPeriodo({
      desde: toISODate(range.from),
      hasta: toISODate(range.to),
    });
  }, [range]);

  const limpiarFiltros = useCallback(() => {
    setFiltros({});
    setBusqueda("");
  }, []);

  const alternar = useCallback(
    <K extends keyof IntelisisUfeFiltros>(clave: K, valor: string) => {
      setFiltros((prev) => {
        const actual = prev[clave];
        const esIgual = String(actual ?? "") === valor;
        const siguiente = { ...prev };
        if (esIgual) {
          delete siguiente[clave];
        } else {
          siguiente[clave] = valor as IntelisisUfeFiltros[K];
        }
        return siguiente;
      });
    },
    [],
  );

  const rows = ufe.rows ?? [];
  const columns = useMemo(() => intelisisUfeColumns(), []);
  const kpis = ufe.kpis;
  const visibles = filteredRows ?? rows;
  const porDia = kpis?.por_dia ?? [];

  const filtrosActivos = useMemo(() => {
    const chips: { clave: string; etiqueta: string; limpiar: () => void }[] = [];
    if (filtros.resultado) {
      chips.push({
        clave: "resultado",
        etiqueta: `Resultado: ${filtros.resultado}`,
        limpiar: () => alternar("resultado", filtros.resultado ?? ""),
      });
    }
    if (filtros.generador) {
      chips.push({
        clave: "generador",
        etiqueta: `Generador: ${filtros.generador}`,
        limpiar: () => alternar("generador", filtros.generador ?? ""),
      });
    }
    if (filtros.tipo) {
      chips.push({
        clave: "tipo",
        etiqueta: `Tipo: ${filtros.tipo}`,
        limpiar: () => alternar("tipo", filtros.tipo ?? ""),
      });
    }
    if (filtros.sunat) {
      chips.push({
        clave: "sunat",
        etiqueta: `SUNAT: ${filtros.sunat}`,
        limpiar: () => alternar("sunat", filtros.sunat ?? ""),
      });
    }
    if (filtros.incidencia) {
      chips.push({
        clave: "incidencia",
        etiqueta: `Incidencia: ${filtros.incidencia}`,
        limpiar: () => alternar("incidencia", filtros.incidencia ?? ""),
      });
    }
    if (filtros.q) {
      chips.push({
        clave: "q",
        etiqueta: `Busqueda: ${filtros.q}`,
        limpiar: () => setBusqueda(""),
      });
    }
    return chips;
  }, [filtros, alternar]);

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
          <DateRangePicker value={range} onChange={setRange} label="Periodo" />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Periodos rapidos
            </span>
            <div className="flex items-center gap-1">
              {[
                { etiqueta: "Hoy", dias: 0 },
                { etiqueta: "7 dias", dias: 6 },
                { etiqueta: "30 dias", dias: 29 },
              ].map((preset) => (
                <Button
                  key={preset.etiqueta}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const hoy = new Date();
                    const desde = new Date(hoy);
                    desde.setDate(hoy.getDate() - preset.dias);
                    setRange({ from: desde, to: hoy });
                    setFormError(null);
                    setPeriodo({
                      desde: toISODate(desde),
                      hasta: toISODate(hoy),
                    });
                  }}
                >
                  {preset.etiqueta}
                </Button>
              ))}
            </div>
          </div>
          <Button
            type="button"
            onClick={consultar}
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
          <KpiTile
            label="Emitidos"
            value={kpis.total}
            active={!filtros.resultado && !filtros.generador}
            onClick={limpiarFiltros}
          />
          <KpiTile
            label="Conformes"
            value={kpis.conformes}
            hint={`${kpis.con_incidencia} por revisar`}
            active={filtros.resultado === "CONFORME"}
            onClick={() => alternar("resultado", "CONFORME")}
          />
          <KpiTile
            label="Con incidencia"
            value={kpis.con_incidencia}
            tone="alert"
            active={filtros.resultado === "REVISAR"}
            onClick={() => alternar("resultado", "REVISAR")}
          />
          <KpiTile
            label="Sin traza"
            value={kpis.sin_traza}
            hint={`${kpis.en_espera} en espera · ${kpis.no_aplica} no aplica`}
            active={filtros.generador === "SIN TRAZA"}
            onClick={() => alternar("generador", "SIN TRAZA")}
          />
          <KpiTile
            label="Sin cobertura SUNAT"
            value={kpis.sin_cobertura_sunat}
            hint="sin consultar"
            active={filtros.sunat === "SUNAT SIN CONSULTA"}
            onClick={() => alternar("sunat", "SUNAT SIN CONSULTA")}
          />
        </section>
      ) : null}

      {ufe.truncado ? (
        <Alert>
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} />
          <AlertTitle>Listado recortado</AlertTitle>
          <AlertDescription>
            Se muestran {ufe.maxFilas.toLocaleString("es-PE")} de{" "}
            {ufe.filtradosTotal.toLocaleString("es-PE")} documentos que pasan
            el filtro. Afina el periodo o usa los filtros (resultado,
            generador, tipo) para ver el resto.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative min-w-56 flex-1">
              <HugeiconsIcon
                icon={Search01Icon}
                size={16}
                strokeWidth={2}
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={busqueda}
                onChange={(event) => setBusqueda(event.target.value)}
                placeholder="Buscar por documento, cliente o sucursal…"
                aria-label="Buscar comprobantes"
                className="pl-9"
              />
            </div>
            <FiltroSelect
              label="Resultado"
              value={filtros.resultado ?? ""}
              placeholder="Todos"
              options={[
                { value: "CONFORME", label: "Conforme" },
                { value: "REVISAR", label: "Revisar" },
              ]}
              onChange={(value) => alternar("resultado", value)}
            />
            <FiltroSelect
              label="Generador"
              value={filtros.generador ?? ""}
              placeholder="Todos"
              options={[
                { value: "OK REGISTRADO", label: "OK registrado" },
                { value: "SIN OK", label: "Sin OK" },
                { value: "SIN TRAZA", label: "Sin traza" },
                { value: "NO APLICA", label: "No aplica" },
              ]}
              onChange={(value) => alternar("generador", value)}
            />
            <FiltroSelect
              label="Tipo"
              value={filtros.tipo ?? ""}
              placeholder="Todos"
              options={[
                { value: "BO", label: "Boleta" },
                { value: "FA", label: "Factura" },
                { value: "NC", label: "Nota de crédito" },
                { value: "ND", label: "Nota de débito" },
              ]}
              onChange={(value) => alternar("tipo", value)}
            />
            <FiltroSelect
              label="SUNAT"
              value={filtros.sunat ?? ""}
              placeholder="Todos"
              options={[
                { value: "ACEPTADO", label: "Aceptado" },
                { value: "SUNAT NO ENCONTRADO", label: "No encontrado" },
                { value: "SUNAT NO ACEPTADO", label: "No aceptado" },
                { value: "SUNAT SIN CONSULTA", label: "Sin consulta" },
              ]}
              onChange={(value) => alternar("sunat", value)}
            />
            <FiltroSelect
              label="Estado"
              value={filtros.estado ?? ""}
              placeholder="Todos"
              options={[
                { value: "generado", label: "Generado" },
                { value: "error_validacion", label: "Error de validación" },
                { value: "omitido_validacion", label: "Omitido en validación" },
                { value: "sin_bloque", label: "Sin bloque de tipo" },
                { value: "en_proceso", label: "En proceso" },
                { value: "sin_registro", label: "Sin registro" },
                { value: "fuera_de_bitacora", label: "Fuera de bitácora" },
              ]}
              onChange={(value) => alternar("estado", value)}
            />
            <FiltroSelect
              label="Sucursal"
              value={filtros.sucursal ? String(filtros.sucursal) : ""}
              placeholder="Todas"
              options={(kpis?.por_sucursal ?? []).map((item) => ({
                value: String(item.sucursal),
                label: `${item.sucursal} · ${item.nombre}`,
              }))}
              onChange={(value) =>
                setFiltros((prev) => {
                  const siguiente = { ...prev };
                  if (value) {
                    siguiente.sucursal = Number(value);
                  } else {
                    delete siguiente.sucursal;
                  }
                  return siguiente;
                })
              }
            />
            <FiltroSelect
              label="Incidencia"
              value={filtros.incidencia ?? ""}
              placeholder="Todas"
              options={(kpis?.por_incidencia ?? []).map((item) => ({
                value: item.key,
                label: `${item.key} (${item.count})`,
              }))}
              onChange={(value) => alternar("incidencia", value)}
            />
          </div>

          {filtrosActivos.length ? (
            <div className="flex flex-wrap items-center gap-2">
              {filtrosActivos.map((chip) => (
                <Badge key={chip.clave} variant="secondary">
                  {chip.etiqueta}
                  <button
                    type="button"
                    onClick={chip.limpiar}
                    aria-label={`Quitar filtro ${chip.etiqueta}`}
                    className="ml-1 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    ×
                  </button>
                </Badge>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={limpiarFiltros}
              >
                Limpiar filtros
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {porDia.length ? (
        <Card>
          <CardHeader className="gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-base font-medium">Cobertura por dia</h2>
                <p className="text-sm text-muted-foreground">
                  Documentos emitidos, sin traza y con incidencia, dia por dia.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCoberturaAbierta((abierta) => !abierta)}
                aria-expanded={coberturaAbierta}
              >
                <HugeiconsIcon
                  icon={coberturaAbierta ? ChevronUpIcon : ChevronDownIcon}
                  size={15}
                  strokeWidth={2}
                  aria-hidden
                />{" "}
                {coberturaAbierta ? "Ocultar" : "Ver"} cobertura ({porDia.length}{" "}
                dias)
              </Button>
            </div>
          </CardHeader>
          {coberturaAbierta ? (
            <CardContent>
              <div className="max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dia</TableHead>
                      <TableHead className="text-right">Emitidos</TableHead>
                      <TableHead className="text-right">Sin traza</TableHead>
                      <TableHead className="text-right">Con incidencia</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {porDia.map((dia) => (
                      <TableRow key={dia.dia}>
                        <TableCell className="tabular-nums">
                          {formatDate(dia.dia)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {dia.documentos.toLocaleString("es-PE")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {dia.sin_traza > 0 ? (
                            <span className="text-destructive">
                              {dia.sin_traza.toLocaleString("es-PE")}
                            </span>
                          ) : (
                            "0"
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {dia.con_incidencia > 0 ? (
                            <span className="text-destructive">
                              {dia.con_incidencia.toLocaleString("es-PE")}
                            </span>
                          ) : (
                            "0"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardHeader className="gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-base font-medium">Comprobantes</h2>
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {ufe.searched
                  ? `${visibles.length} documentos${
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
              onClick={() =>
                void exportIntelisisUfeExcel(visibles, {
                  truncado: ufe.truncado,
                  filtradosTotal: ufe.filtradosTotal,
                })
              }
              title={
                ufe.truncado
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
              Exportar Excel
              {visibles.length ? ` (${visibles.length})` : ""}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable.Root
            key={`${ufe.desde}-${ufe.hasta}-${filtrosKey}`}
            data={rows}
            columns={columns}
            showFilters={false}
            onRowClick={(row) => void ufe.abrirDetalle(row.id_venta)}
            onFilteredRowsChange={setFilteredRows}
          >
            <DataTable.View<IntelisisUfeRow> loading={ufe.loading} />
            <DataTable.Pagination loading={ufe.loading} />
          </DataTable.Root>
        </CardContent>
      </Card>

      <IntelisisUfeDetalle
        open={Boolean(ufe.detalle) || ufe.detalleLoading}
        detalle={ufe.detalle}
        loading={ufe.detalleLoading}
        error={ufe.detalleError}
        validando={ufe.validando}
        aviso={ufe.aviso}
        errorValidacion={ufe.errorValidacion}
        onValidar={(idVenta) => void ufe.validar(idVenta)}
        onClose={ufe.cerrarDetalle}
      />
    </div>
  );
}
