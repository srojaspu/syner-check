import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import type { PosClave } from "../../api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchCombobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TODAS, type EventosScope } from "./eventos";
import { shortEventLabel } from "./posCatalog";

export function EventosFiltros({
  scope,
  instancias,
  claves,
  clave,
  q,
  hasActiveFilter = false,
  onScopeChange,
  onClave,
  onQ,
  onLimpiar,
}: {
  scope: EventosScope;
  instancias: string[];
  claves: PosClave[];
  clave: string;
  q: string;
  hasActiveFilter?: boolean;
  onScopeChange: (scope: EventosScope) => void;
  onClave: (value: string) => void;
  onQ: (value: string) => void;
  onLimpiar: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchCombobox
        items={[TODAS, ...instancias]}
        value={scope.instancia}
        onValueChange={(next) =>
          onScopeChange({
            instancia: next === TODAS ? null : next,
            serial: null,
          })
        }
        labelFor={(item) =>
          item === TODAS ? "Todas las instancias" : item
        }
        placeholder="Todas las instancias"
        ariaLabel="Filtrar eventos por instancia"
      />

      <Select value={clave} onValueChange={(next) => onClave(next ?? TODAS)}>
        <SelectTrigger className="w-64" aria-label="Filtrar eventos por clave">
          <SelectValue>
            {(current) =>
              current === TODAS || !current
                ? "Todas las claves"
                : shortEventLabel(String(current))
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODAS}>Todas las claves</SelectItem>
          {claves.slice(0, 40).map((item) => (
            <SelectItem key={item.clave} value={item.clave}>
              {shortEventLabel(item.clave)} ({item.conteo})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="relative min-w-48 flex-1">
        <HugeiconsIcon
          icon={Search01Icon}
          size={15}
          strokeWidth={2}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(event) => onQ(event.target.value)}
          placeholder="Buscar pedido, descripción, caja o clave"
          aria-label="Buscar eventos por mensaje o clave"
          className="pl-8"
        />
      </div>

      <Button
        type="button"
        variant={hasActiveFilter ? "secondary" : "ghost"}
        size="sm"
        onClick={onLimpiar}
      >
        Limpiar filtro
      </Button>
    </div>
  );
}
