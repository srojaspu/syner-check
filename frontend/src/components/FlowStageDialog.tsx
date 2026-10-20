import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ChevronRightIcon,
  FileSearchIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "cn";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, formatMoney } from "../api/format";
import type {
  FlowDocument,
  FlowStageKey,
  FlowStageSummary,
} from "../api/types";
import { useFlowDocuments, type FlowRange } from "../hooks/useFlowDocuments";

const STAGE_COPY: Record<
  FlowStageKey,
  { title: string; description: string }
> = {
  intelisis: {
    title: "Intelisis",
    description:
      "Documentos de esta búsqueda clasificados por su estado en Intelisis. " +
      "Selecciona un estado para consultar cuáles son.",
  },
  sunat: {
    title: "SUNAT",
    description:
      "Documentos de esta búsqueda clasificados por su último estado conocido " +
      "en SUNAT. Selecciona un estado para consultar cuáles son.",
  },
};

function documentLabel(count: number): string {
  return `${count} documento${count === 1 ? "" : "s"}`;
}

function DocumentList({ documents }: { documents: FlowDocument[] }) {
  if (!documents.length) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        No se encontraron documentos para este estado.
      </p>
    );
  }
  return (
    <ul className="divide-y overflow-hidden rounded-lg border">
      {documents.map((doc) => (
        <li
          key={`${doc.tipo}-${doc.oid}-${doc.number}-${doc.date}`}
          className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <b className="truncate">{doc.number || "Sin número"}</b>
              <Badge variant="outline">{doc.tipo}</Badge>
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {formatDate(doc.date)}
              {" · "}
              {doc.contactName || "Cliente no informado"}
              {doc.estado_detalle ? ` · ${doc.estado_detalle}` : ""}
              {doc.fecha_consulta
                ? ` · consultado ${formatDate(doc.fecha_consulta)}`
                : ""}
            </p>
          </div>
          <span className="shrink-0 text-sm tabular-nums">
            {formatMoney(doc.crossTotal, doc.currency?.isoCode ?? "PEN")}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function FlowStageDialog({
  open,
  stage,
  summary,
  range,
  onOpenChange,
  onAuthFailure,
}: {
  open: boolean;
  stage: FlowStageKey;
  summary: FlowStageSummary | null;
  range: FlowRange | null;
  onOpenChange: (open: boolean) => void;
  onAuthFailure: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const { documents, loading, error, load, reset } =
    useFlowDocuments(onAuthFailure);
  const copy = STAGE_COPY[stage];
  const states =
    summary?.enabled === false
      ? []
      : (summary?.states.filter((state) => state.count > 0) ?? []);
  const selectedLabel =
    states.find((state) => state.key === selected)?.label ?? selected;

  useEffect(() => {
    setSelected(null);
    reset();
  }, [stage, reset]);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      reset();
    }
  }, [open, reset]);

  const handleSelect = (stateKey: string) => {
    if (!range) return;
    setSelected(stateKey);
    void load(stage, stateKey, range);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon
              icon={FileSearchIcon}
              size={17}
              strokeWidth={2}
              aria-hidden
            />
            {copy.title} · detalle por estado
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        {summary?.enabled === false ? (
          <Alert>
            <HugeiconsIcon
              icon={FileSearchIcon}
              size={16}
              strokeWidth={2}
              aria-hidden
            />
            <AlertTitle>Clasificación no disponible</AlertTitle>
            <AlertDescription>
              {stage === "intelisis"
                ? "Intelisis no está configurado o no respondió; los documentos no se pudieron clasificar."
                : "SUNAT no está configurado o la caché local no respondió; los estados pueden no ser confiables."}
            </AlertDescription>
          </Alert>
        ) : null}

        {summary ? (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                <b className="text-foreground tabular-nums">
                  {summary.total}
                </b>{" "}
                documentos
              </span>
              {stage === "sunat" ? (
                <span>
                  <b className="text-foreground tabular-nums">
                    {summary.consulted}
                  </b>{" "}
                  consultados
                </span>
              ) : null}
            </div>

            {summary.enabled === false ? null : states.length ? (
              <div
                className="grid gap-2 sm:grid-cols-2"
                role="group"
                aria-label="Estados disponibles"
              >
                {states.map((state) => {
                  const active = selected === state.key;
                  return (
                    <button
                      key={state.key}
                      type="button"
                      aria-pressed={active}
                      aria-controls="flow-stage-documents"
                      onClick={() => handleSelect(state.key)}
                      className={cn(
                        "group flex min-w-0 items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        active && "border-primary bg-primary/5",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {state.label}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {summary.total > 0
                            ? `${Math.round(
                                (state.count / summary.total) * 100,
                              )}% del total`
                            : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <b className="text-xl tabular-nums">{state.count}</b>
                        <HugeiconsIcon
                          icon={ChevronRightIcon}
                          size={14}
                          strokeWidth={2}
                          className="text-muted-foreground"
                          aria-hidden
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No hay documentos para clasificar en esta etapa.
              </p>
            )}
          </>
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No hay desglose disponible. Vuelve a consultar el rango.
          </p>
        )}

        {summary?.enabled === false || !summary ? null : (
        <section
          id="flow-stage-documents"
          aria-live="polite"
          aria-busy={loading}
          className="flex flex-col gap-2 border-t pt-4"
        >
          {!selected ? (
            <p className="text-sm text-muted-foreground">
              Elige un estado para consultar qué documentos lo componen.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">
                  {selectedLabel}{" "}
                  <span className="font-normal text-muted-foreground">
                    ·{" "}
                    {loading
                      ? "consultando…"
                      : documentLabel(documents.length)}
                  </span>
                </h3>
                {loading ? (
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={16}
                    strokeWidth={2}
                    className="animate-spin text-muted-foreground"
                    aria-label="Consultando documentos"
                  />
                ) : null}
              </div>
              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>No se pudo consultar el detalle</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : loading ? (
                <p className="text-sm text-muted-foreground">
                  Consultando documentos en {copy.title}…
                </p>
              ) : (
                <DocumentList documents={documents} />
              )}
            </>
          )}
        </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
