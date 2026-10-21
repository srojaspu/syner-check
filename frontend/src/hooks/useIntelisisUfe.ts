import { useCallback, useEffect, useRef, useState } from "react";
import {
  AuthError,
  RequestAbortedError,
  getIntelisisUfe,
} from "../api/client";
import type { IntelisisUfeKpis, IntelisisUfeRow } from "../api/types";

interface UfeState {
  rows: IntelisisUfeRow[];
  kpis: IntelisisUfeKpis | null;
  loading: boolean;
  error: string | null;
  searched: boolean;
  intelisisEnabled: boolean;
  desde: string;
  hasta: string;
}

const EMPTY: UfeState = {
  rows: [],
  kpis: null,
  loading: false,
  error: null,
  searched: false,
  intelisisEnabled: false,
  desde: "",
  hasta: "",
};

/**
 * Container de la pantalla Intelisis UFE: fetching + estado.
 * La presentacion vive en los componentes.
 */
export function useIntelisisUfe(onAuthFailure: () => void) {
  const [state, setState] = useState<UfeState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);
  const seq = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);

  const begin = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    seq.current += 1;
    return { signal: controller.signal, id: seq.current };
  }, []);

  const isCurrent = useCallback((id: number) => id === seq.current, []);

  const run = useCallback(
    async (desde: string, hasta: string) => {
      const { signal, id } = begin();
      setState((prev) => ({
        ...prev,
        loading: true,
        error: null,
        desde,
        hasta,
      }));
      try {
        const data = await getIntelisisUfe({ desde, hasta }, signal);
        if (!isCurrent(id)) return;
        setState({
          rows: data.rows ?? [],
          kpis: data.kpis ?? null,
          loading: false,
          error: null,
          searched: true,
          intelisisEnabled: Boolean(data.intelisis_enabled),
          desde: data.desde ?? desde,
          hasta: data.hasta ?? hasta,
        });
      } catch (error: unknown) {
        if (error instanceof RequestAbortedError || !isCurrent(id)) return;
        if (error instanceof AuthError) {
          onAuthFailure();
          return;
        }
        setState((prev) => ({
          ...prev,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "No fue posible consultar los comprobantes.",
        }));
      }
    },
    [begin, isCurrent, onAuthFailure],
  );

  return { ...state, run };
}
