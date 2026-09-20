import { useCallback, useState } from "react";
import { AuthError, getDocument } from "../api/client";
import type { Voucher } from "../api/types";

/** Container for the detail drawer: lazy-loads the full document. */
export function useDocument(onAuthFailure: () => void) {
  const [open, setOpen] = useState(false);
  const [document, setDocument] = useState<Voucher | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = useCallback(
    async (row: Voucher) => {
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
        );
        setDocument(data.document);
      } catch (err: unknown) {
        if (err instanceof AuthError) {
          onAuthFailure();
          setOpen(false);
        } else {
          setError(err instanceof Error ? err.message : "Error de consulta");
        }
      } finally {
        setLoading(false);
      }
    },
    [onAuthFailure],
  );

  const close = useCallback(() => {
    setOpen(false);
    setDocument(null);
    setError(null);
  }, []);

  return { open, document, loading, error, show, close };
}
