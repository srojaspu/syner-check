import { useCallback, useEffect, useRef, useState } from "react";
import {
  AuthError,
  RequestAbortedError,
  submitSunatLote,
  sunatJobStatus,
} from "../api/client";
import type { SunatJobResponse, Voucher } from "../api/types";

const POLL_MS = 3000;
/** One isolated timeout must not abort a 9-minute batch. */
const MAX_STATUS_FAILURES = 6;
/** Soft budget for the browser; the server worker keeps reconciling after it. */
const MAX_POLL_MS = 45 * 60 * 1000;
const TERMINAL = new Set([
  "COMPLETADO",
  "COMPLETADO_ERROR",
  "CANCELADO",
  "ERROR",
]);

export interface SunatProgressState {
  jobIndex: number;
  jobCount: number;
  estado: string;
  total: number;
  procesados: number;
  exitosos: number;
  errores: number;
  pendientes: number;
  porcentaje: number;
  mensaje: string;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new RequestAbortedError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new RequestAbortedError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function toProgress(
  status: SunatJobResponse,
  jobIndex: number,
  jobCount: number,
): SunatProgressState {
  const total = Math.max(0, Number(status.total) || 0);
  const procesados = Math.max(0, Math.min(total || Infinity, Number(status.procesados) || 0));
  const porcentaje =
    total > 0
      ? clampPercent((procesados / total) * 100)
      : clampPercent(Number(status.porcentaje) || 0);
  return {
    jobIndex,
    jobCount,
    estado: String(status.estado || "").toUpperCase(),
    total,
    procesados,
    exitosos: Math.max(0, Number(status.exitosos) || 0),
    errores: Math.max(0, Number(status.errores) || 0),
    pendientes: Math.max(0, Number(status.pendientes) || 0),
    porcentaje,
    mensaje: status.mensaje || "Consultando SUNAT…",
  };
}

/** SUNAT batch validation: explicit submit + polling, then refresh. */
export function useSunat(onAuthFailure: () => void) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SunatProgressState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const reset = useCallback(() => {
    // Abort a running batch: the user started another search.
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    setProgress(null);
    setNotice(null);
    setWarning(null);
    setError(null);
  }, []);

  const runBatch = useCallback(
    async (rows: Voucher[], refresh: () => void) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const { signal } = controller;

      setBusy(true);
      setProgress(null);
      setNotice(null);
      setWarning(null);
      setError(null);

      try {
        const data = await submitSunatLote(
          rows.map((doc) => ({
            tipo: doc.tipo,
            number: doc.number,
            date: doc.date,
            crossTotal: doc.crossTotal,
          })),
          signal,
        );

        const messages: string[] = [];
        if (data.omitidos.invalidos.length) {
          messages.push(
            `${data.omitidos.invalidos.length} documento(s) no se pudieron enviar.`,
          );
        }
        if (data.omitidos.en_proceso > 0) {
          messages.push(
            `${data.omitidos.en_proceso} documento(s) ya estaban en proceso en SUNAT.`,
          );
        }
        if (data.errores.length) {
          messages.push(data.errores.map((item) => item.mensaje).join(" "));
        }

        if (!data.trabajos.length) {
          setNotice(
            messages.join(" ") ||
              (data.omitidos.cache_terminal > 0
                ? `Todo ya validado (${data.omitidos.cache_terminal} en caché).`
                : "Nada para enviar."),
          );
          refresh();
          return;
        }
        if (messages.length) setNotice(messages.join(" "));

        let pollingPaused = false;
        for (let i = 0; i < data.trabajos.length && !pollingPaused; i += 1) {
          const job = data.trabajos[i];
          const startedAt = Date.now();
          let failures = 0;

          while (!pollingPaused) {
            if (signal.aborted) throw new RequestAbortedError();
            let status: SunatJobResponse;
            try {
              status = await sunatJobStatus(job.trabajo_id, signal);
              failures = 0;
            } catch (err: unknown) {
              if (err instanceof RequestAbortedError) throw err;
              if (err instanceof AuthError) throw err;
              failures += 1;
              if (failures >= MAX_STATUS_FAILURES) {
                setWarning(
                  "No se pudo confirmar el avance. El servidor seguirá " +
                    "reconciliando el lote; vuelve a consultar en unos minutos.",
                );
                pollingPaused = true;
                break;
              }
              // Back off progressively, then retry the same job.
              await sleep(POLL_MS * Math.min(failures, 4), signal);
              continue;
            }

            setProgress(toProgress(status, i + 1, data.trabajos.length));
            if (TERMINAL.has(String(status.estado || "").toUpperCase())) break;
            if (Date.now() - startedAt > MAX_POLL_MS) {
              setWarning(
                "El lote sigue en SUNAT. El servidor continuará " +
                  "reconciliándolo aunque cierres esta página.",
              );
              pollingPaused = true;
              break;
            }
            await sleep(POLL_MS, signal);
          }
        }

        refresh();
      } catch (err: unknown) {
        if (err instanceof RequestAbortedError) return;
        if (err instanceof AuthError) {
          onAuthFailure();
          return;
        }
        setError(err instanceof Error ? err.message : "Error SUNAT");
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setBusy(false);
        }
      }
    },
    [onAuthFailure],
  );

  return { busy, progress, notice, warning, error, runBatch, reset };
}
