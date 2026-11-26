import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * Contenedor con scroll sin barra visible y un degradado inferior cuando hay
 * más contenido. La cabecera fija se resuelve con `.pos-table-scroll thead th`
 * (ver index.css).
 */
export function FadeScroll({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hayMas, setHayMas] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const update = () => {
      const more =
        element.scrollHeight - element.scrollTop - element.clientHeight > 4;
      setHayMas(more);
    };

    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(update)
        : null;
    observer?.observe(element);

    return () => {
      element.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [children]);

  return (
    <div className="relative">
      <div
        ref={ref}
        className={cn(
          "pos-table-scroll overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          className,
        )}
      >
        {children}
      </div>
      {hayMas ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card to-transparent"
          aria-hidden
        />
      ) : null}
    </div>
  );
}
