import { useCallback, useState } from "react";
import { AuthError, getSummary, searchByNumber } from "../api/client";
import type { Voucher } from "../api/types";

export type SearchMode = "range" | "number";

interface VoucherState {
  rows: Voucher[];
  subtitle: string;
  loading: boolean;
  error: string | null;
  searched: boolean;
}

const EMPTY: VoucherState = {
  rows: [],
  subtitle: "Selecciona un criterio para comenzar.",
  loading: false,
  error: null,
  searched: false,
};

/** Container: owns fetching + rows; presentation lives in components. */
export function useVouchers(onAuthFailure: () => void) {
  const [state, setState] = useState<VoucherState>(EMPTY);

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
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await getSummary({
          start_date: start,
          end_date: end,
          types,
        });
        const rows = Object.values(data.documents).flat();
        setState({
          rows,
          subtitle: `${rows.length} documento${rows.length === 1 ? "" : "s"}`,
          loading: false,
          error: null,
          searched: true,
        });
      } catch (error: unknown) {
        fail(error);
      }
    },
    [fail],
  );

  const runNumber = useCallback(
    async (number: string) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await searchByNumber(number);
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
        });
      } catch (error: unknown) {
        fail(error);
      }
    },
    [fail],
  );

  return { ...state, runRange, runNumber };
}
