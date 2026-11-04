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
/**
 * Tope de sondeos dedicados a un lote encolado: si el worker no lo mueve en
 * ~20 minutos dejamos de seguirlo. El refresco de la tabla se dispara igual:
 * es preferible una relectura de mas que dejar el seguimiento colgado.
 */
export const MAX_SONDEO_LOTE = 240;

interface ReenvioState {
  /** Foto de la cola del ERP (null hasta la primera respuesta). */
  panel: IntelisisReenvioCola | null;
  panelLoading: boolean;
  panelError: string | null;
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
 * ¿El lote reenviado ya salio de la cola?
 *
 * Se sigue por el `ID` de `FE_Reenvio` (no por `LoteID`: la tabla del ERP no
 * se rellena desde nuestra aplicacion). El historial solo devuelve estados
 * finales, asi que ver ahi todos los jobs del lote es la senal mas fuerte.
 */
export function loteTerminado(
  panel: IntelisisReenvioCola,
  seguidos: ReadonlySet<number>,
): boolean {
  if (!seguidos.size) return true;
  const estadosActivos = new Map(
    panel.activos.map((fila) => [fila.ID, fila.Estado]),
  );

  // Mientras algun job siga encolado o ejecutandose, el lote no termino.
  for (const id of seguidos) {
    const estado = estadosActivos.get(id);
    if (estado === "EN_COLA" || estado === "EJECUTANDO") return false;
  }
  // Un NO_CONFIRMADO ya no avanza solo: requiere una persona. Solo cerramos
  // cuando ya no queda ningun job del lote en cola ni ejecutandose.
  for (const id of seguidos) {
    if (estadosActivos.get(id) === "NO_CONFIRMADO") return true;
  }
  const enHistorial = new Set(panel.historial.map((fila) => fila.ID));
  if ([...seguidos].every((id) => enHistorial.has(id))) return true;

  // Respaldo: si la cola quedo sin trabajo, no hay nada mas que esperar.
  return !hayTrabajo(panel);
}

/** Jobs de la cola que hay que seguir despues de encolar la solicitud. */
function idsDelLote(
  resultado: IntelisisReenvioResultado,
): Set<number> {
  const ids = new Set<number>();
  for (const item of resultado.detalle) {
    if (item.queue_id === null || item.estado === "rechazado") continue;
    ids.add(item.queue_id);
  }
  return ids;
}

/** Jobs del panel que quedaron en `NO_CONFIRMADO` y requieren revision manual. */
function idsSinConfirmar(panel: IntelisisReenvioCola): Set<number> {
  const ids = new Set<number>();
  for (const fila of panel.activos) {
    if (fila.Estado === "NO_CONFIRMADO") ids.add(fila.ID);
  }
  return ids;
}

/**
 * Container del panel de reenvíos y de las dos acciones de escritura
 * (encolar y resolver). La cola es la del ERP: aquí no se genera nada.
 */
export function useIntelisisReenvio(onAuthFailure: () => void) {
  const [state, setState] = useState<ReenvioState>(EMPTY);
  /** Cuenta lotes que salieron de la cola: la pagina relee la grilla con el. */
  const [finalizaciones, setFinalizaciones] = useState(0);
  /** El último lote cerrado dejó al menos un job en `NO_CONFIRMADO`. */
  const [finalizadoSinConfirmar, setFinalizadoSinConfirmar] = useState(false);
  /** Hay un lote encolado desde esta sesion al que se le esta haciendo seguimiento. */
  const [siguiendo, setSiguiendo] = useState(false);
  const enVuelo = useRef(false);
  const montado = useRef(true);
  /** `ID` de `FE_Reenvio` de los jobs que hay que seguir (no `LoteID`). */
  const seguimiento = useRef<Set<number> | null>(null);
  const intentosSeguimiento = useRef(0);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const dejarDeSeguir = useCallback(() => {
    seguimiento.current = null;
    intentosSeguimiento.current = 0;
    setSiguiendo(false);
  }, []);

  const terminarSeguimiento = useCallback(
    (sinConfirmar = false) => {
      dejarDeSeguir();
      setFinalizadoSinConfirmar(sinConfirmar);
      setFinalizaciones((prev) => prev + 1);
    },
    [dejarDeSeguir],
  );

  /**
   * Cierra el seguimiento del lote cuando el panel ya lo dejo de mover.
   * Se evalua en cada respuesta del panel (incluido el refresco tras encolar).
   */
  const evaluarSeguimiento = useCallback(
    (panel: IntelisisReenvioCola) => {
      const seguidos = seguimiento.current;
      if (!seguidos?.size) return;
      intentosSeguimiento.current += 1;
      const terminado = loteTerminado(panel, seguidos);
      if (terminado || intentosSeguimiento.current > MAX_SONDEO_LOTE) {
        const sinConfirmar = idsSinConfirmar(panel);
        const quedoSinConfirmar = [...seguidos].some((id) =>
          sinConfirmar.has(id),
        );
        terminarSeguimiento(quedoSinConfirmar);
      }
    },
    [terminarSeguimiento],
  );

  const cargar = useCallback(
    async (forzar = false) => {
      if (enVuelo.current && !forzar) return;
      enVuelo.current = true;
      setState((prev) => ({ ...prev, panelLoading: prev.panel === null }));
      try {
        const panel = await getIntelisisReenvios({
          limit: HISTORIAL_LIMITE,
        });
        if (!montado.current) return;
        evaluarSeguimiento(panel);
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
        // Si la cola no responde, el seguimiento no puede durar para siempre:
        // se abandona en silencio y no se fuerza un refresco inutil.
        if (seguimiento.current?.size) {
          intentosSeguimiento.current += 1;
          if (intentosSeguimiento.current > MAX_SONDEO_LOTE) {
            dejarDeSeguir();
          }
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
    [onAuthFailure, evaluarSeguimiento, dejarDeSeguir],
  );

  // Primera foto al montar: sin ella no se sabe si el reenvío está habilitado.
  useEffect(() => {
    void cargar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Se sondea mientras la cola tenga trabajo o mientras se siga un lote: si el
  // primer panel tras encolar no alcanza a verlo, el intervalo no se pierde.
  const sondeando = hayTrabajo(state.panel) || siguiendo;
  useEffect(() => {
    if (!sondeando) return;
    const timer = setInterval(() => void cargar(), REENVIO_POLL_MS);
    return () => clearInterval(timer);
  }, [sondeando, cargar]);

  const recargar = useCallback(() => {
    void cargar(true);
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
        const seguidos = idsDelLote(resultado);
        if (seguidos.size) {
          seguimiento.current = seguidos;
          intentosSeguimiento.current = 0;
          setSiguiendo(true);
        } else {
          // Nada nuevo entro a la cola: no hay proceso que seguir.
          dejarDeSeguir();
        }
        void cargar(true);
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
    [cargar, dejarDeSeguir, onAuthFailure],
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
        void cargar(true);
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
    /** Lotes que ya salieron de la cola (la pagina relee la grilla con esto). */
    finalizaciones,
    /** El último lote cerrado dejó al menos un job en `NO_CONFIRMADO`. */
    finalizadoSinConfirmar,
    /** Hay un lote de esta sesion al que se le hace seguimiento. */
    siguiendo,
    cargar,
    recargar,
    reenviar,
    resolver,
    limpiarMensajes,
    limpiarErrorResolucion,
  };
}
