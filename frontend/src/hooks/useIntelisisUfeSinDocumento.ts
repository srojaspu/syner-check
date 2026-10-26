import { useCallback, useEffect, useRef, useState } from "react";
import {
  AuthError,
  RequestAbortedError,
  getIntelisisUfeSinDocumento,
} from "../api/client";
import type { IntelisisUfeSinDocumentoRow } from "../api/types";

interface SinDocumentoState {
  rows: IntelisisUfeSinDocumentoRow[];
  loading: boolean;
  error: string | null;
  /** El servidor recortó la lista por su tope de filas. */
  truncado: boolean;
  maxFilas: number;
}

const EMPTY: SinDocumentoState = {
  rows: [],
  loading: false,
  error: null,
  truncado: false,
  maxFilas: 0,
};

/**
 * Ventas SINAFECTAR del período, para el diálogo "Ventas sin documentar".
 *
 * Se pide solo al abrir el diálogo: el listado principal no las trae y
 * cargarlas siempre sumaría una consulta a cada "Consultar". Al cerrar se
 * descarta el resultado para que el próximo período no muestre filas viejas.
 */
export function useIntelisisUfeSinDocumento({
  open,
  desde,
  hasta,
  onAuthFailure,
}: {
  open: boolean;
  desde: string;
  hasta: string;
  onAuthFailure: () => void;
}) {
  const [state, setState] = useState<SinDocumentoState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);
  const seq = useRef(0);

  const cargar = useCallback(async () => {
    if (!desde || !hasta) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    seq.current += 1;
    const actual = seq.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const data = await getIntelisisUfeSinDocumento(
        { desde, hasta },
        controller.signal,
      );
      if (actual !== seq.current) return;
      setState({
        rows: data.rows ?? [],
        loading: false,
        error: null,
        truncado: Boolean(data.truncado),
        maxFilas: Number(data.max_filas ?? 0),
      });
    } catch (error: unknown) {
      if (error instanceof RequestAbortedError || actual !== seq.current) return;
      if (error instanceof AuthError) {
        onAuthFailure();
        return;
      }
      setState({
        rows: [],
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : "No fue posible consultar las ventas sin documentar.",
        truncado: false,
        maxFilas: 0,
      });
    }
  }, [desde, hasta, onAuthFailure]);

  useEffect(() => {
    if (!open) return;
    void cargar();
    return () => abortRef.current?.abort();
  }, [open, cargar]);

  // Cerrar invalida la consulta en curso y limpia el resultado.
  useEffect(() => {
    if (open) return;
    seq.current += 1;
    abortRef.current?.abort();
    setState(EMPTY);
  }, [open]);

  return { ...state, recargar: cargar };
}
