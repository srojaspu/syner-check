import { useCallback, useEffect, useRef, useState } from "react";
import {
  AuthError,
  RequestAbortedError,
  buscarIntelisisUfe,
  getIntelisisUfe,
  getIntelisisUfeDetalle,
  validarIntelisisUfe,
} from "../api/client";
import type {
  IntelisisUfeDetalle,
  IntelisisUfeFiltros,
  IntelisisUfeKpis,
  IntelisisUfeRow,
} from "../api/types";

interface UfeState {
  rows: IntelisisUfeRow[];
  kpis: IntelisisUfeKpis | null;
  loading: boolean;
  error: string | null;
  searched: boolean;
  intelisisEnabled: boolean;
  desde: string;
  hasta: string;
  /** El listado se recorto por el tope de filas del servidor. */
  truncado: boolean;
  maxFilas: number;
  /** Filas que pasan el filtro, antes del recorte. */
  filtradosTotal: number;
}

const EMPTY: UfeState = {
  rows: [],
  kpis: null,
  loading: false,
  error: null,
  searched: false,
  intelisisEnabled: false,
  desde: "",
  hasta: "",
  truncado: false,
  maxFilas: 0,
  filtradosTotal: 0,
};

interface DetalleState {
  detalle: IntelisisUfeDetalle | null;
  /** Carga de la trazabilidad (distinta de la carga del listado). */
  detalleLoading: boolean;
  /** Error de la trazabilidad (distinto del error del listado). */
  detalleError: string | null;
  /** Resultado de la busqueda por numero de comprobante. */
  busqueda: { documento: string; rows: IntelisisUfeRow[] } | null;
  /** Documento que se esta validando en SUNAT (id). */
  validando: number | null;
  /** Ultimo resultado de la validacion, para el aviso en pantalla. */
  aviso: string | null;
  errorValidacion: string | null;
}

const EMPTY_DETALLE: DetalleState = {
  detalle: null,
  detalleLoading: false,
  detalleError: null,
  busqueda: null,
  validando: null,
  aviso: null,
  errorValidacion: null,
};

/**
 * Container de la pantalla Intelisis UFE: fetching + estado.
 * La presentacion vive en los componentes.
 */
