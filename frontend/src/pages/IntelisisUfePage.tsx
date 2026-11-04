import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DateRange } from "react-day-picker";
import {
  intelisisUfeColumns,
  puedeReenviar,
} from "@/components/IntelisisUfeColumns";
import { IntelisisUfeDetalle } from "@/components/IntelisisUfeDetalle";
import {
  creaRenderFiltro,
  filtraUfeFilas,
} from "@/components/IntelisisUfeFiltros";
import { IntelisisUfeFlujo } from "@/components/IntelisisUfeFlujo";
import { reenvioAviso } from "@/components/IntelisisUfeReenvioAviso";
import { IntelisisUfeReenvioDialog } from "@/components/IntelisisUfeReenvioDialog";
import { IntelisisUfeReenvioPanel } from "@/components/IntelisisUfeReenvioPanel";
import { IntelisisUfeResolverDialog } from "@/components/IntelisisUfeResolverDialog";
import { IntelisisUfeResultados } from "@/components/IntelisisUfeResultados";
import { IntelisisUfeSinDocumentoDialog } from "@/components/IntelisisUfeSinDocumentoDialog";
import {
  NotificationHost,
  type NotificationItem,
} from "@/components/NotificationCenter";
import { NumberPanel } from "@/components/SearchPanels";
import { PeriodoPanel } from "@/components/search/PeriodoPanel";
import { ALL_TIPOS_UFE, TypeChips } from "@/components/search/TypeChips";
import { SunatConfirmDialog } from "@/components/SunatConfirmDialog";
import { Tabs } from "@/components/Tabs";
import { exportIntelisisUfeExcel } from "../api/excel";
import { toISODate } from "../api/format";
import type {
  IntelisisReenvioEstado,
  IntelisisReenvioFila,
  IntelisisUfeFiltros,
  IntelisisUfeRow,
  SunatSelectable,
} from "../api/types";
import { useIntelisisReenvio } from "../hooks/useIntelisisReenvio";
import { useIntelisisUfe } from "../hooks/useIntelisisUfe";
import { useIntelisisUfeSinDocumento } from "../hooks/useIntelisisUfeSinDocumento";
import { useOperations } from "../operations/OperationsContext";
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
  const { sunat, active: operacionActiva } = useOperations();
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
  /** Objetivo puntual del diálogo de reenvío (p. ej. desde el drawer). */
  const [reenvioTarget, setReenvioTarget] = useState<IntelisisUfeRow[] | null>(
    null,
  );
  const [resolviendoFila, setResolviendoFila] =
    useState<IntelisisReenvioFila | null>(null);
  /** Ultimo lote de reenvio que salio de la cola (dispara el aviso). */
  const [colaFinalizada, setColaFinalizada] = useState<number | null>(null);
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
    if (!tipos.length) {
      setFormError("Selecciona al menos un tipo de documento.");
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
    (clave: "estatus" | "estado" | "derivado" | "sunat", valor: string) => {
      setBorrador((prev) => {
        const esIgual = String(prev[clave] ?? "") === valor;
        // Los filtros de los cards son excluyentes entre si: el estado que
        // se elige en un eje reemplaza al de los otros dos. Asi el usuario
        // no ve una tabla vacia por dos filtros de ejes distintos activos
        // (mismo comportamiento que el flujo de la pestana Comprobantes).
        const siguiente: IntelisisUfeFiltros = { ...prev };
        delete siguiente.estatus;
        delete siguiente.estado;
        delete siguiente.derivado;
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

  /** Estado activo en la cola del ERP por `id_venta`, para pintar en la grilla. */
  const reenviosActivos = useMemo(() => {
    const mapa = new Map<number, IntelisisReenvioEstado>();
    for (const fila of reenvio.panel?.activos ?? []) {
      mapa.set(fila.IDVenta, fila.Estado);
    }
    return mapa;
  }, [reenvio.panel?.activos]);

  const columns = useMemo(
    () =>
      intelisisUfeColumns({
        seleccionados: seleccion,
        onToggle: toggleSeleccion,
        onTogglePagina: togglePagina,
        reenviosActivos,
      }),
    [seleccion, toggleSeleccion, togglePagina, reenviosActivos],
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
   * Atajo de reenvío sin checks: cuando el usuario ya acotó la vista (por
   * búsqueda por número, filtro de tabla o KPI) y quedan entre 1 y `maxBatch`
   * comprobantes elegibles que aún no están generados, se pueden encolar
   * directo sin obligar a marcar cada casilla.
   */
  const elegiblesDirectos = useMemo(() => {
    if (seleccionadas.length > 0) return [];
    const hayAcotacion =
      modo === "number" ||
      Object.values(borrador).some(
        (valor) => String(valor ?? "").trim() !== "",
      );
    if (!hayAcotacion) return [];
    const pendientes = visibles.filter(
      (fila) => puedeReenviar(fila) && fila.estado_generacion !== "generado",
    );
    return pendientes.length > 0 && pendientes.length <= maxBatch
      ? pendientes
      : [];
  }, [seleccionadas.length, modo, borrador, visibles, maxBatch]);

  const filasParaReenvio =
    reenvioTarget ??
    (seleccionadas.length > 0 ? seleccionadas : elegiblesDirectos);

  /**
   * Documentos que se validaran en SUNAT: manda la seleccion cuando existe
   * (permite acotar un periodo grande); sin seleccion, todos los mostrados.
   */
  const documentosSunat = seleccionadas.length ? seleccionadas : visibles;
  const filasExportar = seleccionadas.length > 0 ? seleccionadas : visibles;
  /** Documentos consultables en SUNAT (el backend arma el payload final). */
  const consultables: SunatSelectable[] = useMemo(
    () =>
      documentosSunat
        .filter((fila) => fila.tipo_sunat && fila.comprobante)
        .map((fila) => ({
          tipo: fila.tipo_sunat,
          number: fila.comprobante,
          date: fila.fecha_emision,
          crossTotal: fila.total,
          importe_sunat: fila.importe_sunat,
          sunat: { estado: fila.estado_sunat },
        })),
    [documentosSunat],
  );

  const refrescar = useCallback(async () => {
    // Si el drawer está abierto, releer también el comprobante para que los
    // intentos y el estado del generador no queden desactualizados.
    const idAbierto = ufe.detalle?.id_venta ?? null;
    if (modo === "range") {
      if (consulta) setConsulta({ ...consulta });
    } else if (documentoBuscado) {
      // En modo numero la tabla sale de la busqueda: repetirla es lo unico
      // que trae el estado SUNAT o del generador nuevo.
      await ufe.buscar(documentoBuscado);
    }
    if (idAbierto !== null) {
      await ufe.abrirDetalle(idAbierto);
    }
  }, [
    modo,
    consulta,
    documentoBuscado,
    ufe.buscar,
    ufe.detalle?.id_venta,
    ufe.abrirDetalle,
  ]);

  const hayConsulta =
    modo === "range" ? Boolean(consulta) : Boolean(ufe.busqueda);

  /**
   * Cuando la cola cierra el lote reenviado, la grilla tiene que releer el
   * estado del generador: la bitacora ya trae el intento nuevo (OK REGISTRADO,
   * intentos +1), pero `rows` se quedo con la foto anterior.
   *
   * Se guarda `refrescar` en una ref para que el efecto dependa solo del
   * contador: `refrescar` cambia de identidad al relanzar la consulta y
   * usarlo como dependencia dispararia un bucle de refrescos.
   */
  const refrescarRef = useRef(refrescar);
  useEffect(() => {
    refrescarRef.current = refrescar;
  }, [refrescar]);

  const hayConsultaRef = useRef(hayConsulta);
  useEffect(() => {
    hayConsultaRef.current = hayConsulta;
  }, [hayConsulta]);

  const finalizacionesCola = reenvio.finalizaciones ?? 0;
  useEffect(() => {
    if (!finalizacionesCola) return;
    void refrescarRef.current();
    // Sin una consulta previa no hay tabla que actualizar: el aviso sobraria.
    if (hayConsultaRef.current) setColaFinalizada(finalizacionesCola);
  }, [finalizacionesCola]);

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

  const notificationItems = useMemo<NotificationItem[]>(() => {
    const list: NotificationItem[] = [];

    if (formError) {
      list.push({
        id: "ufe-form-error",
        signature: `form:${formError}`,
        tone: "error",
        onDismiss: () => setFormError(null),
        title: "Revisa los filtros",
        description: formError,
      });
    }

    if (ufe.error) {
      list.push({
        id: "ufe-query-error",
        signature: `query:${ufe.error}`,
        tone: "error",
        title: "No fue posible consultar",
        description: ufe.error,
      });
    }

    if (ufe.detalleError) {
      list.push({
        id: "ufe-detalle-error",
        signature: `detalle-error:${ufe.detalleError}`,
        tone: "error",
        onDismiss: ufe.cerrarDetalle,
        title: "No fue posible consultar la trazabilidad",
        description: ufe.detalleError,
      });
    }

    if (reenvio.panelError) {
      // Sin panel no se sabe si el reenvío está habilitado: el botón queda
      // oculto, así que el aviso se queda hasta que el usuario lo cierre.
      list.push({
        id: "ufe-reenvio-panel-error",
        signature: `reenvio-panel:${reenvio.panelError}`,
        tone: "error",
        persistent: reenvio.panel === null,
        title: "No fue posible leer la cola",
        description:
          reenvio.panel === null
            ? `${reenvio.panelError} El reenvío no estará disponible hasta que la cola responda.`
            : reenvio.panelError,
        action: { label: "Reintentar", onClick: reenvio.recargar },
      });
    }

    if (ufe.searched && !ufe.intelisisEnabled) {
      list.push({
        id: "ufe-disabled",
        signature: "ufe-disabled",
        tone: "info",
        title: "Intelisis no disponible",
        description:
          "No hay conexion configurada a la base de Intelisis. La pantalla queda sin datos hasta que se configure la lectura.",
      });
    }

    if (ufe.truncado) {
      list.push({
        id: "ufe-truncado",
        signature: `truncado:${ufe.maxFilas}:${ufe.filtradosTotal}`,
        tone: "warning",
        title: "Listado recortado",
        description: `Se muestran ${ufe.maxFilas.toLocaleString("es-PE")} de ${ufe.filtradosTotal.toLocaleString("es-PE")} documentos que pasan el filtro. Afina el periodo o usa los filtros (resultado, generador, tipo) para ver el resto.`,
      });
    }

    if (loteExcedido) {
      const limite = SUNAT_LOTE_MAX.toLocaleString("es-PE");
      list.push({
        id: "ufe-sunat-lote-excedido",
        signature: `lote-excedido:${consultables.length}:${SUNAT_LOTE_MAX}`,
        tone: "warning",
        title: "Lote SUNAT excedido",
        description: `La validación SUNAT admite ${limite} documentos por solicitud y hay ${consultables.length.toLocaleString("es-PE")}: selecciona hasta ${limite} en la tabla o filtra (resultado, generador o tipo) para dejar menos.`,
      });
    }

    if (ufe.aviso || ufe.errorValidacion) {
      const detalleTone: NotificationItem["tone"] = ufe.errorValidacion
        ? "error"
        : "info";
      const detalleMsg = ufe.errorValidacion || ufe.aviso || "";
      list.push({
        id: "ufe-detalle-sunat",
        signature: `detalle-sunat:${ufe.aviso ?? ""}:${ufe.errorValidacion ?? ""}`,
        tone: detalleTone,
        title: ufe.errorValidacion
          ? "No se pudo validar en SUNAT"
          : "Validación SUNAT",
        description: detalleMsg,
      });
    }

    if (reenvio.resultado || reenvio.aviso) {
      const rechazados = reenvio.resultado?.rechazados ?? 0;
      list.push({
        id: "ufe-reenvio",
        signature: [
          reenvio.resultado?.encolados ?? 0,
          reenvio.resultado?.duplicados ?? 0,
          reenvio.resultado?.rechazados ?? 0,
          reenvio.aviso ?? "",
        ].join("|"),
        tone: rechazados > 0 ? "warning" : "success",
        onDismiss: reenvio.limpiarMensajes,
        ...reenvioAviso(reenvio.resultado, reenvio.aviso),
      });
    }

    if (colaFinalizada !== null) {
      const sinConfirmar = reenvio.finalizadoSinConfirmar === true;
      const tone: NotificationItem["tone"] = sinConfirmar ? "warning" : "info";
      list.push({
        id: "ufe-cola-finalizada",
        signature: `cola:${colaFinalizada}:${sinConfirmar ? 1 : 0}`,
        tone,
        onDismiss: () => setColaFinalizada(null),
        title: sinConfirmar
          ? "Reenvío detenido para revisión"
          : "Lote de reenvío finalizado",
        description: sinConfirmar
          ? "Uno o más documentos quedaron sin confirmar en la cola del ERP. Se actualizó la tabla; revisa la sección En curso para cerrarlos manualmente."
          : "La cola del ERP terminó el lote: la tabla de resultados se actualizó con el estado del generador.",
      });
    }

    return list;
  }, [
    formError,
    ufe.error,
    ufe.detalleError,
    ufe.cerrarDetalle,
    ufe.searched,
    ufe.intelisisEnabled,
    ufe.truncado,
    ufe.maxFilas,
    ufe.filtradosTotal,
    ufe.aviso,
    ufe.errorValidacion,
    loteExcedido,
    consultables.length,
    reenvio.panelError,
    reenvio.panel,
    reenvio.recargar,
    reenvio.resultado,
    reenvio.aviso,
    reenvio.limpiarMensajes,
    reenvio.finalizadoSinConfirmar,
    colaFinalizada,
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Tabs mode={modo} onChange={setModo} />

      {modo === "range" ? (
        <PeriodoPanel
          range={range}
          onRange={(nextRange) => {
            setFormError(null);
            setRange(nextRange);
          }}
          onConsultar={consultarPeriodo}
          loading={ufe.loading}
          extra={
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Tipo de documento</span>
              <TypeChips
                values={tipos}
                onChange={(nextTipos) => {
                  setFormError(null);
                  setTipos(nextTipos);
                }}
                tipos={ALL_TIPOS_UFE}
              />
            </div>
          }
        />
      ) : (
        <NumberPanel
          loading={ufe.loading}
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
          total:
            seleccionadas.length > 0
              ? seleccionadas.length
              : elegiblesDirectos.length,
          onReenviar: () => {
            setReenvioTarget(null);
            reenvio.limpiarMensajes();
            setReenvioDialogOpen(true);
          },
        }}
        sunat={{
          total: consultables.length,
          excedido: loteExcedido,
          busy: sunat.busy,
          disabled: operacionActiva,
          limite: SUNAT_LOTE_MAX,
          onValidar: () => {
            if (operacionActiva) return;
            setSunatDialogOpen(true);
          },
        }}
        exportar={{
          total: filasExportar.length,
          truncado: seleccionadas.length === 0 && ufe.truncado,
          onExportar: () => {
            void exportIntelisisUfeExcel(filasExportar, {
              truncado: seleccionadas.length === 0 && ufe.truncado,
              filtradosTotal:
                seleccionadas.length > 0
                  ? seleccionadas.length
                  : ufe.filtradosTotal,
            });
          },
        }}
        onRowClick={(row) => void ufe.abrirDetalle(row.id_venta)}
        onFilteredRowsChange={setFilteredRows}
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
        onOpenChange={(open) => {
          setReenvioDialogOpen(open);
          if (!open) setReenvioTarget(null);
        }}
        rows={filasParaReenvio}
        maxBatch={maxBatch}
        enviando={reenvio.enviando}
        error={reenvio.errorEnvio}
        onConfirm={(motivo, token, forzar) => {
          void reenvio
            .reenviar(
              filasParaReenvio.map((fila) => fila.id_venta),
              motivo,
              token,
              forzar,
            )
            .then((ok) => {
              if (!ok) return;
              setSeleccion(new Set<number>());
              setReenvioTarget(null);
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
          // Nunca dos operaciones largas a la vez: el host solo puede mostrar
          // un modal de progreso.
          if (operacionActiva) return;
          void sunat.runBatch(consultables, refrescar, scope);
        }}
      />

      <IntelisisUfeDetalle
        open={Boolean(ufe.detalle) || ufe.detalleLoading}
        detalle={ufe.detalle}
        loading={ufe.detalleLoading}
        error={ufe.detalleError}
        validando={ufe.validando}
        reenvioHabilitado={reenvioHabilitado}
        reenviando={reenvio.enviando}
        onValidar={(idVenta) => void ufe.validar(idVenta)}
        onReenviar={(venta) => {
          setReenvioTarget([venta]);
          reenvio.limpiarMensajes();
          setReenvioDialogOpen(true);
        }}
        onClose={ufe.cerrarDetalle}
      />

      <NotificationHost items={notificationItems} />
    </div>
  );
}


