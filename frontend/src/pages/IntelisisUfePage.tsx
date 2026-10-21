import { useCallback, useEffect, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CalendarDaysIcon,
  FileDownIcon,
  InformationCircleIcon,
  Loading02Icon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { DataTable } from "@/components/DataTable";
import { intelisisUfeColumns } from "@/components/IntelisisUfeColumns";
import { IntelisisUfeCobertura } from "@/components/IntelisisUfeCobertura";
import { IntelisisUfeDetalle } from "@/components/IntelisisUfeDetalle";
import { creaRenderFiltro } from "@/components/IntelisisUfeFiltros";
import { IntelisisUfeKpis } from "@/components/IntelisisUfeKpis";
import { IntelisisUfePeriodo } from "@/components/IntelisisUfePeriodo";
import { NumberPanel } from "@/components/SearchPanels";
import { SunatConfirmDialog } from "@/components/SunatConfirmDialog";
import { SunatProgress } from "@/components/SunatProgress";
import { Tabs } from "@/components/AppShell";
import { exportIntelisisUfeExcel } from "../api/excel";
import { toISODate } from "../api/format";
import type {
  IntelisisUfeFiltros,
  IntelisisUfeRow,
  SunatDocumentInput,
} from "../api/types";
import { useIntelisisUfe } from "../hooks/useIntelisisUfe";
import { useSunat } from "../hooks/useSunat";

const MAX_DIAS = 31;
const MODOS = [
  { value: "periodo" as const, label: "Periodo" },
  { value: "comprobante" as const, label: "Comprobante" },
];

/** Compara filtros sin depender del orden de las claves. */
function mismosFiltros(
  a: IntelisisUfeFiltros,
  b: IntelisisUfeFiltros,
): boolean {
  const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const clave of claves) {
    if (
      String(a[clave as keyof IntelisisUfeFiltros] ?? "") !==
      String(b[clave as keyof IntelisisUfeFiltros] ?? "")
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Pantalla Intelisis UFE: comprobantes de origen Intelisis y el estado del
 * generador (`SPPUFE_UBL21`), el estado SUNAT y las incidencias.
 *
 * El vocabulario es el de la pestana FE del PHP: `resultado`
 * (CONFORME/REVISAR), `generador` (SIN TRAZA/OK REGISTRADO/SIN OK) e
 * `incidencias`. Los filtros van al servidor: con 31 dias el universo
 * llega a ~18.000 documentos y filtrarlos en el navegador no era viable.
 *
 * Dos modos de consulta, como en la pantalla de comprobantes: por
 * **periodo** o por **numero de comprobante**. En los dos casos se consulta
 * solo al pulsar "Consultar".
 */
export default function IntelisisUfePage({
  onAuthFailure,
}: {
  onAuthFailure: () => void;
}) {
  const ufe = useIntelisisUfe(onAuthFailure);
  const sunat = useSunat(onAuthFailure);
  const [modo, setModo] = useState<"periodo" | "comprobante">("periodo");
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const hoy = new Date();
    const desde = new Date(hoy);
    desde.setDate(hoy.getDate() - 6);
    return { from: desde, to: hoy };
  });
  /** Periodo y filtros en borrador: todavia no consultados. */
  const [borrador, setBorrador] = useState<IntelisisUfeFiltros>({});
  /** Consulta aplicada (null = todavia no se consulto nada). */
  const [consulta, setConsulta] = useState<{
    desde: string;
    hasta: string;
    filtros: IntelisisUfeFiltros;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sunatDialogOpen, setSunatDialogOpen] = useState(false);
  const [filteredRows, setFilteredRows] = useState<IntelisisUfeRow[] | null>(
    null,
  );

  // Unica consulta posible: la que el usuario lanzo con "Consultar".
  useEffect(() => {
    if (!consulta) return;
    void ufe.run(consulta.desde, consulta.hasta, consulta.filtros);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta]);

  const consultarPeriodo = useCallback(() => {
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
    setConsulta({
      desde: toISODate(range.from),
      hasta: toISODate(range.to),
      filtros: borrador,
    });
  }, [range, borrador]);

  const alternar = useCallback(
    (clave: "resultado" | "generador" | "sunat", valor: string) => {
      setBorrador((prev) => {
        const esIgual = String(prev[clave] ?? "") === valor;
        const siguiente = { ...prev };
        if (esIgual) {
          delete siguiente[clave];
        } else {
          siguiente[clave] = valor;
        }
        return siguiente;
      });
    },
    [],
  );

  // Hay cambios sin consultar: el boton lo avisa.
  const pendiente = useMemo(() => {
    if (!consulta) return true;
    const desde = range?.from ? toISODate(range.from) : "";
    const hasta = range?.to ? toISODate(range.to) : "";
    if (desde !== consulta.desde || hasta !== consulta.hasta) return true;
    return !mismosFiltros(borrador, consulta.filtros);
  }, [consulta, range, borrador]);

  const renderFiltro = useMemo(
    () => creaRenderFiltro(borrador, setBorrador, ufe.kpis),
    [borrador, ufe.kpis],
  );

  const filas =
    modo === "periodo" ? ufe.rows : (ufe.busqueda?.rows ?? []);
  const columns = useMemo(() => intelisisUfeColumns(), []);
  const kpis = ufe.kpis;
  const visibles = filteredRows ?? filas;

  /** Documentos consultables en SUNAT (el backend arma el payload final). */
  const consultables: SunatDocumentInput[] = useMemo(
    () =>
      filas
        .filter((fila) => fila.tipo_sunat && fila.comprobante)
        .map((fila) => ({
          tipo: fila.tipo_sunat,
          number: fila.comprobante,
          date: fila.fecha_emision,
          crossTotal: fila.total,
          sunat: { estado: fila.estado_sunat },
        })),
    [filas],
  );

  const refrescar = useCallback(async () => {
    if (modo === "periodo" && consulta) {
      setConsulta({ ...consulta });
    }
  }, [modo, consulta]);

  const hayConsulta =
    modo === "periodo" ? Boolean(consulta) : Boolean(ufe.busqueda);

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

      <Tabs mode={modo} onChange={setModo} options={MODOS} />

      {modo === "periodo" ? (
        <IntelisisUfePeriodo
          range={range}
          onRange={setRange}
          onConsultar={consultarPeriodo}
          loading={ufe.loading}
          pendiente={pendiente}
        />
      ) : (
        <NumberPanel
          disabled={ufe.loading}
          label="Numero de comprobante"
          placeholder="Ej. B710-00004539"
          hint="Busca el comprobante por su numero oficial (prefijo de tipo, serie y correlativo), sin periodo."
          onSearch={(documento) => {
            setFormError(null);
            void ufe.buscar(documento);
          }}
        />
      )}

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

      {modo === "periodo" && kpis ? (
        <IntelisisUfeKpis
          kpis={kpis}
          filtros={borrador}
          onAlternar={alternar}
          onLimpiar={() => setBorrador({})}
        />
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

      {sunat.progress || sunat.notice || sunat.warning || sunat.error ? (
        <SunatProgress
          progress={sunat.progress}
          notice={sunat.notice}
          warning={sunat.warning}
          error={sunat.error}
        />
      ) : null}

      {modo === "periodo" && kpis?.por_dia?.length ? (
        <IntelisisUfeCobertura dias={kpis.por_dia} />
      ) : null}

      <Card>
        <CardHeader className="gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-base font-medium">Comprobantes</h2>
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {hayConsulta
                  ? `${visibles.length} documentos${
                      modo === "periodo" && ufe.desde
                        ? ` · ${ufe.desde} a ${ufe.hasta}`
                        : ""
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
              variant="outline"
              disabled={!consultables.length || sunat.busy}
              onClick={() => setSunatDialogOpen(true)}
              title="Consulta en SUNAT los documentos mostrados"
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
              Validar en SUNAT
              {consultables.length ? ` (${consultables.length})` : ""}
            </Button>
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
          {!hayConsulta ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={CalendarDaysIcon} strokeWidth={2} />
                </EmptyMedia>
                <EmptyTitle>Aun no hay consulta</EmptyTitle>
                <EmptyDescription>
                  {modo === "periodo" ? (
                    <>
                      Elige el periodo y pulsa <b>Consultar</b>. No se
                      consulta nada hasta que lo pidas.
                    </>
                  ) : (
                    <>
                      Escribe el numero de comprobante y pulsa <b>Buscar</b>.
                    </>
                  )}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <DataTable.Root
              key={`${modo}-${ufe.desde}-${ufe.hasta}`}
              data={filas}
              columns={columns}
              renderFilter={renderFiltro}
              onRowClick={(row) => void ufe.abrirDetalle(row.id_venta)}
              onFilteredRowsChange={setFilteredRows}
            >
              <DataTable.View<IntelisisUfeRow> loading={ufe.loading} />
              <DataTable.Pagination loading={ufe.loading} />
            </DataTable.Root>
          )}
        </CardContent>
      </Card>

      <SunatConfirmDialog
        open={sunatDialogOpen}
        onOpenChange={setSunatDialogOpen}
        rows={consultables}
        onConfirm={(scope) => {
          void sunat.runBatch(consultables, refrescar, scope);
        }}
      />

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
