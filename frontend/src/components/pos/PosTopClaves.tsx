import { Badge } from "@/components/ui/badge";
import type { PosClave, PosVersion } from "../../api/types";
import { EVENT_DICTIONARY, shortEventLabel } from "./posCatalog";

export function PosTopClaves({
  claves,
  versiones,
  selectedClave,
  onSelectClave,
}: {
  claves: PosClave[];
  versiones: PosVersion[];
  selectedClave?: string;
  onSelectClave?: (clave: string) => void;
}) {
  if (claves.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Sin claves observadas en la ventana.
      </p>
    );
  }

  const max = Math.max(1, ...claves.map((item) => item.conteo));

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {claves.map((item) => {
          const color =
            item.nivel === "ERROR"
              ? "bg-destructive"
              : item.nivel === "WARN"
                ? "bg-chart-4"
                : "bg-chart-2";
          const isSelected = selectedClave === item.clave;
          const fullDesc = EVENT_DICTIONARY[item.clave]?.mensaje ?? item.clave;
          const rowContent = (
            <>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <span className="block truncate font-medium">
                    {shortEventLabel(item.clave)}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">
                    {item.clave}
                  </span>
                </div>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {item.conteo}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${color}`}
                  style={{
                    width: `${(item.conteo / max) * 100}%`,
                    minWidth: "2px",
                  }}
                />
              </div>
            </>
          );

          return (
            <li key={item.clave}>
              {onSelectClave ? (
                <button
                  type="button"
                  onClick={() => onSelectClave(item.clave)}
                  aria-pressed={isSelected}
                  title={fullDesc}
                  className={`flex w-full flex-col gap-1 rounded-lg p-1.5 text-left transition-colors hover:bg-muted/60 ${
                    isSelected ? "bg-muted ring-1 ring-primary/40" : ""
                  }`}
                >
                  {rowContent}
                </button>
              ) : (
                <div className="flex flex-col gap-1" title={fullDesc}>
                  {rowContent}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {versiones.length > 0 ? (
        <div className="flex flex-col gap-1 border-t pt-3">
          <span className="text-xs text-muted-foreground">
            Versiones de la app
          </span>
          <div className="flex flex-wrap gap-1">
            {versiones.slice(0, 5).map((item) => (
              <Badge key={item.version} variant="outline">
                {item.version} · {item.conteo}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
