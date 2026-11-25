import { useEffect, useRef } from "react";
import { cn } from "cn";
import type { AppRoute } from "../hooks/useHashRoute";

const ITEMS: { ruta: AppRoute; href: string; label: string }[] = [
  { ruta: "comprobantes", href: "#/comprobantes", label: "SynerPos" },
  { ruta: "terminales", href: "#/terminales", label: "Terminales" },
  { ruta: "intelisis-ufe", href: "#/intelisis-ufe", label: "Intelisis UFE" },
  { ruta: "series-sucursal", href: "#/series-sucursal", label: "Series Sucursal" },
];

/**
 * Navegacion primaria (2 secciones).
 *
 * Enlaces reales (`<a href="#/...">`): funcionan con teclado, con
 * "abrir en pestana nueva" y sin JavaScript. El activo se marca con
 * `aria-current="page"`, no solo con color.
 */
export function PrimaryNav({ ruta }: { ruta: AppRoute }) {
  const listRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  // En móvil la tira de secciones se desplaza; centra la activa sin mover la
  // página (scrollIntoView también desplazaba el documento).
  useEffect(() => {
    const list = listRef.current;
    const active = activeRef.current;
    if (!list || !active) return;
    const listRect = list.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (listRect.width === 0) return;
    const delta =
      activeRect.left +
      activeRect.width / 2 -
      (listRect.left + listRect.width / 2);
    list.scrollLeft += delta;
  }, [ruta]);

  return (
    <nav aria-label="Secciones" className="min-w-0">
      <ul
        ref={listRef}
        className="flex items-center gap-1 overflow-x-auto rounded-full border bg-muted/60 p-1"
      >
        {ITEMS.map((item) => {
          const activo = item.ruta === ruta;
          return (
            <li key={item.ruta}>
              <a
                ref={activo ? activeRef : undefined}
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
