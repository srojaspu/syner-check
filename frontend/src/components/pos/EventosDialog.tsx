import type { PosClave, PosEvento } from "../../api/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type EventosScope } from "./eventos";
import { PosEventosWorkspace } from "./PosEventosWorkspace";
import { TerminalesIndicadores } from "./TerminalesIndicadores";
import type { PosAnalyticsModel, PosKpiCardId } from "./posAnalytics";

export type { EventosScope } from "./eventos";

/**
 * Modal ampliado de eventos POS: incluye las 5 tarjetas KPI interactivas,
 * desgloses por caja/instancia/pedido y tabla traducida con tooltips.
 */
export function EventosDialog({
  open,
  onOpenChange,
  ventana,
  model,
  parcial = false,
  instancias,
  claves,
  activeCard,
  onSelectCard,
  subGrupo,
  onSubGrupoChange,
  scope,
  onScopeChange,
  clave,
  onClaveChange,
  nivel,
  onNivelChange,
  q,
  onQChange,
  loading,
  onActualizar,
  onDetalle,
  onVerPedido,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ventana: { desde: string; hasta: string; dias: number };
  model: PosAnalyticsModel;
  parcial?: boolean;
  instancias: string[];
  claves: PosClave[];
  activeCard: PosKpiCardId | null;
  onSelectCard: (card: PosKpiCardId | null) => void;
  subGrupo: string | null;
  onSubGrupoChange: (value: string | null) => void;
  scope: EventosScope;
  onScopeChange: (scope: EventosScope) => void;
  clave: string;
  onClaveChange: (value: string) => void;
  nivel: string;
  onNivelChange: (value: string) => void;
  q: string;
  onQChange: (value: string) => void;
  loading: boolean;
  onActualizar: () => void;
  onDetalle: (evento: PosEvento) => void;
  onVerPedido?: (numero: string) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        if (eventDetails?.reason === "outside-press") return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] max-w-6xl! max-h-[92vh]! gap-0 overflow-y-auto p-0">
        <DialogHeader className="border-b p-4 text-left">
          <DialogTitle>Eventos</DialogTitle>
          <DialogDescription>
            {scope.instancia
              ? `Instancia ${scope.instancia}${scope.serial ? ` · ${scope.serial}` : ""}`
              : "Todas las instancias"}{" "}
            · ventana de {ventana.dias} día(s)
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 p-4">
          <TerminalesIndicadores
            cards={model.cards}
            activeCard={activeCard}
            onSelectCard={(next) => {
              onSelectCard(next);
              onSubGrupoChange(null);
            }}
            parcial={parcial}
            compact
          />

          <PosEventosWorkspace
            model={model}
            claves={claves}
            instancias={instancias}
            activeCard={activeCard}
            onSelectCard={onSelectCard}
            scope={scope}
            onScopeChange={onScopeChange}
            clave={clave}
            onClaveChange={onClaveChange}
            nivel={nivel}
            onNivelChange={onNivelChange}
            q={q}
            onQChange={onQChange}
            subGrupo={subGrupo}
            onSubGrupoChange={onSubGrupoChange}
            loading={loading}
            fadeFrom="popover"
            maxHeightClass="max-h-[48vh]"
            onDetalle={onDetalle}
            onVerPedido={onVerPedido}
            onActualizar={onActualizar}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
