import { useCallback, useEffect, useRef, useState } from "react";
import {
  AuthError,
  RequestAbortedError,
  deleteMovSynerPos,
  sendMovSynerPos,
} from "../api/client";
import type {
  MovSynerPosConflictoRegistro,
  MovSynerPosRequestDocumento,
  MovSynerPosResponse,
  Voucher,
} from "../api/types";
import {
  outcomeFromCounts,
  type OperationStatus,
} from "../operations/types";

/** Small batches bound the blast radius of one failed request. */
const BATCH_SIZE = 10;

export interface MovSynerPosProgressState {
  enviados: number;
  total: number;
  insertados: number;
  reparados: number;
  sinCambios: number;
  conflictos: number;
  errores: number;
}

/**
 * Un documento actual bloqueado por uno o más registros ya existentes.
 *
 * El backend devuelve la identidad completa de cada registro en conflicto
 * (`oid` + serie/número) para que la UI muestre exactamente qué se eliminaría.
 */
export interface MovSynerPosConflicto {
  documento: MovSynerPosRequestDocumento;
  existentes: MovSynerPosConflictoRegistro[];
}

const EMPTY_PROGRESS: MovSynerPosProgressState = {
  enviados: 0,
  total: 0,
  insertados: 0,
  reparados: 0,
  sinCambios: 0,
  conflictos: 0,
  errores: 0,
};

function toRequest(row: Voucher): MovSynerPosRequestDocumento {
  return {
    tipo: row.tipo,
    oid: row.oid,
    number: row.number,
    date: row.date,
  };
}

function accumulate(
  state: MovSynerPosProgressState,
  data: MovSynerPosResponse,
  processed: number,
): MovSynerPosProgressState {
  return {
    enviados: state.enviados + processed,
    total: state.total,
    insertados: state.insertados + Math.max(0, Number(data.insertados) || 0),
    reparados: state.reparados + Math.max(0, Number(data.reparados) || 0),
    sinCambios:
      state.sinCambios + Math.max(0, Number(data.sin_cambios) || 0),
    conflictos: state.conflictos + Math.max(0, Number(data.conflictos) || 0),
    errores: state.errores + Math.max(0, Number(data.errores) || 0),
  };
}

/** Human summary; zero counters are noise once the batch ends. */
export function movSynerPosSummary(state: MovSynerPosProgressState): string {
  const parts: string[] = [];
  if (state.insertados > 0) {
    parts.push(
      `${state.insertados} insertado${state.insertados === 1 ? "" : "s"}`,
    );
  }
  if (state.reparados > 0) {
    parts.push(
      `${state.reparados} reparado${state.reparados === 1 ? "" : "s"}`,
    );
  }
  if (state.sinCambios > 0) {
    parts.push(`${state.sinCambios} sin cambios`);
  }
  if (state.conflictos > 0) {
    parts.push(
      `${state.conflictos} con conflicto${state.conflictos === 1 ? "" : "s"}`,
    );
  }
  if (state.errores > 0) {
    parts.push(`${state.errores} con error${state.errores === 1 ? "" : "es"}`);
  }
  if (!parts.length) return "No había documentos para enviar a MovSynerPos.";
  return `MovSynerPos: ${parts.join(" · ")}.`;
}

function failureIdentity(
  data: MovSynerPosResponse,
  sources: MovSynerPosRequestDocumento[],
): MovSynerPosRequestDocumento[] {
  const failed: MovSynerPosRequestDocumento[] = [];
  for (const item of data.detalle ?? []) {
    if (item.estado !== "error" && item.estado !== "conflicto") continue;
    const source = sources.find(
      (doc) => doc.oid === item.oid && String(doc.tipo) === String(item.tipo),
    );
    failed.push(
      source ?? {
        tipo: item.tipo as MovSynerPosRequestDocumento["tipo"],
        oid: item.oid,
        number: item.number,
      },
    );
  }
  return failed;
}

function failureMessages(data: MovSynerPosResponse): string[] {
  const messages: string[] = [];
  for (const item of data.detalle ?? []) {
    if (!item.error) continue;
    const label = item.number || item.oid;
    messages.push(`${label}: ${item.error}`);
  }
  return messages;
}

function documentKey(documento: MovSynerPosRequestDocumento): string {
  return `${String(documento.tipo)}|${documento.oid}`;
}

/** Agrupa los conflictos por documento actual, sin duplicar registros. */
function collectConflicts(
  data: MovSynerPosResponse,
  sources: MovSynerPosRequestDocumento[],
  into: Map<string, MovSynerPosConflicto>,
) {
  for (const item of data.detalle ?? []) {
    if (item.estado !== "conflicto" || !item.conflictos?.length) continue;
    const source =
      sources.find(
        (doc) => doc.oid === item.oid && String(doc.tipo) === String(item.tipo),
      ) ?? {
        tipo: item.tipo as MovSynerPosRequestDocumento["tipo"],
        oid: item.oid,
        number: item.number,
      };
    const key = documentKey(source);
    const group = into.get(key) ?? { documento: source, existentes: [] };
    for (const registro of item.conflictos) {
      const duplicated = group.existentes.some(
        (existente) =>
          existente.oid === registro.oid &&
          existente.number === registro.number,
      );
      if (!duplicated) group.existentes.push(registro);
    }
    into.set(key, group);
  }
}

