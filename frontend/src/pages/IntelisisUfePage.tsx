import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DateRange } from "react-day-picker";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  InformationCircleIcon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { intelisisUfeColumns } from "@/components/IntelisisUfeColumns";
import { IntelisisUfeCobertura } from "@/components/IntelisisUfeCobertura";
import { IntelisisUfeDetalle } from "@/components/IntelisisUfeDetalle";
import {
  creaRenderFiltro,
  filtraUfeFilas,
} from "@/components/IntelisisUfeFiltros";
import { IntelisisUfeFlujo } from "@/components/IntelisisUfeFlujo";
import { IntelisisUfeReenvioAviso } from "@/components/IntelisisUfeReenvioAviso";
import { IntelisisUfeReenvioDialog } from "@/components/IntelisisUfeReenvioDialog";
import { IntelisisUfeReenvioPanel } from "@/components/IntelisisUfeReenvioPanel";
import { IntelisisUfeResolverDialog } from "@/components/IntelisisUfeResolverDialog";
import { IntelisisUfeResultados } from "@/components/IntelisisUfeResultados";
import { IntelisisUfeSinDocumentoDialog } from "@/components/IntelisisUfeSinDocumentoDialog";
import { NumberPanel } from "@/components/SearchPanels";
import { PeriodoPanel } from "@/components/search/PeriodoPanel";
import { ALL_TIPOS_UFE, TypeChips } from "@/components/search/TypeChips";
import { SunatConfirmDialog } from "@/components/SunatConfirmDialog";
import { SunatProgress } from "@/components/SunatProgress";
import { Tabs } from "@/components/Tabs";
import { exportIntelisisUfeExcel } from "../api/excel";
import { toISODate } from "../api/format";
import type {
  IntelisisReenvioFila,
  IntelisisUfeFiltros,
  IntelisisUfeRow,
  SunatDocumentInput,
} from "../api/types";
import { useIntelisisReenvio } from "../hooks/useIntelisisReenvio";
import { useIntelisisUfe } from "../hooks/useIntelisisUfe";
import { useIntelisisUfeSinDocumento } from "../hooks/useIntelisisUfeSinDocumento";
import { useSunat } from "../hooks/useSunat";
import { SUNAT_LOTE_MAX } from "../api/client";

const MAX_DIAS = 31;

