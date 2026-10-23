import { useCallback, useEffect, useRef, useState } from "react";
import {
  AuthError,
  getIntelisisReenvios,
  reenviarIntelisisUfe,
  resolverIntelisisReenvio,
} from "../api/client";
import type {
  IntelisisReenvioCola,
  IntelisisReenvioResultado,
} from "../api/types";

/** Cadencia del panel mientras el worker tiene trabajo. */
export const REENVIO_POLL_MS = 5000;
/** Filas de historial que se piden al panel (2 paginas de 50). */
const HISTORIAL_LIMITE = 100;

interface ReenvioState {
  /** Foto de la cola del ERP (null hasta la primera respuesta). */
  panel: IntelisisReenvioCola | null;
  panelLoading: boolean;
  panelError: string | null;
  /** Filtro de estado del historial ("" = todos). */
  filtro: string;
  /** Encolado en curso. */
  enviando: boolean;
  /** Fila que se está resolviendo a mano. */
  resolviendo: number | null;
  resultado: IntelisisReenvioResultado | null;
  /** Aviso de la última acción (encolado o resolución). */
  aviso: string | null;
  /** Error del último encolado (se muestra en la confirmación). */
  errorEnvio: string | null;
  /** Error de la última resolución manual. */
  errorResolucion: string | null;
}

const EMPTY: ReenvioState = {
  panel: null,
  panelLoading: false,
  panelError: null,
  filtro: "",
  enviando: false,
  resolviendo: null,
  resultado: null,
  aviso: null,
  errorEnvio: null,
  errorResolucion: null,
};

function mensaje(error: unknown, porDefecto: string): string {
  return error instanceof Error && error.message ? error.message : porDefecto;
}

/** Resumen de una línea para el aviso de la pantalla. */
export function resumenReenvio(resultado: IntelisisReenvioResultado): string {
  const partes: string[] = [];
  if (resultado.encolados) {
    partes.push(
      `${resultado.encolados} documento${resultado.encolados === 1 ? "" : "s"} en cola`,
    );
  }
  if (resultado.duplicados) {
    partes.push(
      `${resultado.duplicados} ya registrado${resultado.duplicados === 1 ? "" : "s"}`,
    );
  }
  if (resultado.rechazados) {
    partes.push(`${resultado.rechazados} rechazado${resultado.rechazados === 1 ? "" : "s"}`);
  }
  return partes.length ? `${partes.join(" · ")}.` : "Sin cambios.";
}

/** El panel solo se refresca solo mientras haya algo que mirar. */
export function hayTrabajo(panel: IntelisisReenvioCola | null): boolean {
  if (!panel) return false;
  return (
    panel.ocupado ||
    panel.pendientes > 0 ||
    panel.sin_confirmar > 0 ||
    (panel.activos?.length ?? 0) > 0
  );
}

/**
 * Container del panel de reenvíos y de las dos acciones de escritura
 * (encolar y resolver). La cola es la del ERP: aquí no se genera nada.
 */
export function useIntelisisReenvio(onAuthFailure: () => void) {
  const [state, setState] = useState<ReenvioState>(EMPTY);
  const filtroRef = useRef("");
  const enVuelo = useRef(false);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(
    async (estado = filtroRef.current, forzar = false) => {
      if (enVuelo.current && !forzar) return;
      enVuelo.current = true;
      setState((prev) => ({ ...prev, panelLoading: prev.panel === null }));
      try {
        const panel = await getIntelisisReenvios({
          limit: HISTORIAL_LIMITE,
          estado: estado || undefined,
        });
        if (!montado.current) return;
        setState((prev) => ({
          ...prev,
          panel,
          panelLoading: false,
          panelError: null,
        }));
      } catch (error: unknown) {
        if (!montado.current) return;
        if (error instanceof AuthError) {
          onAuthFailure();
          return;
        }
        setState((prev) => ({
          ...prev,
          panelLoading: false,
          panelError: mensaje(
            error,
            "No fue posible consultar la cola de reenvíos.",
          ),
        }));
      } finally {
        enVuelo.current = false;
      }
    },
    [onAuthFailure],
  );

  // Primera foto al montar: sin ella no se sabe si el reenvío está habilitado.
  useEffect(() => {
    void cargar("", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sondeando = hayTrabajo(state.panel);
  useEffect(() => {
    if (!sondeando) return;
    const timer = setInterval(() => void cargar(), REENVIO_POLL_MS);
    return () => clearInterval(timer);
  }, [sondeando, cargar]);

  const cambiarFiltro = useCallback(
    (estado: string) => {
      filtroRef.current = estado;
      setState((prev) => ({ ...prev, filtro: estado }));
      void cargar(estado, true);
    },
    [cargar],
  );

  const recargar = useCallback(() => {
    void cargar(filtroRef.current, true);
  }, [cargar]);

  const reenviar = useCallback(
    async (
      ids: number[],
      motivo: string,
      token: string,
      forzar = false,
    ): Promise<boolean> => {
      setState((prev) => ({
        ...prev,
        enviando: true,
        errorEnvio: null,
        resultado: null,
        aviso: null,
      }));
      try {
        const resultado = await reenviarIntelisisUfe(ids, motivo, token, {
          forzar,
        });
        if (!montado.current) return true;
        setState((prev) => ({
          ...prev,
          enviando: false,
          resultado,
          aviso: resumenReenvio(resultado),
        }));
        void cargar("", true);
        return true;
      } catch (error: unknown) {
        if (!montado.current) return false;
        if (error instanceof AuthError) {
          onAuthFailure();
          return false;
        }
        setState((prev) => ({
          ...prev,
          enviando: false,
          errorEnvio: mensaje(error, "No fue posible encolar el reenvío."),
        }));
        return false;
      }
    },
    [cargar, onAuthFailure],
  );

  const resolver = useCallback(
    async (queueId: number, nota: string): Promise<boolean> => {
      setState((prev) => ({
        ...prev,
        resolviendo: queueId,
        errorResolucion: null,
      }));
      try {
        const data = await resolverIntelisisReenvio(queueId, nota);
        if (!montado.current) return true;
        setState((prev) => ({
          ...prev,
          resolviendo: null,
          aviso: data.mensaje || "Revisión registrada.",
        }));
        void cargar("", true);
        return true;
      } catch (error: unknown) {
        if (!montado.current) return false;
        if (error instanceof AuthError) {
          onAuthFailure();
          return false;
        }
        setState((prev) => ({
          ...prev,
          resolviendo: null,
          errorResolucion: mensaje(
            error,
            "No fue posible resolver el reenvío.",
          ),
        }));
        return false;
      }
    },
    [cargar, onAuthFailure],
  );

  const limpiarMensajes = useCallback(() => {
    setState((prev) => ({
      ...prev,
      resultado: null,
      aviso: null,
      errorEnvio: null,
      errorResolucion: null,
    }));
  }, []);

  /** Un error de resolucion viejo no debe aparecer al abrir otra fila. */
  const limpiarErrorResolucion = useCallback(() => {
    setState((prev) => ({ ...prev, errorResolucion: null }));
  }, []);

  return {
    ...state,
    cargar,
    recargar,
    cambiarFiltro,
    reenviar,
    resolver,
    limpiarMensajes,
    limpiarErrorResolucion,
  };
}
