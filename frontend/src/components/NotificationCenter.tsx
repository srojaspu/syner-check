import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  CheckmarkCircle01Icon,
  InformationCircleIcon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type NotificationTone = "info" | "success" | "warning" | "error";

export interface NotificationItem {
  /** Clave estable de la fuente (ej. "synerpos-error", "ufe-reenvio"). */
  id: string;
  /** Huella del estado actual: si cambia, la notificación vuelve a mostrarse. */
  signature: string;
  tone: NotificationTone;
  /** Contenido de la notificación (alerta de info, warning o error). */
  content: ReactNode;
  /** Si el contenido ya incluye su propio botón de cierre (ej. IntelisisUfeReenvioAviso). */
  hideCloseButton?: boolean;
  /** No se cierra sola: el usuario decide cuándo (errores, avisos auditables). */
  persistent?: boolean;
  /** Tiempo de auto-cierre propio; gana sobre el valor por severidad. */
  autoDismissMs?: number;
  /** Callback opcional al cerrar la notificación. */
  onDismiss?: () => void;
}

/** Tiempo (ms) tras el cual una notificación se oculta sola si nadie la cerró. */
export const AUTO_DISMISS_MS = 7000;

/**
 * TTL por severidad: un error no debe desaparecer antes de que el usuario lo
 * lea, y un aviso auditable (rechazos, validaciones) tampoco.
 */
const DISMISS_BY_TONE: Record<NotificationTone, number> = {
  error: 0,
  warning: 12000,
  info: AUTO_DISMISS_MS,
  success: AUTO_DISMISS_MS,
};

export function autoDismissFor(item: NotificationItem): number {
  if (item.persistent) return 0;
  if (item.autoDismissMs !== undefined) return item.autoDismissMs;
  return DISMISS_BY_TONE[item.tone];
}

function NotificationCard({
  item,
  autoDismissMs,
  onDismiss,
}: {
  item: NotificationItem;
  autoDismissMs: number;
  onDismiss: (item: NotificationItem) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const showCloseButton = !item.hideCloseButton;

  // El temporizador se reinicia solo cuando cambia la firma del estado, no en
  // cada render del padre (antes cualquier actualización de progreso lo
  // reiniciaba y la notificación nunca llegaba a cerrarse).
  const itemRef = useRef(item);
  itemRef.current = item;

  useEffect(() => {
    if (paused || autoDismissMs <= 0) return;
    const timer = setTimeout(() => {
      onDismiss(itemRef.current);
    }, autoDismissMs);
    return () => clearTimeout(timer);
  }, [item.signature, paused, autoDismissMs, onDismiss]);


  return (
    <div
      data-slot="notification-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        // Mover el foco dentro de la tarjeta no reanuda el temporizador.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        setFocused(false);
      }}
      className={cn(
        "pointer-events-auto relative w-full overflow-hidden rounded-lg bg-popover/95 shadow-2xl ring-1 ring-foreground/10 backdrop-blur-md transition-all duration-200 ease-out motion-reduce:transition-none",
        "[&_[data-slot=alert]]:border-0",
        showCloseButton && "[&_[data-slot=alert]]:pr-11",
      )}
    >
      {item.content}
      {showCloseButton ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-2.5 right-2.5 z-10 text-muted-foreground hover:text-foreground"
          onClick={() => onDismiss(item)}
          aria-label="Cerrar notificación"
          title="Cerrar notificación"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Contenedor único de la bandeja.
 *
 * Varias pantallas (y el host de operaciones) publican avisos a la vez; si cada
 * una fijara su propia columna en la misma esquina, se solaparían. Compartiendo
 * un contenedor fijo, las tarjetas se apilan en orden de montaje.
 */
const TRAY_ID = "notification-tray";

function notificationTray(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const existing = document.getElementById(TRAY_ID);
  if (existing) return existing;
  const tray = document.createElement("div");
  tray.id = TRAY_ID;
  tray.className =
    "pointer-events-none fixed right-4 bottom-4 z-40 flex max-h-[82vh] w-[calc(100vw-2rem)] max-w-md flex-col gap-2.5 overflow-y-auto print:hidden";
  document.body.appendChild(tray);
  return tray;
}

/**
 * Bandeja flotante de notificaciones para info, warnings y errores.
 *
 * El progreso de operaciones largas vive en `OperationProgressDialog` (modal),
 * manteniendo las notificaciones limpias y enfocadas en avisos e incidencias.
 */
export function NotificationHost({
  items,
  autoDismissMs,
}: {
  items: NotificationItem[];
  /** Fuerza el mismo TTL para todas las tarjetas (tests, demos). */
  autoDismissMs?: number;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const handleDismiss = useCallback((item: NotificationItem) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(item.signature);
      return next;
    });
    item.onDismiss?.();
  }, []);

  // Una firma descartada solo debe seguir silenciada mientras el estado que la
  // produjo siga vivo. Si el origen se limpia y el mismo aviso vuelve (mismo
  // error al reintentar), tiene que mostrarse otra vez.
  useEffect(() => {
    const alive = new Set(items.map((item) => item.signature));
    setDismissed((prev) => {
      if (!prev.size) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const signature of prev) {
        if (alive.has(signature)) next.add(signature);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [items]);

  const visibleItems = items.filter((item) => !dismissed.has(item.signature));

  const tray = notificationTray();
  if (!tray || !visibleItems.length) return null;

  return createPortal(
    <div
      role="region"
      aria-label="Notificaciones"
      className="flex flex-col gap-2.5"
    >
      {visibleItems.map((item) => (
        <NotificationCard
          key={item.id}
          item={item}
          autoDismissMs={autoDismissMs ?? autoDismissFor(item)}
          onDismiss={handleDismiss}
        />
      ))}
    </div>,
    tray,
  );
}

/** Tarjeta de alerta estándar para mensajes de info, warning, éxito o error. */
export function NotificationAlert({
  tone,
  title,
  description,
}: {
  tone: NotificationTone;
  title?: string;
  description: ReactNode;
}) {
  const destructive = tone === "error" || tone === "warning";
  const variant =
    tone === "error" ? "destructive" : tone === "warning" ? "warning" : "default";
  const icon =
    tone === "error" || tone === "warning"
      ? TriangleAlertIcon
      : tone === "success"
        ? CheckmarkCircle01Icon
        : InformationCircleIcon;
  // Errores y advertencias interrumpen; info/éxito se anuncian en modo cortés.
  const role = destructive ? "alert" : "status";

  return (
    <Alert variant={variant} role={role}>
      <HugeiconsIcon icon={icon} strokeWidth={2} />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}
