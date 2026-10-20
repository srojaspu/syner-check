import { useCallback, useEffect, useRef, useState } from "react";
import {
  AuthError,
  RequestAbortedError,
  getFlowDocuments,
} from "../api/client";
import type { FlowDocument, FlowStageKey } from "../api/types";

export interface FlowRange {
  start: string;
  end: string;
  types: string;
}

interface FlowDocumentsState {
  documents: FlowDocument[];
  selected: string | null;
  loading: boolean;
  error: string | null;
}

const EMPTY: FlowDocumentsState = {
  documents: [],
  selected: null,
  loading: false,
  error: null,
};

/** Loads the document list behind one flow state; aborts superseded clicks. */
export function useFlowDocuments(onAuthFailure: () => void) {
  const [state, setState] = useState<FlowDocumentsState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);
  const seq = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    seq.current += 1;
    setState(EMPTY);
  }, []);

  const load = useCallback(
    async (stage: FlowStageKey, estado: string, range: FlowRange) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      seq.current += 1;
      const id = seq.current;

      setState({ ...EMPTY, selected: estado, loading: true });
      try {
        const data = await getFlowDocuments(
          stage,
          {
            estado,
            start_date: range.start,
            end_date: range.end,
            types: range.types,
          },
          controller.signal,
        );
        if (id !== seq.current) return;
        setState({
          documents: data.documents,
          selected: estado,
          loading: false,
          error: null,
        });
      } catch (error: unknown) {
        if (error instanceof RequestAbortedError || id !== seq.current) return;
        if (error instanceof AuthError) {
          onAuthFailure();
          return;
        }
        setState({
          documents: [],
          selected: estado,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "No fue posible consultar los documentos.",
        });
      }
    },
    [onAuthFailure],
  );

  return { ...state, load, reset };
}
