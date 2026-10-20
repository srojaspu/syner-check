import { useCallback, useEffect, useRef, useState } from "react";
import {
  AuthError,
  RequestAbortedError,
  getDocument,
} from "../api/client";
import type { Voucher } from "../api/types";

/** Container for the detail drawer: lazy-loads the full document. */
export function useDocument(onAuthFailure: () => void) {
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState<Voucher | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seq = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);

  const show = useCallback(
    async (row: Voucher) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      seq.current += 1;
      const id = seq.current;

      setOpen(true);
      setError(null);
      if (row.items) {
        setDocument(row);
        setLoading(false);
        return;
      }
      setDocument(null);
      setLoading(true);
      try {
        const data = await getDocument(
          row.tipo,
          row.oid,
          String(row.date ?? "").slice(0, 10),
          row.number ?? "",
          controller.signal,
        );
        if (id !== seq.current) return;
        setDocument(data.document);
      } catch (err: unknown) {
        if (err instanceof RequestAbortedError || id !== seq.current) return;
        if (err instanceof AuthError) {
          onAuthFailure();
          setOpen(false);
        } else {
          setError(err instanceof Error ? err.message : "Error de consulta");
        }
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [onAuthFailure],
  );

  const close = useCallback(() => {
    abortRef.current?.abort();
    seq.current += 1;
    setOpen(false);
    setDocument(null);
    setError(null);
    setLoading(false);
  }, []);

  return { open, document, loading, error, show, close };
}
