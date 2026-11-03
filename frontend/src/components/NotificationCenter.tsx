import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
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
  /** Callback opcional al cerrar la notificación. */
  onDismiss?: () => void;
}

/** Tiempo (ms) tras el cual una notificación se oculta sola si nadie la cerró. */
export const AUTO_DISMISS_MS = 7000;

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
  const showCloseButton = !item.hideCloseButton;

  useEffect(() => {
    if (hovered || autoDismissMs <= 0) return;
    const timer = setTimeout(() => {
      onDismiss(item);
    }, autoDismissMs);
    return () => clearTimeout(timer);
  }, [item, hovered, autoDismissMs, onDismiss]);

  return (
    <div
      data-slot="notification-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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
 * Bandeja flotante de notificaciones para info, warnings y errores.
 *
 * El progreso de operaciones largas vive en `OperationProgressDialog` (modal),
 * manteniendo las notificaciones limpias y enfocadas en avisos e incidencias.
 */
export function NotificationHost({
  items,
  autoDismissMs = AUTO_DISMISS_MS,
}: {
  sourceId?: string;
  items: NotificationItem[];
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

  const visibleItems = items.filter((item) => !dismissed.has(item.signature));

  if (!visibleItems.length) return null;

  return (
    <div
      role="region"
      aria-label="Notificaciones"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[60] flex max-h-[82vh] w-[calc(100vw-2rem)] max-w-md flex-col gap-2.5 overflow-y-auto print:hidden"
    >
      {visibleItems.map((item) => (
        <NotificationCard
          key={item.id}
          item={item}
          autoDismissMs={autoDismissMs}
          onDismiss={handleDismiss}
        />
      ))}
    </div>
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
  const icon =
    tone === "error" || tone === "warning"
      ? TriangleAlertIcon
      : tone === "success"
        ? CheckmarkCircle01Icon
        : InformationCircleIcon;

  return (
    <Alert variant={destructive ? "destructive" : "default"}>
      <HugeiconsIcon icon={icon} strokeWidth={2} />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}
