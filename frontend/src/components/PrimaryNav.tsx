import { cn } from "cn";
import type { AppRoute } from "../hooks/useHashRoute";

const ITEMS: { ruta: AppRoute; href: string; label: string }[] = [
  { ruta: "comprobantes", href: "#/comprobantes", label: "SynerPos" },
  { ruta: "intelisis-ufe", href: "#/intelisis-ufe", label: "Intelisis UFE" },
];

/**
 * Navegacion primaria (2 secciones).
 *
 * Enlaces reales (`<a href="#/...">`): funcionan con teclado, con
 * "abrir en pestana nueva" y sin JavaScript. El activo se marca con
 * `aria-current="page"`, no solo con color.
 */
export function PrimaryNav({ ruta }: { ruta: AppRoute }) {
  return (
    <nav aria-label="Secciones" className="min-w-0">
      <ul className="flex items-center gap-1 overflow-x-auto rounded-full border bg-muted/60 p-1">
        {ITEMS.map((item) => {
          const activo = item.ruta === ruta;
          return (
            <li key={item.ruta}>
              <a
                href={item.href}
                aria-current={activo ? "page" : undefined}
                className={cn(
                  "inline-flex items-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  activo
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
