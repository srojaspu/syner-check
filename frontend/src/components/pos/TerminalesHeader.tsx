import { HugeiconsIcon } from "@hugeicons/react";
import {
  Loading02Icon,
  RefreshIcon,
  Search01Icon,
  Store01Icon,
} from "@hugeicons/core-free-icons";
import type { PosAnalysis } from "../../api/types";
import { Button } from "@/components/ui/button";
import { fmtHace, numeroFmt } from "./format";

export function TerminalesHeader({
  data,
  loading,
  onVerEventos,
  onActualizar,
}: {
  data: PosAnalysis | null;
  loading: boolean;
  onVerEventos: () => void;
  onActualizar: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 border-b pb-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <HugeiconsIcon
            icon={Store01Icon}
            size={20}
            strokeWidth={2}
            aria-hidden
          />
          <h1 className="text-xl font-semibold tracking-tight">Terminales</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Monitoreo de eventos POS · SynerCOM
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="text-right text-xs text-muted-foreground">
          {data ? (
            <>
              <div>
                Snapshot {fmtHace(data.generadoEn)} · último evento{" "}
                {data.kpis.ultimoEvento
                  ? fmtHace(data.kpis.ultimoEvento)
                  : "—"}
              </div>
              <div>
                {data.fuente.cache === "hit"
                  ? "desde caché"
                  : `consulta ${numeroFmt.format(data.fuente.upstreamMs ?? 0)} ms`}{" "}
                · respuesta{" "}
                {numeroFmt.format(data.fuente.latenciaMs ?? 0)} ms
              </div>
            </>
          ) : (
            <div>{loading ? "Consultando SynerCOM…" : "Sin datos"}</div>
          )}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onVerEventos}
        >
          <HugeiconsIcon
            icon={Search01Icon}
            size={15}
            strokeWidth={2}
            aria-hidden
          />
          Ver eventos
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onActualizar}
          disabled={loading}
        >
          <HugeiconsIcon
            icon={loading ? Loading02Icon : RefreshIcon}
            size={15}
            strokeWidth={2}
            className={loading ? "animate-spin" : undefined}
            aria-hidden
          />
          Actualizar
        </Button>
      </div>
    </div>
  );
}
