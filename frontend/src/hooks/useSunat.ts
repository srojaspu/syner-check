import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  AuthError,
  RequestAbortedError,
  submitSunatLote,
  sunatJobStatus,
  sunatSubmissionStatus,
} from "../api/client";
import type {
  SunatJobResponse,
  SunatScope,
  SunatSubmissionResponse,
  Voucher,
} from "../api/types";

const POLL_MS = 3000;
/** Submission progress is cheap; poll it faster than a SUNAT job. */
const SUBMISSION_POLL_MS = 1500;
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
  phase: "submission" | "job";
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
  alcance: SunatScope;
  enviados: number;
  porEnviar: number;
  aceptados: number;
  enProceso: number;
  sinConfirmar: number;
  invalidos: number;
  chunksDone: number;
  chunksTotal: number;
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

function submissionToProgress(
  status: SunatSubmissionResponse,
): SunatProgressState {
  const total = Math.max(0, Number(status.total) || 0);
  // ``enviados``/``por_enviar`` are the authoritative submission counters.
  // Jobs are a defensive fallback for older snapshots that reported zero
  // even after registering chunks; without it the card said "Sin envíos
  // nuevos" next to "2 de 2 lotes".
  const jobsDocs = (status.trabajos ?? []).reduce(
    (sum, job) => sum + Math.max(0, Number(job.cantidad) || 0),
    0,
  );
  const enviados = Math.max(0, Number(status.enviados) || 0, jobsDocs);
  const porEnviar = Math.max(
    0,
    Number(status.por_enviar) || 0,
    jobsDocs,
  );
  return {
    phase: "submission",
    jobIndex: 0,
    jobCount: 0,
    estado: String(status.estado || "").toUpperCase(),
    total,
    procesados: enviados,
    exitosos: 0,
    errores: Array.isArray(status.errores) ? status.errores.length : 0,
    pendientes: Math.max(0, porEnviar - enviados),
    porcentaje: clampPercent(Number(status.porcentaje) || 0),
    mensaje: status.mensaje || "Enviando lotes a SUNAT…",
    alcance: status.alcance === "todos" ? "todos" : "no_aceptados",
    enviados,
    porEnviar,
    aceptados: Math.max(0, Number(status.omitidos?.aceptados) || 0),
    enProceso: Math.max(0, Number(status.omitidos?.en_proceso) || 0),
    sinConfirmar: Math.max(0, Number(status.omitidos?.sin_confirmar) || 0),
    invalidos: Array.isArray(status.omitidos?.invalidos)
      ? status.omitidos.invalidos.length
      : 0,
    chunksDone: Math.max(0, Number(status.chunks_done) || 0),
    chunksTotal: Math.max(0, Number(status.chunks_total) || 0),
  };
}

interface JobAggregate {
  /** Documents across every registered job, not only the current one. */
  total: number;
  processed: number;
  ok: number;
  errors: number;
}

function queuedJobProgress(
  firstJob: SunatSubmissionResponse["trabajos"][number],
  jobCount: number,
  alcance: SunatScope,
  totalDocs: number,
): SunatProgressState {
  const total = totalDocs || Math.max(0, Number(firstJob?.cantidad) || 0);
  return {
    phase: "job",
    jobIndex: 1,
    jobCount,
    estado: "EN_COLA",
    total,
    procesados: 0,
    exitosos: 0,
    errores: 0,
    pendientes: total,
    porcentaje: 0,
    mensaje: "Lotes enviados. Consultando SUNAT…",
    alcance,
    enviados: 0,
    porEnviar: total,
    aceptados: 0,
    enProceso: 0,
    sinConfirmar: 0,
    invalidos: 0,
    chunksDone: 0,
    chunksTotal: jobCount,
  };
}

function toProgress(
  status: SunatJobResponse,
  jobIndex: number,
  jobCount: number,
  aggregate: JobAggregate,
  alcance: SunatScope,
): SunatProgressState {
  const jobTotal = Math.max(0, Number(status.total) || 0);
  const jobProcessed = Math.max(
    0,
    Math.min(jobTotal || Infinity, Number(status.procesados) || 0),
  );
  // The bar represents the whole batch. It must not reset to 0% when the
  // frontend moves from one job to the next.
  const total = Math.max(aggregate.total, jobTotal);
  const procesados = Math.min(
    total || Infinity,
    aggregate.processed + jobProcessed,
  );
  const exitosos = aggregate.ok + Math.max(0, Number(status.exitosos) || 0);
  const errores = aggregate.errors + Math.max(0, Number(status.errores) || 0);
  const porcentaje =
    total > 0
      ? clampPercent((procesados / total) * 100)
      : clampPercent(Number(status.porcentaje) || 0);
  return {
    phase: "job",
    jobIndex,
    jobCount,
    estado: String(status.estado || "").toUpperCase(),
    total,
    procesados,
    exitosos,
    errores,
    pendientes: Math.max(0, total - procesados),
    porcentaje,
    mensaje: status.mensaje || "Consultando SUNAT…",
    alcance,
    enviados: procesados,
    porEnviar: total,
    aceptados: 0,
    enProceso: 0,
    sinConfirmar: 0,
    invalidos: 0,
    chunksDone: 0,
    chunksTotal: jobCount,
  };
}