/**
 * Manual resend to dbo.MovSynerPos.
 *
 * Sends at most 10 documents per request, keeps a live aggregate, refreshes
 * the table when done, and exposes only the failed identities so a retry does
 * not resend documents that already landed.
 */
export function useMovSynerPos(onAuthFailure: () => void) {
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<OperationStatus>("idle");
  const [progress, setProgress] = useState<MovSynerPosProgressState | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<MovSynerPosRequestDocumento[]>([]);
  const [conflicts, setConflicts] = useState<MovSynerPosConflicto[]>([]);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const refreshRef = useRef<(() => Promise<void> | void) | null>(null);
  /** Último refresco conocido: permite reintentar sin volver a cablearlo. */
  const lastRefreshRef = useRef<(() => Promise<void> | void) | null>(null);
  const lastRepararRef = useRef(false);
  /** Copia síncrona del progreso: `cancel` no puede leer estado con deps []. */
  const progressRef = useRef<MovSynerPosProgressState | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    refreshRef.current = null;
    lastRefreshRef.current = null;
    lastRepararRef.current = false;
    progressRef.current = null;
    setBusy(false);
    setRefreshing(false);
    setStatus("idle");
    setProgress(null);
    setNotice(null);
    setWarning(null);
    setError(null);
    setFailed([]);
    setConflicts([]);
    setResolving(false);
    setResolveError(null);
  }, []);

  const dismissProgress = useCallback(() => {
    setProgress(null);
    setStatus("idle");
  }, []);

  const cancel = useCallback(async () => {
    if (!controllerRef.current) return;
    controllerRef.current.abort();
    controllerRef.current = null;
    const refresh = refreshRef.current;
    refreshRef.current = null;
    const current = progressRef.current;
    const procesados = current?.enviados ?? 0;
    const total = current?.total ?? 0;
    progressRef.current = null;
    setBusy(false);
    setStatus("cancelled");
    setProgress(null);
    setNotice(null);
    setError(null);
    setWarning(
      procesados > 0
        ? `Envío a MovSynerPos cancelado por el usuario (${procesados} de ${total} documentos procesados antes de detenerse).`
        : "Envío a MovSynerPos cancelado por el usuario.",
    );
    if (refresh) {
      setRefreshing(true);
      try {
        await refresh();
      } catch {
        // useVouchers owns table errors; never mask the cancellation warning.
      } finally {
        setRefreshing(false);
      }
    }
  }, []);

  const execute = useCallback(
    async (
      documentos: MovSynerPosRequestDocumento[],
      refresh: () => Promise<void> | void,
      reparar: boolean,
    ) => {
      if (!documentos.length) return;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      refreshRef.current = refresh;
      lastRefreshRef.current = refresh;
      lastRepararRef.current = reparar;
      const { signal } = controller;

      setBusy(true);
      setRefreshing(false);
      setStatus("running");
      const initial: MovSynerPosProgressState = {
        ...EMPTY_PROGRESS,
        total: documentos.length,
      };
      progressRef.current = initial;
      setProgress(initial);
      setNotice(null);
      setWarning(null);
      setError(null);
      setFailed([]);
      setConflicts([]);
      setResolveError(null);

      const refreshResults = async () => {
        setBusy(false);
        setRefreshing(true);
        try {
          await refresh();
        } catch {
          // useVouchers owns table errors; never mask the resend outcome.
        } finally {
          setRefreshing(false);
        }
      };

      let aggregate: MovSynerPosProgressState = {
        ...EMPTY_PROGRESS,
        total: documentos.length,
      };
      const failedDocuments: MovSynerPosRequestDocumento[] = [];
      const messages: string[] = [];
      const conflictsByDocument = new Map<string, MovSynerPosConflicto>();

      /** Resultado terminal; se publica en el `finally` del dueño actual. */
      let outcome: OperationStatus = "completed";

      try {
        for (let index = 0; index < documentos.length; index += BATCH_SIZE) {
          if (signal.aborted) throw new RequestAbortedError();
          const chunk = documentos.slice(index, index + BATCH_SIZE);
          const data = await sendMovSynerPos(chunk, reparar, signal);
          aggregate = accumulate(aggregate, data, chunk.length);
          progressRef.current = aggregate;
          setProgress(aggregate);
          failedDocuments.push(...failureIdentity(data, chunk));
          messages.push(...failureMessages(data));
          collectConflicts(data, chunk, conflictsByDocument);
          setConflicts([...conflictsByDocument.values()]);
        }

        setFailed(failedDocuments);
        setNotice(movSynerPosSummary(aggregate));
        if (messages.length) {
          setWarning(messages.slice(0, 3).join(" "));
        }
        await refreshResults();
        outcome = outcomeFromCounts(
          aggregate.errores + aggregate.conflictos,
        );
      } catch (err: unknown) {
        if (err instanceof RequestAbortedError) {
          outcome = "cancelled";
          return;
        }
        if (err instanceof AuthError) {
          outcome = "idle";
          onAuthFailure();
          return;
        }
        // Everything not confirmed is eligible for an explicit retry.
        const done = aggregate.enviados;
        failedDocuments.push(...documentos.slice(done));
        setFailed(failedDocuments);
        setError(err instanceof Error ? err.message : "Error MovSynerPos");
        await refreshResults();
        outcome = "failed";
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          refreshRef.current = null;
          setBusy(false);
          setRefreshing(false);
          setStatus(outcome);
        }
      }
    },
    [onAuthFailure],
  );

  const run = useCallback(
    (
      rows: Voucher[],
      refresh: () => Promise<void> | void,
      reparar = false,
    ) => execute(rows.map(toRequest), refresh, reparar),
    [execute],
  );

  const retry = useCallback(
    (reparar?: boolean) => {
      const refresh = lastRefreshRef.current;
      if (!refresh) return Promise.resolve();
      return execute(failed, refresh, reparar ?? lastRepararRef.current);
    },
    [execute, failed],
  );

  /**
   * Elimina el registro existente de cada conflicto y reenvía el actual.
   *
   * Es secuencial y con un solo motivo para toda la resolución: el borrado es
   * auditable, así que la UI pide confirmación explícita mostrando el número y
   * el oid de lo que se elimina. Si un grupo falla, los resueltos se quitan de
   * la lista y el diálogo conserva solo los pendientes.
   */
  const resolveConflicts = useCallback(
    async (motivo: string) => {
      if (!conflicts.length || resolving) return;
      const motivoLimpio = motivo.trim();
      if (motivoLimpio.length < 5) {
        setResolveError("El motivo debe tener al menos 5 caracteres.");
        return;
      }

      const pending = [...conflicts];
      const resolvedKeys = new Set<string>();
      const errors: string[] = [];
      setResolving(true);
      setResolveError(null);

      try {
        for (const group of pending) {
          const key = documentKey(group.documento);
          const label = group.documento.number || group.documento.oid;
          for (const existente of group.existentes) {
            await deleteMovSynerPos({
              oid: existente.oid,
              tipo: group.documento.tipo,
              number: existente.number,
              motivo: motivoLimpio,
            });
          }

          // A partir de aquí el registro existente ya no existe: reintentar el
          // borrado daría 404, así que el grupo sale de la lista pase lo que
          // pase con el reenvío. Si el reenvío falla queda en `failed` para
          // reintentarlo sin volver a borrar.
          let failure: string | null = null;
          try {
            const data = await sendMovSynerPos([group.documento], true);
            const detalle = data.detalle?.[0];
            if (
              !detalle ||
              detalle.estado === "conflicto" ||
              detalle.estado === "error"
            ) {
              failure = `${label}: ${
                detalle?.error ??
                "no se pudo reenviar el comprobante después de eliminar el registro existente."
              }`;
            }
          } catch (err: unknown) {
            if (err instanceof AuthError) throw err;
            failure = `${label}: ${
              err instanceof Error
                ? err.message
                : "no se pudo reenviar el comprobante después de eliminar el registro existente."
            }`;
          }

          setConflicts((prev) =>
            prev.filter(
              (item) => documentKey(item.documento) !== key,
            ),
          );
          if (failure) {
            errors.push(failure);
            continue;
          }
          resolvedKeys.add(key);
        }

        if (resolvedKeys.size > 0) {
          setFailed((prev) =>
            prev.filter((doc) => !resolvedKeys.has(documentKey(doc))),
          );
          setNotice(
            `Conflictos resueltos: ${resolvedKeys.size} ${
              resolvedKeys.size === 1 ? "comprobante reenviado" : "comprobantes reenviados"
            } a MovSynerPos.`,
          );
          setWarning(null);
          setError(null);
          const refresh = lastRefreshRef.current;
          if (refresh) {
            setRefreshing(true);
            try {
              await refresh();
            } catch {
              // useVouchers owns table errors; never mask the resolution result.
            } finally {
              setRefreshing(false);
            }
          }
        }

        if (errors.length) {
          setResolveError(errors.slice(0, 3).join(" "));
        }
      } catch (err: unknown) {
        if (err instanceof AuthError) {
          onAuthFailure();
          return;
        }
        setResolveError(
          err instanceof Error
            ? err.message
            : "No se pudieron resolver los conflictos.",
        );
      } finally {
        setResolving(false);
      }
    },
    [conflicts, resolving, onAuthFailure],
  );

  return {
    busy,
    refreshing,
    status,
    progress,
    notice,
    warning,
    error,
    failed,
    conflicts,
    resolving,
    resolveError,
    resolveConflicts,
    run,
    retry,
    cancel,
    dismissProgress,
    reset,
  };
}
