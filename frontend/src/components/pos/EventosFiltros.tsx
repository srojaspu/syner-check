import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Loading02Icon,
  RefreshIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import type { PosClave } from "../../api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TODAS, TODOS, type EventosScope } from "./eventos";
import { shortEventLabel } from "./posCatalog";

export function EventosFiltros({
  scope,
  instancias,
  claves,
  nivel,
  clave,
  q,
  loading,
  hasActiveFilter = false,
  onScopeChange,
  onNivel,
  onClave,
  onQ,
  onLimpiar,
  onActualizar,
}: {
  scope: EventosScope;
  instancias: string[];
  claves: PosClave[];
  nivel: string;
  clave: string;
  q: string;
  loading: boolean;
  hasActiveFilter?: boolean;
  onScopeChange: (scope: EventosScope) => void;
  onNivel: (value: string) => void;
  onClave: (value: string) => void;
  onQ: (value: string) => void;
  onLimpiar: () => void;
  onActualizar?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {scope.instancia ? (
        <Badge variant="secondary" className="max-w-72 gap-1">
          <span className="truncate">{scope.instancia}</span>
          {scope.serial ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {scope.serial}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onScopeChange({ instancia: null, serial: null })}
            aria-label="Quitar filtro de instancia"
            className="rounded-full p-0.5 hover:bg-foreground/10"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
          </button>
        </Badge>
      ) : null}

      <Select
        value={scope.instancia ?? TODAS}
        onValueChange={(next) =>
          onScopeChange({
            instancia: next === TODAS ? null : next,
            serial: null,
          })
        }
      >
        <SelectTrigger className="w-56" aria-label="Filtrar eventos por instancia">
          <SelectValue>
            {(current) =>
              current === TODAS || !current
                ? "Todas las instancias"
                : current
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODAS}>Todas las instancias</SelectItem>
          {instancias.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={nivel} onValueChange={(next) => onNivel(next ?? TODOS)}>
        <SelectTrigger className="w-40" aria-label="Filtrar eventos por nivel">
          <SelectValue>
            {(current) =>
              current === TODOS || !current ? "Todos los niveles" : current
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos los niveles</SelectItem>
          <SelectItem value="ERROR">Error</SelectItem>
          <SelectItem value="WARN">Advertencia</SelectItem>
          <SelectItem value="INFO">Info</SelectItem>
        </SelectContent>
      </Select>

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

      {onActualizar ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onActualizar}
          disabled={loading}
        >
          <HugeiconsIcon
            icon={loading ? Loading02Icon : RefreshIcon}
            size={14}
            strokeWidth={2}
            className={loading ? "animate-spin" : undefined}
            aria-hidden
          />
          Actualizar
        </Button>
      ) : null}
    </div>
  );
}
