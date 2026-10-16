import { useCallback, useState } from "react";
import { AuthError, submitSunatLote, sunatJobStatus } from "../api/client";
import type { Voucher } from "../api/types";

const POLL_MS = 4000;
const POLL_MAX = 90;
const TERMINAL = new Set(["COMPLETADO", "COMPLETADO_ERROR"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** SUNAT batch validation: explicit submit + polling, then refresh. */
export function useSunat(onAuthFailure: () => void) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runBatch = useCallback(
    async (rows: Voucher[], refresh: () => void) => {
      setBusy(true);
      setError(null);
      try {
        const data = await submitSunatLote(
          rows.map((doc) => ({
            tipo: doc.tipo,
            number: doc.number,
            date: doc.date,
            crossTotal: doc.crossTotal,
          })),
        );
        if (!data.trabajos.length) {
          setProgress(
            data.omitidos.cache_terminal > 0
              ? `Todo ya validado (${data.omitidos.cache_terminal} en caché).`
              : "Nada para enviar.",
          );
          refresh();
          return;
        }
        for (let i = 0; i < data.trabajos.length; i += 1) {
          const job = data.trabajos[i];
          for (let attempt = 0; ; attempt += 1) {
            const status = await sunatJobStatus(job.trabajo_id);
            const done = TERMINAL.has(status.estado);
            setProgress(
              `Lote ${i + 1}/${data.trabajos.length} · ${status.estado} ` +
                `(${status.procesados ?? 0}/${status.total ?? job.cantidad})`,
            );
            if (done || attempt >= POLL_MAX) break;
            await sleep(POLL_MS);
          }
        }
        setProgress("Validación completa. Actualizando…");
        refresh();
      } catch (err: unknown) {
        if (err instanceof AuthError) {
          onAuthFailure();
          return;
        }
        setError(err instanceof Error ? err.message : "Error SUNAT");
      } finally {
        setBusy(false);
      }
    },
    [onAuthFailure],
  );

  return { busy, progress, error, runBatch };
}
