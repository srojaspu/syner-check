import { useCallback, useState } from "react";
import { AuthError, getSummary, searchByNumber } from "../api/client";
import type { FlowPerTipo, Voucher } from "../api/types";

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
  flow: { per_tipo: Record<string, FlowPerTipo>; totals: FlowPerTipo } | null;
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
  flow: null,
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
          intelisisEnabled: Boolean(data.intelisis_enabled),
          intelisisCount: Number(data.intelisis_count ?? 0),
          intelisisWarning: data.intelisis_warning ?? null,
          flow: data.flow ?? null,
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
          intelisisEnabled: false,
          intelisisCount: 0,
          intelisisWarning: null,
          flow: null,
        });
      } catch (error: unknown) {
        fail(error);
      }
    },
    [fail],
  );

  return { ...state, runRange, runNumber };
}
