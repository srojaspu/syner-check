import { Badge } from "@/components/ui/badge";
import type { PosClave, PosVersion } from "../../api/types";

export function PosTopClaves({
  claves,
  versiones,
}: {
  claves: PosClave[];
  versiones: PosVersion[];
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
          return (
            <li key={item.clave} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium" title={item.clave}>
                  {item.clave}
                </span>
                <span className="tabular-nums text-muted-foreground">
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