/** Los chips usan el vocabulario del dominio; el filtro usa el de Intelisis. */
const TIPO_UFE: Record<string, string> = {
  FACTURA: "FA",
  BOLETA: "BO",
  "NOTA DE CREDITO": "NC",
  "NOTA DE DEBITO": "ND",
};

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
  const reenvio = useIntelisisReenvio(onAuthFailure);
  const [modo, setModo] = useState<"range" | "number">("range");
  const [range, setRange] = useState<DateRange | undefined>(() => {
    // Arranca en hoy, igual que la pantalla de comprobantes.
    const hoy = new Date();
    return { from: hoy, to: hoy };
  });
  /** Periodo y filtros en borrador: todavia no consultados. */
  const [borrador, setBorrador] = useState<IntelisisUfeFiltros>({});
  /** Tipos de documento marcados en el panel (vocabulario del dominio). */
  const [tipos, setTipos] = useState<string[]>([...ALL_TIPOS_UFE]);
  /** Consulta aplicada (null = todavia no se consulto nada). */
  const [consulta, setConsulta] = useState<{
    desde: string;
    hasta: string;
    filtros: IntelisisUfeFiltros;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sunatDialogOpen, setSunatDialogOpen] = useState(false);
  /** Ultimo numero buscado: el refresco tras validar repite esa busqueda. */
  const [documentoBuscado, setDocumentoBuscado] = useState("");
  const [filteredRows, setFilteredRows] = useState<IntelisisUfeRow[] | null>(
    null,
  );
  /** Documentos marcados para reenviar (sobrevive al cambio de página). */
  const [seleccion, setSeleccion] = useState<Set<number>>(
    () => new Set<number>(),
  );
  const [reenvioDialogOpen, setReenvioDialogOpen] = useState(false);
  const [resolviendoFila, setResolviendoFila] =
    useState<IntelisisReenvioFila | null>(null);
  const [sinDocumentoOpen, setSinDocumentoOpen] = useState(false);
  const sinDocumento = useIntelisisUfeSinDocumento({
    open: sinDocumentoOpen,
    desde: ufe.desde,
    hasta: ufe.hasta,
    onAuthFailure,
  });

  // Cambiar de modo arranca una consulta distinta: los filtros de la tabla
  // del modo anterior no deben seguir aplicandose en silencio.
  const modoPrevio = useRef(modo);
  useEffect(() => {
    if (modoPrevio.current === modo) return;
    modoPrevio.current = modo;
    setBorrador({});
  }, [modo]);

  // Una consulta nueva invalida la selección: los ids de otra búsqueda no
  // deben viajar en una solicitud de reenvío.
  useEffect(() => {
    setSeleccion(new Set<number>());
  }, [modo, consulta, documentoBuscado]);

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
      // El tipo de documento es parametro de la consulta, no filtro de la
      // tabla (igual que en la pantalla de comprobantes).
      filtros: {
        ...borrador,
        tipos: tipos.map((tipo) => TIPO_UFE[tipo]).filter(Boolean),
      },
    });
  }, [range, borrador, tipos]);

  const alternar = useCallback(
    (clave: "estatus" | "estado" | "sunat", valor: string) => {
      setBorrador((prev) => {
        const esIgual = String(prev[clave] ?? "") === valor;
        // Los filtros de los cards son excluyentes entre si: el estado que
        // se elige en un eje reemplaza al de los otros dos. Asi el usuario
        // no ve una tabla vacia por dos filtros de ejes distintos activos
        // (mismo comportamiento que el flujo de la pestana Comprobantes).
        const siguiente: IntelisisUfeFiltros = { ...prev };
        delete siguiente.estatus;
        delete siguiente.estado;
        delete siguiente.sunat;
        if (!esIgual) siguiente[clave] = valor;
        return siguiente;
      });
    },
    [],
  );

  const renderFiltro = useMemo(
    () => creaRenderFiltro(borrador, setBorrador, ufe.kpis),
    [borrador, ufe.kpis],
  );

  /**
   * Filas que se muestran: las cargadas, filtradas al instante en el
   * navegador (como en la pantalla de comprobantes). El mismo filtro se
   * envia al servidor al pulsar "Consultar".
   */
  const filas = useMemo(
    () =>
      filtraUfeFilas(
        modo === "range" ? ufe.rows : (ufe.busqueda?.rows ?? []),
        borrador,
      ),
    [modo, ufe.rows, ufe.busqueda, borrador],
  );
  const toggleSeleccion = useCallback((idVenta: number, marcado: boolean) => {
    setSeleccion((prev) => {
      const siguiente = new Set(prev);
      if (marcado) siguiente.add(idVenta);
      else siguiente.delete(idVenta);
      return siguiente;
    });
  }, []);

  const togglePagina = useCallback(
    (pagina: IntelisisUfeRow[], marcado: boolean) => {
      setSeleccion((prev) => {
        const siguiente = new Set(prev);
        for (const fila of pagina) {
          if (marcado) siguiente.add(fila.id_venta);
          else siguiente.delete(fila.id_venta);
        }
        return siguiente;
      });
    },
    [],
  );

  const columns = useMemo(
    () =>
      intelisisUfeColumns({
        seleccionados: seleccion,
        onToggle: toggleSeleccion,
        onTogglePagina: togglePagina,
      }),
    [seleccion, toggleSeleccion, togglePagina],
  );
  const kpis = ufe.kpis;
  const visibles = filteredRows ?? filas;

  /** Filas marcadas que se enviarán al confirmar (solo las visibles). */
  const seleccionadas = useMemo(
    () => filas.filter((fila) => seleccion.has(fila.id_venta)),
    [filas, seleccion],
  );

  // Si un filtro oculta un documento marcado, se desmarca: no se encola algo
  // que el usuario ya no ve en la tabla.
  useEffect(() => {
    setSeleccion((prev) => {
      if (!prev.size) return prev;
      const vigentes = new Set(filas.map((fila) => fila.id_venta));
      const siguiente = new Set(
        [...prev].filter((idVenta) => vigentes.has(idVenta)),
      );
      return siguiente.size === prev.size ? prev : siguiente;
    });
  }, [filas]);
  /** El borde expone el tope real; 10 es el default del backend. */
  const maxBatch = reenvio.panel?.max_batch ?? 10;
  const reenvioHabilitado = reenvio.panel?.habilitado === true;

  /**
   * Documentos que se validaran en SUNAT: manda la seleccion cuando existe
   * (permite acotar un periodo grande); sin seleccion, todos los mostrados.
   */
  const documentosSunat = seleccionadas.length ? seleccionadas : filas;
  /** Documentos consultables en SUNAT (el backend arma el payload final). */
  const consultables: SunatDocumentInput[] = useMemo(
    () =>
      documentosSunat
        .filter((fila) => fila.tipo_sunat && fila.comprobante)
        .map((fila) => ({
          tipo: fila.tipo_sunat,
          number: fila.comprobante,
          date: fila.fecha_emision,
          crossTotal: fila.total,
          sunat: { estado: fila.estado_sunat },
        })),
    [documentosSunat],
  );

  const refrescar = useCallback(async () => {
    if (modo === "range") {
      if (consulta) setConsulta({ ...consulta });
      return;
    }
    // En modo numero la tabla sale de la busqueda: repetirla es lo unico
    // que trae el estado SUNAT nuevo (antes el lote no se veia refrescado).
    if (documentoBuscado) await ufe.buscar(documentoBuscado);
  }, [modo, consulta, documentoBuscado, ufe.buscar]);

  const hayConsulta =
    modo === "range" ? Boolean(consulta) : Boolean(ufe.busqueda);

  /** El servidor rechaza el lote entero por encima de este tope. */
  const loteExcedido = consultables.length > SUNAT_LOTE_MAX;

  /** Filtros de la tabla activos (los que se aplican al instante). */
  const filtrosActivos = useMemo(
    () =>
      Object.values(borrador).filter(
        (valor) => String(valor ?? "").trim() !== "",
      ).length,
    [borrador],
  );

  // Estable: las columnas de la cola se memoizan con este callback.
  const { limpiarErrorResolucion } = reenvio;
  const abrirRevision = useCallback(
    (fila: IntelisisReenvioFila) => {
      limpiarErrorResolucion();
      setResolviendoFila(fila);
    },
    [limpiarErrorResolucion],
  );

  return (
    <div className="flex flex-col gap-6">
      <Tabs mode={modo} onChange={setModo} />

      {modo === "range" ? (
        <PeriodoPanel
          range={range}
          onRange={setRange}
          onConsultar={consultarPeriodo}
          loading={ufe.loading}
          extra={
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Tipo de documento</span>
              <TypeChips
                values={tipos}
                onChange={setTipos}
                tipos={ALL_TIPOS_UFE}
              />
            </div>
          }
        />
      ) : (
        <NumberPanel
          disabled={ufe.loading}
          label="Numero de comprobante"
          placeholder="Ej. B710-00004539"
          hint="Busca el comprobante por su numero oficial (prefijo de tipo, serie y correlativo), sin periodo."
          onSearch={(documento) => {
            setFormError(null);
            setDocumentoBuscado(documento);
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

      {modo === "range" && kpis ? (
        <IntelisisUfeFlujo
          kpis={kpis}
          filtros={borrador}
          onAlternar={alternar}
          onLimpiar={() => setBorrador({})}
          onSinDocumento={() => setSinDocumentoOpen(true)}
          loading={ufe.loading}
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

      {modo === "range" && kpis?.por_dia?.length ? (
        <IntelisisUfeCobertura dias={kpis.por_dia} />
      ) : null}

      <IntelisisUfeResultados
        filas={filas}
        columns={columns}
        renderFiltro={renderFiltro}
        loading={ufe.loading}
        hayConsulta={hayConsulta}
        modo={modo}
        periodo={{ desde: ufe.desde, hasta: ufe.hasta }}
        visibles={visibles.length}
        incidencias={modo === "range" ? (kpis?.por_incidencia ?? []) : []}
        seleccionados={seleccionadas.length}
        filtros={{
          activos: filtrosActivos,
          onLimpiar: () => setBorrador({}),
        }}
        reenvio={{
          habilitado: reenvioHabilitado,
          total: seleccionadas.length,
          onReenviar: () => {
            reenvio.limpiarMensajes();
            setReenvioDialogOpen(true);
          },
        }}
        sunat={{
          total: consultables.length,
          excedido: loteExcedido,
          busy: sunat.busy,
          limite: SUNAT_LOTE_MAX,
          onValidar: () => setSunatDialogOpen(true),
        }}
        exportar={{
          total: visibles.length,
          truncado: ufe.truncado,
          onExportar: () => {
            void exportIntelisisUfeExcel(visibles, {
              truncado: ufe.truncado,
              filtradosTotal: ufe.filtradosTotal,
            });
          },
        }}
        onRowClick={(row) => void ufe.abrirDetalle(row.id_venta)}
        onFilteredRowsChange={setFilteredRows}
      />

      <IntelisisUfeReenvioAviso
        resultado={reenvio.resultado}
        aviso={reenvio.aviso}
        onCerrar={reenvio.limpiarMensajes}
      />

      <IntelisisUfeReenvioPanel
        panel={reenvio.panel}
        loading={reenvio.panelLoading}
        error={reenvio.panelError}
        resolviendo={reenvio.resolviendo}
        onRecargar={reenvio.recargar}
        onResolver={abrirRevision}
      />

      <IntelisisUfeReenvioDialog
        open={reenvioDialogOpen}
        onOpenChange={setReenvioDialogOpen}
        rows={seleccionadas}
        maxBatch={maxBatch}
        enviando={reenvio.enviando}
        error={reenvio.errorEnvio}
        onConfirm={(motivo, token, forzar) => {
          void reenvio
            .reenviar(
              seleccionadas.map((fila) => fila.id_venta),
              motivo,
              token,
              forzar,
            )
            .then((ok) => {
              if (!ok) return;
              setSeleccion(new Set<number>());
              setReenvioDialogOpen(false);
            });
        }}
      />

      <IntelisisUfeResolverDialog
        fila={resolviendoFila}
        enviando={reenvio.resolviendo !== null}
        error={reenvio.errorResolucion}
        onOpenChange={(open) => {
          if (!open) setResolviendoFila(null);
        }}
        onConfirm={(nota) => {
          if (!resolviendoFila) return;
          void reenvio.resolver(resolviendoFila.ID, nota).then((ok) => {
            if (ok) setResolviendoFila(null);
          });
        }}
      />

      <IntelisisUfeSinDocumentoDialog
        open={sinDocumentoOpen}
        onOpenChange={setSinDocumentoOpen}
        desde={ufe.desde}
        hasta={ufe.hasta}
        rows={sinDocumento.rows}
        loading={sinDocumento.loading}
        error={sinDocumento.error}
        truncado={sinDocumento.truncado}
        maxFilas={sinDocumento.maxFilas}
        onReintentar={() => void sinDocumento.recargar()}
      />

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