function submissionMessages(data: SunatSubmissionResponse): string[] {
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
  if (data.omitidos.aceptados > 0) {
    messages.push(
      `${data.omitidos.aceptados} documento(s) ya estaban ACEPTADOS y se omitieron.` +
        (data.alcance === "todos"
          ? ""
          : " Usa «Todos» para volver a consultarlos en SUNAT."),
    );
  }
  if (data.omitidos.sin_confirmar > 0) {
    messages.push(
      `${data.omitidos.sin_confirmar} documento(s) tienen un envío sin confirmar; ` +
        "no se reintentaron para evitar duplicados en SUNAT.",
    );
  }
  if (data.errores.length) {
    messages.push(data.errores.map((item) => item.mensaje).join(" "));
  }
  return messages;
}

async function pollSubmission(
  solicitudId: string,
  signal: AbortSignal,
  onProgress: (state: SunatProgressState) => void,
): Promise<SunatSubmissionResponse> {
  const startedAt = Date.now();
  let failures = 0;

  while (true) {
    if (signal.aborted) throw new RequestAbortedError();
    try {
      const status = await sunatSubmissionStatus(solicitudId, signal);
      failures = 0;
      onProgress(submissionToProgress(status));
      if (TERMINAL.has(String(status.estado || "").toUpperCase())) {
        return status;
      }
    } catch (err: unknown) {
      if (err instanceof RequestAbortedError) throw err;
      if (err instanceof AuthError) throw err;
      if (err instanceof ApiError && err.status === 404) {
        throw new Error(
          "La solicitud de validación expiró en el servidor. " +
            "Actualiza los resultados para ver el estado real.",
        );
      }
      failures += 1;
      if (failures >= MAX_STATUS_FAILURES) {
        throw new Error(
          "No se pudo confirmar el avance de la validación. " +
            "El servidor seguirá procesando el lote; actualiza en unos minutos.",
        );
      }
      await sleep(SUBMISSION_POLL_MS * Math.min(failures, 4), signal);
      continue;
    }
    if (Date.now() - startedAt > MAX_POLL_MS) {
      throw new Error(
        "La validación sigue en segundo plano. " +
          "El servidor continuará procesándola aunque cierres esta página.",
      );
    }
    await sleep(SUBMISSION_POLL_MS, signal);
  }
}

/** SUNAT batch validation: explicit async submit, live progress, then jobs. */
export function useSunat(onAuthFailure: () => void) {
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
    setRefreshing(false);
    setProgress(null);
    setNotice(null);
    setWarning(null);
    setError(null);
  }, []);

  const runBatch = useCallback(
    async (
      rows: Voucher[],
      refresh: () => Promise<void> | void,
      alcance: SunatScope = "no_aceptados",
    ) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const { signal } = controller;

      setBusy(true);
      setRefreshing(false);
      setProgress(null);
      setNotice(null);
      setWarning(null);
      setError(null);

      const refreshResults = async () => {
        // SUNAT work is over: stop the validation spinner and expose the
        // table refresh as a separate state. The button stays disabled until
        // the new rows arrive, but it no longer looks like a pending query.
        setBusy(false);
        setRefreshing(true);
        try {
          await refresh();
        } catch {
          // useVouchers owns table errors; never mask the SUNAT outcome.
        } finally {
          setRefreshing(false);
        }
      };

      try {
        const queued = await submitSunatLote(
          rows.map((doc) => ({
            tipo: doc.tipo,
            number: doc.number,
            date: doc.date,
            crossTotal: doc.crossTotal,
          })),
          alcance,
          signal,
        );
        setProgress(submissionToProgress(queued));
        if (queued.reutilizada) {
          setNotice(
            "Ya había una validación en curso para este lote; se reutilizó.",
          );
        }

        const data = await pollSubmission(
          queued.solicitud_id,
          signal,
          setProgress,
        );
        const messages = submissionMessages(data);

        if (String(data.estado || "").toUpperCase() === "ERROR") {
          setError(
            data.mensaje ||
              messages.join(" ") ||
              "No se pudo registrar el lote SUNAT.",
          );
          await refreshResults();
          return;
        }

        if (!data.trabajos.length) {
          setNotice(
            messages.join(" ") ||
              (data.omitidos.aceptados > 0
                ? `Todo ya estaba aceptado (${data.omitidos.aceptados}).`
                : "Nada para enviar."),
          );
          await refreshResults();
          return;
        }
        if (messages.length) setNotice(messages.join(" "));

        const totalDocs = data.trabajos.reduce(
          (sum, job) => sum + Math.max(0, Number(job.cantidad) || 0),
          0,
        );
        const batchTotal =
          totalDocs || Math.max(0, Number(data.trabajos[0].cantidad) || 0);
        setProgress(
          queuedJobProgress(
            data.trabajos[0],
            data.trabajos.length,
            data.alcance,
            batchTotal,
          ),
        );

        const aggregate: JobAggregate = {
          total: batchTotal,
          processed: 0,
          ok: 0,
          errors: 0,
        };
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

            setProgress(
              toProgress(
                status,
                i + 1,
                data.trabajos.length,
                aggregate,
                data.alcance,
              ),
            );
            if (TERMINAL.has(String(status.estado || "").toUpperCase())) {
              aggregate.processed += Math.max(
                0,
                Number(status.procesados) || 0,
              );
              aggregate.ok += Math.max(0, Number(status.exitosos) || 0);
              aggregate.errors += Math.max(0, Number(status.errores) || 0);
              break;
            }
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

        await refreshResults();
      } catch (err: unknown) {
        if (err instanceof RequestAbortedError) return;
        if (err instanceof AuthError) {
          onAuthFailure();
          return;
        }
        setError(err instanceof Error ? err.message : "Error SUNAT");
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

  return { busy, refreshing, progress, notice, warning, error, runBatch, reset };
}
