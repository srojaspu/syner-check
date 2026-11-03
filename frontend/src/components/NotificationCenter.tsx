import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  CheckmarkCircle01Icon,
  InformationCircleIcon,
  Loading02Icon,
  Notification03Icon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToastProvider } from "@/components/ui/toast";

export type NotificationTone = "info" | "success" | "warning" | "error";

export interface NotificationItem {
  /** Clave estable de la fuente (ej. "sunat", "movsynerpos", "ufe-reenvio"). */
  id: string;
  /** Huella del estado actual: si cambia, la tarjeta vuelve a mostrarse. */
  signature: string;
  tone: NotificationTone;
  /** True mientras la operación (SUNAT / MovSynerPos / Reenvío) está en curso. */
  running?: boolean;
  /** Etiqueta corta para el centro de notificaciones en el TopBar. */
  summary: string;
  /** Contenido rico (barra de progreso, contadores, alertas o acciones). */
  content: ReactNode;
  /** Si el contenido ya incluye su propio botón de cierre (ej. IntelisisUfeReenvioAviso). */
  hideCloseButton?: boolean;
  /** Callback opcional al cerrar definitivamente la notificación. */
  onDismiss?: () => void;
}

interface NotificationsContextValue {
  items: NotificationItem[];
  setSourceItems: (sourceId: string, next: NotificationItem[]) => void;
  dismissed: ReadonlySet<string>;
  dismiss: (signature: string, onDismiss?: () => void) => void;
  restoreAll: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(
  null,
);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [bySource, setBySource] = useState<Record<string, NotificationItem[]>>(
    {},
  );
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const setSourceItems = useCallback(
    (sourceId: string, next: NotificationItem[]) => {
      setBySource((prev) => {
        if (!next.length && !(sourceId in prev)) return prev;
        const copy = { ...prev };
        if (!next.length) {
          delete copy[sourceId];
        } else {
          copy[sourceId] = next;
        }
        return copy;
      });
    },
    [],
  );

  const dismiss = useCallback((signature: string, onDismiss?: () => void) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(signature);
      return next;
    });
    onDismiss?.();
  }, []);

  const restoreAll = useCallback(() => {
    setDismissed(new Set());
  }, []);

  const items = useMemo(() => Object.values(bySource).flat(), [bySource]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      items,
      setSourceItems,
      dismissed,
      dismiss,
      restoreAll,
    }),
    [items, setSourceItems, dismissed, dismiss, restoreAll],
  );

  return (
    <ToastProvider>
      <NotificationsContext.Provider value={value}>
        {children}
      </NotificationsContext.Provider>
    </ToastProvider>
  );
}

function toneBadgeVariant(
  tone: NotificationTone,
): "default" | "secondary" | "outline" | "destructive" {
  if (tone === "error" || tone === "warning") return "destructive";
  if (tone === "success") return "default";
  return "secondary";
}

function toneLabel(tone: NotificationTone, running?: boolean): string {
  if (running) return "En curso";
  if (tone === "error") return "Error";
  if (tone === "warning") return "Atención";
  if (tone === "success") return "Listo";
  return "Aviso";
}

/**
 * Botón en el TopBar que muestra el estado global de operaciones en curso y
 * permite reabrir notificaciones minimizadas o revisar la actividad actual.
 */
export function NotificationBell() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) return null;

  const { items, dismissed, restoreAll } = ctx;
  const runningCount = items.filter((item) => item.running).length;
  const issueCount = items.filter(
    (item) => item.tone === "error" || item.tone === "warning",
  ).length;
  const hiddenCount = items.filter((item) =>
    dismissed.has(item.signature),
  ).length;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="relative gap-1.5"
            aria-label="Centro de notificaciones y progreso"
            title="Notificaciones y procesos en segundo plano"
          />
        }
      >
        {runningCount > 0 ? (
          <HugeiconsIcon
            icon={Loading02Icon}
            size={16}
            strokeWidth={2}
            className="animate-spin text-primary"
            aria-hidden
          />
        ) : (
          <HugeiconsIcon
            icon={Notification03Icon}
            size={16}
            strokeWidth={2}
            aria-hidden
          />
        )}
        {items.length > 0 ? (
          <Badge
            variant={issueCount > 0 ? "destructive" : "secondary"}
            className="h-5 min-w-5 px-1.5 tabular-nums"
          >
            {items.length}
          </Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 sm:w-96">
        <PopoverHeader>
          <div className="flex items-center justify-between gap-2">
            <PopoverTitle>Notificaciones y procesos</PopoverTitle>
            {hiddenCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={restoreAll}
              >
                Mostrar en pantalla ({hiddenCount})
              </Button>
            ) : null}
          </div>
          <PopoverDescription>
            El progreso de validación SUNAT, MovSynerPos y cola de reenvíos se
            ejecuta aquí sin bloquear la pantalla.
          </PopoverDescription>
        </PopoverHeader>

        {items.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted-foreground">
            No hay procesos ni notificaciones activas.
          </p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs"
              >
                <span className="min-w-0 flex-1 break-words">
                  {item.summary}
                </span>
                <Badge variant={toneBadgeVariant(item.tone)}>
                  {toneLabel(item.tone, item.running)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Tiempo (ms) tras el cual una notificación finalizada se oculta sola. */
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
  const showCloseButton = !item.running && !item.hideCloseButton;

  useEffect(() => {
    if (item.running || hovered || autoDismissMs <= 0) return;
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
 * Bandeja flotante no-bloqueante (z-[60], sobre el Sheet de detalle z-50).
 *
 * Funciona tanto conectada al `NotificationsProvider` de `App` como cuando una
 * página se renderiza de forma aislada en los tests.
 */
export function NotificationHost({
  sourceId,
  items,
  autoDismissMs = AUTO_DISMISS_MS,
}: {
  sourceId: string;
  items: NotificationItem[];
  autoDismissMs?: number;
}) {
  const ctx = useContext(NotificationsContext);
  const [localDismissed, setLocalDismissed] = useState<Set<string>>(
    () => new Set(),
  );

  const setSourceItems = ctx?.setSourceItems;

  useEffect(() => {
    if (!setSourceItems) return;
    setSourceItems(sourceId, items);
  }, [setSourceItems, sourceId, items]);

  useEffect(() => {
    if (!setSourceItems) return;
    return () => setSourceItems(sourceId, []);
  }, [setSourceItems, sourceId]);

  const dismissed = ctx ? ctx.dismissed : localDismissed;
  const handleDismiss = useCallback(
    (item: NotificationItem) => {
      if (ctx) {
        ctx.dismiss(item.signature, item.onDismiss);
        return;
      }
      setLocalDismissed((prev) => {
        const next = new Set(prev);
        next.add(item.signature);
        return next;
      });
      item.onDismiss?.();
    },
    [ctx],
  );

  const visibleItems = items.filter(
    (item) => !dismissed.has(item.signature),
  );

  if (!visibleItems.length) return null;

  return (
    <div
      role="region"
      aria-label="Notificaciones y progreso"
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

/** Tarjeta de alerta estándar para mensajes simples (errores, warnings, avisos). */
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