export function useIntelisisUfe(onAuthFailure: () => void) {
  const [state, setState] = useState<UfeState>(EMPTY);
  const [detalleState, setDetalleState] = useState<DetalleState>(
    EMPTY_DETALLE,
  );
  const abortRef = useRef<AbortController | null>(null);
  const seq = useRef(0);
  /** Carrera propia del drawer: una ficha nueva no cancela una busqueda. */
  const detalleSeq = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);

  const begin = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    seq.current += 1;
    return { signal: controller.signal, id: seq.current };
  }, []);

  const isCurrent = useCallback((id: number) => id === seq.current, []);

  const run = useCallback(
    async (
      desde: string,
      hasta: string,
      filtros: IntelisisUfeFiltros = {},
    ) => {
      const { signal, id } = begin();
      setState((prev) => ({
        ...prev,
        loading: true,
        error: null,
        desde,
        hasta,
      }));
      try {
        const data = await getIntelisisUfe({ desde, hasta, ...filtros }, signal);
        if (!isCurrent(id)) return;
        setState({
          rows: data.rows ?? [],
          kpis: data.kpis ?? null,
          loading: false,
          error: null,
          searched: true,
          intelisisEnabled: Boolean(data.intelisis_enabled),
          desde: data.desde ?? desde,
          hasta: data.hasta ?? hasta,
          truncado: Boolean(data.truncado),
          maxFilas: Number(data.max_filas ?? 0),
          filtradosTotal: Number(data.filtrados_total ?? data.rows?.length ?? 0),
        });
      } catch (error: unknown) {
        if (error instanceof RequestAbortedError || !isCurrent(id)) return;
        if (error instanceof AuthError) {
          onAuthFailure();
          return;
        }
        setState((prev) => ({
          ...prev,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "No fue posible consultar los comprobantes.",
        }));
      }
    },
    [begin, isCurrent, onAuthFailure],
  );

  /** Busca un comprobante por su numero oficial (sin periodo). */
  const buscar = useCallback(
    async (documento: string) => {
      const { signal, id } = begin();
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await buscarIntelisisUfe(documento, signal);
        if (!isCurrent(id)) return;
        setDetalleState((prev) => ({
          ...prev,
          busqueda: { documento, rows: data.rows ?? [] },
        }));
        setState((prev) => ({
          ...prev,
          // El resumen del periodo no aplica a una busqueda puntual: sin esto
          // los badges de incidencias del ultimo rango quedaban a la vista.
          kpis: null,
          loading: false,
          searched: true,
          intelisisEnabled: Boolean(data.intelisis_enabled),
        }));
      } catch (error: unknown) {
        if (error instanceof RequestAbortedError || !isCurrent(id)) return;
        if (error instanceof AuthError) {
          onAuthFailure();
          return;
        }
        setDetalleState((prev) => ({ ...prev, busqueda: null }));
        setState((prev) => ({
          ...prev,
          kpis: null,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "No fue posible buscar el comprobante.",
        }));
      }
    },
    [begin, isCurrent, onAuthFailure],
  );

  /** Abre el drawer de trazabilidad de un comprobante. */
  const abrirDetalle = useCallback(
    async (idVenta: number) => {
      detalleSeq.current += 1;
      const actual = detalleSeq.current;
      setDetalleState((prev) => ({
        ...prev,
        detalle: null,
        detalleLoading: true,
        detalleError: null,
        aviso: null,
        errorValidacion: null,
      }));
      try {
        const data = await getIntelisisUfeDetalle(idVenta);
        if (actual !== detalleSeq.current) return;
        setDetalleState((prev) => ({
          ...prev,
          detalle: data,
          detalleLoading: false,
          detalleError: null,
        }));
      } catch (error: unknown) {
        if (actual !== detalleSeq.current) return;
        if (error instanceof AuthError) {
          onAuthFailure();
          return;
        }
        setDetalleState((prev) => ({
          ...prev,
          detalleLoading: false,
          detalleError:
            error instanceof Error
              ? error.message
              : "No fue posible consultar la trazabilidad.",
        }));
      }
    },
    [onAuthFailure],
  );

  const cerrarDetalle = useCallback(() => {
    detalleSeq.current += 1;
    setDetalleState((prev) => ({
      ...prev,
      detalle: null,
      detalleLoading: false,
      detalleError: null,
      validando: null,
      errorValidacion: null,
      // `busqueda` se conserva a proposito: en modo numero la tabla sale de
      // ahi, y cerrar el detalle no debe borrar los resultados.
    }));
  }, []);

  /**
   * Consulta individual en SUNAT y refresca el estado del documento.
   *
   * Actualiza la fila en la grilla para que el estado SUNAT se vea sin
   * volver a consultar el periodo entero.
   */
  const validar = useCallback(
    async (idVenta: number) => {
      setDetalleState((prev) => ({
        ...prev,
        validando: idVenta,
        aviso: null,
        errorValidacion: null,
      }));
      try {
        const data = await validarIntelisisUfe(idVenta);
        const actualizada = (row: IntelisisUfeRow): IntelisisUfeRow =>
          row.id_venta === idVenta
            ? {
                ...row,
                estado_sunat: (data.estado ||
                  row.estado_sunat) as IntelisisUfeRow["estado_sunat"],
                sunat: {
                  estado: data.estado || "",
                  consultado: new Date().toISOString(),
                },
              }
            : row;
        setState((prev) => ({
          ...prev,
          rows: prev.rows.map(actualizada),
        }));
        setDetalleState((prev) => ({
          ...prev,
          // En modo numero la tabla se alimenta de la busqueda: sin esto el
          // estado SUNAT recien validado no se veia en la grilla.
          busqueda: prev.busqueda
            ? { ...prev.busqueda, rows: prev.busqueda.rows.map(actualizada) }
            : prev.busqueda,
          validando: null,
          aviso: `SUNAT: ${data.estado || "sin respuesta"}.`,
          detalle: prev.detalle
            ? {
                ...prev.detalle,
                estado_sunat: (data.estado ||
                  prev.detalle.estado_sunat) as IntelisisUfeDetalle["estado_sunat"],
                sunat: {
                  estado: data.estado || "",
                  consultado: new Date().toISOString(),
                },
              }
            : prev.detalle,
        }));
      } catch (error: unknown) {
        if (error instanceof AuthError) {
          onAuthFailure();
          return;
        }
        setDetalleState((prev) => ({
          ...prev,
          validando: null,
          errorValidacion:
            error instanceof Error
              ? error.message
              : "No fue posible validar en SUNAT.",
        }));
      }
    },
    [onAuthFailure],
  );

  return {
    ...state,
    ...detalleState,
    run,
    buscar,
    abrirDetalle,
    cerrarDetalle,
    validar,
  };
}
