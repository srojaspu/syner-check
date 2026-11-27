import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
} from "react";
import { cn } from "cn";

export interface HoraMinuto {
  hora: string;
  minuto: string;
}

const HORAS = Array.from({ length: 24 }, (_, indice) =>
  String(indice).padStart(2, "0"),
);
const MINUTOS = Array.from({ length: 60 }, (_, indice) =>
  String(indice).padStart(2, "0"),
);

/** Deben coincidir con las clases `h-8` / `h-16` / `h-40` de abajo. */
const FILA_PX = 32;

function ColumnaRueda({
  etiqueta,
  valores,
  valor,
  onChange,
}: {
  etiqueta: string;
  valores: readonly string[];
  valor: string;
  onChange: (next: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const primeraVez = useRef(true);
  const indiceDesdeScroll = useRef<number | null>(null);
  const idBase = useId();
  const indice = Math.max(0, valores.indexOf(valor));

  // Centra el valor activo cuando cambia por clic/teclado/segmento; si el
  // cambio vino del propio scroll, deja que el imán CSS termine el movimiento.
  useEffect(() => {
    if (indiceDesdeScroll.current === indice) {
      indiceDesdeScroll.current = null;
      return;
    }

    const elemento = scrollRef.current;
    if (!elemento) return;

    const objetivo = indice * FILA_PX;
    const media =
      typeof window !== "undefined"
        ? window.matchMedia?.("(prefers-reduced-motion: reduce)")
        : undefined;
    const comportamiento =
      primeraVez.current || media?.matches ? "auto" : "smooth";
    primeraVez.current = false;

    if (Math.abs(elemento.scrollTop - objetivo) <= 1) return;
    if (typeof elemento.scrollTo === "function") {
      elemento.scrollTo({ top: objetivo, behavior: comportamiento });
    } else {
      elemento.scrollTop = objetivo;
    }
  }, [indice]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  function alDesplazar() {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const elemento = scrollRef.current;
      if (!elemento) return;
      const siguiente = Math.min(
        valores.length - 1,
        Math.max(0, Math.round(elemento.scrollTop / FILA_PX)),
      );
      if (valores[siguiente] !== valor) {
        indiceDesdeScroll.current = siguiente;
        onChange(valores[siguiente]);
      }
    });
  }

  function alTeclear(event: KeyboardEvent<HTMLDivElement>) {
    let siguiente = indice;
    if (event.key === "ArrowUp") siguiente = indice - 1;
    else if (event.key === "ArrowDown") siguiente = indice + 1;
    else if (event.key === "PageUp") siguiente = indice - 5;
    else if (event.key === "PageDown") siguiente = indice + 5;
    else if (event.key === "Home") siguiente = 0;
    else if (event.key === "End") siguiente = valores.length - 1;
    else return;

    event.preventDefault();
    const acotado = Math.min(
      valores.length - 1,
      Math.max(0, siguiente),
    );
    if (acotado !== indice) onChange(valores[acotado]);
  }

  return (
    <div className="relative z-10 w-12 rounded-xl has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50">
      <div
        ref={scrollRef}
        role="listbox"
        aria-label={etiqueta}
        aria-activedescendant={`${idBase}-${indice}`}
        tabIndex={0}
        onScroll={alDesplazar}
        onKeyDown={alTeclear}
        className="h-40 w-full snap-y snap-mandatory overflow-y-auto overscroll-y-contain outline-none [scrollbar-width:none] [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)] [&::-webkit-scrollbar]:hidden"
      >
        <div aria-hidden className="h-16" />
        {valores.map((item, posicion) => {
          const activo = item === valor;
          return (
            <button
              key={item}
              id={`${idBase}-${posicion}`}
              type="button"
              role="option"
              aria-selected={activo}
              tabIndex={-1}
              onClick={() => onChange(item)}
              className={cn(
                "flex h-8 w-full snap-center items-center justify-center rounded-lg text-sm tabular-nums transition-colors",
                activo
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground/60 hover:text-foreground",
              )}
            >
              {item}
            </button>
          );
        })}
        <div aria-hidden className="h-16" />
      </div>
    </div>
  );
}

/**
 * Selector de hora estilo iOS: dos columnas (hora y minuto) con imán de
 * desplazamiento y una banda central para el valor activo. Se maneja con
 * rueda, arrastre, clic o teclado (↑/↓, PageUp/PageDown, Home/End).
 */
export function RuedaHora({
  etiqueta,
  valor,
  onChange,
}: {
  etiqueta: string;
  valor: HoraMinuto;
  onChange: (next: HoraMinuto) => void;
}) {
  return (
    <div className="relative mx-auto flex h-40 w-fit items-center justify-center gap-1">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 rounded-xl bg-muted"
      />
      <ColumnaRueda
        etiqueta={`Hora de ${etiqueta}`}
        valores={HORAS}
        valor={valor.hora}
        onChange={(hora) => onChange({ ...valor, hora })}
      />
      <span
        aria-hidden
        className="relative z-10 -mx-1 text-base font-semibold text-muted-foreground"
      >
        :
      </span>
      <ColumnaRueda
        etiqueta={`Minutos de ${etiqueta}`}
        valores={MINUTOS}
        valor={valor.minuto}
        onChange={(minuto) => onChange({ ...valor, minuto })}
      />
    </div>
  );
}
