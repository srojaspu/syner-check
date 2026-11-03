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
import { Progress } from "@/components/ui/progress";
import { ToastProvider } from "@/components/ui/toast";

export type NotificationTone = "info" | "success" | "warning" | "error";

export interface NotificationItem {
  /** Clave estable de la fuente (ej. "synerpos-sunat", "ufe-reenvio"). */
  id: string;
  /** Huella del estado actual: si cambia, la tarjeta vuelve a mostrarse. */
  signature: string;
  tone: NotificationTone;
  /** True mientras la operación (SUNAT / MovSynerPos / Reenvío) está en curso. */
  running?: boolean;
  /** Porcentaje opcional (0-100) para mostrar avance en el centro de notificaciones. */
  progressPercent?: number;
  /** Pestaña de origen (ej. "SynerPos" o "Intelisis UFE"). */
  originLabel?: string;
  /** Hash de navegación hacia la pestaña de origen (ej. "#/comprobantes"). */
  originHref?: string;
  /** Etiqueta corta para el centro de notificaciones en el TopBar. */
  summary: string;
  /** Contenido rico (barra de progreso, contadores, alertas o acciones). */
  content: ReactNode;
  /** Si el contenido ya incluye su propio botón de cierre (ej. IntelisisUfeReenvioAviso). */
  hideCloseButton?: boolean;
  /** Callback opcional al cerrar manualmente la notificación. */
  onDismiss?: () => void;
}

/** Tiempo (ms) tras el cual una notificación finalizada se oculta sola de la esquina. */
export const AUTO_DISMISS_MS = 7000;

interface NotificationsContextValue {
  items: NotificationItem[];
  setSourceItems: (sourceId: string, next: NotificationItem[]) => void;
  dismissed: ReadonlySet<string>;
  dismiss: (signature: string, onDismiss?: () => void) => void;
  restoreItem: (signature: string) => void;
  restoreAll: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(
  null,
);

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
  if (tone === "success") return "Completado";
  return "Aviso";
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

function NotificationTray({
  items,
  dismissed,
  autoDismissMs,
  onDismiss,
}: {
  items: NotificationItem[];
  dismissed: ReadonlySet<string>;
  autoDismissMs: number;
  onDismiss: (item: NotificationItem) => void;
}) {
  // Los procesos en curso (running: true) siempre permanecen visibles aunque
  // una firma previa haya sido descartada.
  const visibleItems = items.filter(
    (item) => item.running || !dismissed.has(item.signature),
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
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}

export function NotificationsProvider({
  children,
  autoDismissMs = AUTO_DISMISS_MS,
}: {
  children: ReactNode;
  autoDismissMs?: number;
}) {
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

  const restoreItem = useCallback((signature: string) => {
    setDismissed((prev) => {
      if (!prev.has(signature)) return prev;
      const next = new Set(prev);
      next.delete(signature);
      return next;
    });
  }, []);

  const restoreAll = useCallback(() => {
    setDismissed(new Set());
  }, []);

  const items = useMemo(() => Object.values(bySource).flat(), [bySource]);

  const handleTrayDismiss = useCallback(
    (item: NotificationItem) => {
      dismiss(item.signature, item.onDismiss);
    },
    [dismiss],
  );

  const value = useMemo<NotificationsContextValue>(
    () => ({
      items,
      setSourceItems,
      dismissed,
      dismiss,
      restoreItem,
      restoreAll,
    }),
    [items, setSourceItems, dismissed, dismiss, restoreItem, restoreAll],
  );

  return (
    <ToastProvider>
      <NotificationsContext.Provider value={value}>
        {children}
        <NotificationTray
          items={items}
          dismissed={dismissed}
          autoDismissMs={autoDismissMs}
          onDismiss={handleTrayDismiss}
        />
      </NotificationsContext.Provider>
    </ToastProvider>
  );
}

/**
 * Botón en el TopBar que muestra los procesos activos en segundo plano
 * (incluso al cambiar entre pestañas SynerPos <-> Intelisis UFE) y el
 * historial de notificaciones recientes.
 */
export function NotificationBell() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) return null;

