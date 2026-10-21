import { useCallback, useEffect, useRef, useState } from "react";
import { AuthError, RequestAbortedError, sendMovSynerPos } from "../api/client";
import type {
  MovSynerPosRequestDocumento,
  MovSynerPosResponse,
  Voucher,
} from "../api/types";

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
  const [progress, setProgress] = useState<MovSynerPosProgressState | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<MovSynerPosRequestDocumento[]>([]);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    setRefreshing(false);
    setProgress(null);
    setNotice(null);
    setWarning(null);
    setError(null);
    setFailed([]);
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
      const { signal } = controller;

      setBusy(true);
      setRefreshing(false);
      setProgress({ ...EMPTY_PROGRESS, total: documentos.length });
      setNotice(null);
      setWarning(null);
      setError(null);
      setFailed([]);

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

      try {
        for (let index = 0; index < documentos.length; index += BATCH_SIZE) {
          if (signal.aborted) throw new RequestAbortedError();
          const chunk = documentos.slice(index, index + BATCH_SIZE);
          const data = await sendMovSynerPos(chunk, reparar, signal);
          aggregate = accumulate(aggregate, data, chunk.length);
          setProgress(aggregate);
          failedDocuments.push(...failureIdentity(data, chunk));
          messages.push(...failureMessages(data));
        }

        setFailed(failedDocuments);
        setNotice(movSynerPosSummary(aggregate));
        if (messages.length) {
          setWarning(messages.slice(0, 3).join(" "));
        }
        await refreshResults();
      } catch (err: unknown) {
        if (err instanceof RequestAbortedError) return;
        if (err instanceof AuthError) {
          onAuthFailure();
          return;
        }
        // Everything not confirmed is eligible for an explicit retry.
        const done = aggregate.enviados;
        failedDocuments.push(...documentos.slice(done));
        setFailed(failedDocuments);
        setError(err instanceof Error ? err.message : "Error MovSynerPos");
        await refreshResults();
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setBusy(false);
          setRefreshing(false);
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
    (refresh: () => Promise<void> | void, reparar = false) =>
      execute(failed, refresh, reparar),
    [execute, failed],
  );

  return {
    busy,
    refreshing,
    progress,
    notice,
    warning,
    error,
    failed,
    run,
    retry,
    reset,
  };
}
