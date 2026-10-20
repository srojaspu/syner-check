import { useCallback, useEffect, useRef, useState } from "react";
import {
  AuthError,
  RequestAbortedError,
  getSummary,
  searchByNumber,
} from "../api/client";
import type { FlowBreakdown, Voucher } from "../api/types";

export type SearchMode = "range" | "number";

interface VoucherState {
  rows: Voucher[];
  subtitle: string;
  loading: boolean;
  error: string | null;
  searched: boolean;
  intelisisEnabled: boolean;
  intelisisCount: number;
  intelisisWarning: string | null;
  sunatEnabled: boolean;
  flow: FlowBreakdown | null;
}

const EMPTY: VoucherState = {
  rows: [],
  subtitle: "Selecciona un criterio para comenzar.",
  loading: false,
  error: null,
  searched: false,
  intelisisEnabled: false,
  intelisisCount: 0,
  intelisisWarning: null,
  sunatEnabled: false,
  flow: null,
};

/** Container: owns fetching + rows; presentation lives in components. */
export function useVouchers(onAuthFailure: () => void) {
  const [state, setState] = useState<VoucherState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);
  const seq = useRef(0);

  // Cancel any in-flight request when the container unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  /** Supersede the previous request and return the new signal + sequence. */
  const begin = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    seq.current += 1;
    return { signal: controller.signal, id: seq.current };
  }, []);

  const isCurrent = useCallback((id: number) => id === seq.current, []);

  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof AuthError) {
        onAuthFailure();
        return;
      }
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : "Error de consulta",
      }));
    },
    [onAuthFailure],
  );

  const runRange = useCallback(
    async (start: string, end: string, types: string) => {
      const { signal, id } = begin();
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await getSummary(
          {
            start_date: start,
            end_date: end,
            types,
          },
          signal,
        );
        if (!isCurrent(id)) return;
        const rows = Object.values(data.documents).flat();
        setState({
          rows,
          subtitle: `${rows.length} documento${rows.length === 1 ? "" : "s"}`,
          loading: false,
          error: null,
          searched: true,
          intelisisEnabled: Boolean(data.intelisis_enabled),
          intelisisCount: Number(data.intelisis_count ?? 0),
          intelisisWarning: data.intelisis_warning ?? null,
          sunatEnabled: Boolean(data.sunat_enabled),
          flow: data.flow ?? null,
        });
      } catch (error: unknown) {
        if (error instanceof RequestAbortedError || !isCurrent(id)) return;
        fail(error);
      }
    },
    [begin, fail, isCurrent],
  );

  const runNumber = useCallback(
    async (number: string) => {
      const { signal, id } = begin();
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await searchByNumber(number, signal);
        if (!isCurrent(id)) return;
        const subtitle =
          data.source === "sql_index"
            ? `${data.results.length} coincidencia(s) en el índice local`
            : `${data.results.length} coincidencia(s) en GraphQL · ${data.searched_range?.start ?? ""} a ${data.searched_range?.end ?? ""}`;
        setState({
          rows: data.results,
          subtitle,
          loading: false,
          error: null,
          searched: true,
          intelisisEnabled: Boolean(data.intelisis_enabled),
          intelisisCount: 0,
          intelisisWarning: data.intelisis_warning ?? null,
          sunatEnabled: Boolean(data.sunat_enabled),
          flow: null,
        });
      } catch (error: unknown) {
        if (error instanceof RequestAbortedError || !isCurrent(id)) return;
        fail(error);
      }
    },
    [begin, fail, isCurrent],
  );

  return { ...state, runRange, runNumber };
}