  const { items, dismissed, restoreItem, restoreAll } = ctx;
  const runningItems = items.filter((item) => item.running);
  const completedItems = items.filter((item) => !item.running);
  const runningCount = runningItems.length;
  const issueCount = items.filter(
    (item) => item.tone === "error" || item.tone === "warning",
  ).length;
  const hiddenCount = completedItems.filter((item) =>
    dismissed.has(item.signature),
  ).length;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant={runningCount > 0 ? "secondary" : "ghost"}
            size="sm"
            className="relative gap-1.5"
            aria-label="Centro de notificaciones y progreso"
            title={
              runningCount > 0
                ? `${runningCount} proceso(s) ejecutándose en segundo plano`
                : "Notificaciones y procesos en segundo plano"
            }
          />
        }
      >
        {runningCount > 0 ? (
          <>
            <HugeiconsIcon
              icon={Loading02Icon}
              size={16}
              strokeWidth={2}
              className="animate-spin text-primary"
              aria-hidden
            />
            <span className="hidden text-xs font-medium sm:inline">
              En curso ({runningCount})
            </span>
          </>
        ) : (
          <HugeiconsIcon
            icon={Notification03Icon}
            size={16}
            strokeWidth={2}
            aria-hidden
          />
        )}
        {items.length > 0 && runningCount === 0 ? (
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
            Los procesos siguen ejecutándose en segundo plano aunque cambies de
            pestaña.
          </PopoverDescription>
        </PopoverHeader>

        {items.length === 0 ? (
          <p className="py-3 text-center text-sm text-muted-foreground">
            No hay procesos ni notificaciones activas.
          </p>
        ) : (
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
            {runningItems.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Procesos en segundo plano ({runningItems.length})
                </span>
                <ul className="flex flex-col gap-2">
                  {runningItems.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 font-medium">
                          <HugeiconsIcon
                            icon={Loading02Icon}
                            size={14}
                            strokeWidth={2}
                            className="animate-spin text-primary"
                            aria-hidden
                          />
                          {item.originLabel ? (
                            <Badge variant="outline">{item.originLabel}</Badge>
                          ) : null}
                        </span>
                        <Badge variant="secondary">En curso</Badge>
                      </div>
                      <span className="break-words text-foreground">
                        {item.summary}
                      </span>
                      {typeof item.progressPercent === "number" ? (
                        <Progress
                          value={item.progressPercent}
                          aria-label={`Avance ${item.originLabel ?? ""}`}
                        />
                      ) : null}
                      {item.originHref ? (
                        <div className="flex justify-end">
                          <a
                            href={item.originHref}
                            className="font-medium text-primary underline-offset-4 hover:underline"
                          >
                            Ir a {item.originLabel ?? "la pestaña"}
                          </a>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {completedItems.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Recientes ({completedItems.length})
                </span>
                <ul className="flex flex-col gap-2">
                  {completedItems.map((item) => {
                    const isHidden = dismissed.has(item.signature);
                    return (
                      <li
                        key={item.id}
                        className="flex flex-col gap-1.5 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            {item.originLabel ? (
                              <Badge variant="outline">
                                {item.originLabel}
                              </Badge>
                            ) : null}
                            <Badge variant={toneBadgeVariant(item.tone)}>
                              {toneLabel(item.tone, item.running)}
                            </Badge>
                          </div>
                          {isHidden ? (
                            <button
                              type="button"
                              className="font-medium text-primary underline-offset-2 hover:underline"
                              onClick={() => restoreItem(item.signature)}
                            >
                              Ver tarjeta
                            </button>
                          ) : null}
                        </div>
                        <span className="break-words text-muted-foreground">
                          {item.summary}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Conector de notificaciones de una pestaña.
 *
 * - Cuando está dentro de `NotificationsProvider` (`App`), registra los items
 *   en el centro global (sin borrar los procesos al ocultar la pestaña) y el
 *   provider renderiza un único `NotificationTray` global.
 * - Cuando se renderiza aislado en un test unitario sin provider, renderiza
 *   su propio `NotificationTray` local.
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

  const handleLocalDismiss = useCallback((item: NotificationItem) => {
    setLocalDismissed((prev) => {
      const next = new Set(prev);
      next.add(item.signature);
      return next;
    });
    item.onDismiss?.();
  }, []);

  if (ctx) {
    return null;
  }

  return (
    <NotificationTray
      items={items}
      dismissed={localDismissed}
      autoDismissMs={autoDismissMs}
      onDismiss={handleLocalDismiss}
    />
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
