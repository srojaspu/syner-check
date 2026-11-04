import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useSonner } from "sonner";
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
import { Toaster, toast } from "@/components/ui/sonner";

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
  /** No se cierra sola: el usuario decide cuándo. */
  persistent?: boolean;
  /** Tiempo de auto-cierre propio; gana sobre el valor por severidad. */
  autoDismissMs?: number;
  /** Callback opcional al cerrar la notificación. */
  onDismiss?: () => void;
}

/** Tiempo (ms) tras el cual una notificación se oculta sola si nadie la cerró. */
export const AUTO_DISMISS_MS = 5000;

/**
 * TTL por severidad: todas las notificaciones (incluidos errores y warnings)
 * desaparecen automáticamente tras unos segundos salvo que se marquen como
 * `persistent`.
 */
const DISMISS_BY_TONE: Record<NotificationTone, number> = {
  error: AUTO_DISMISS_MS,
  warning: AUTO_DISMISS_MS,
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
  // cada render del padre.
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
          onClick={() => onDismiss(itemRef.current)}
          aria-label="Cerrar notificación"
          title="Cerrar notificación"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
        </Button>
      ) : null}
    </div>
  );
}

interface ActiveCardEntry {
  item: NotificationItem;
  ttl: number;
  onDismiss: (item: NotificationItem) => void;
}

const activeCards = new Map<string, ActiveCardEntry>();
const cardListeners = new Set<() => void>();

function notifyCardListeners() {
  for (const listener of cardListeners) listener();
}

function subscribeCards(listener: () => void) {
  cardListeners.add(listener);
  return () => {
    cardListeners.delete(listener);
  };
}

function SonnerToastSlot({ toastId }: { toastId: string }) {
  const entry = useSyncExternalStore(
    subscribeCards,
    () => activeCards.get(toastId),
    () => activeCards.get(toastId),
  );
  if (!entry) return null;
  return (
    <NotificationCard
      item={entry.item}
      autoDismissMs={entry.ttl}
      onDismiss={entry.onDismiss}
    />
  );
}

/**
 * Contenedor único de la bandeja y propietario único de `<Toaster />` (Sonner).
 */
const TRAY_ID = "notification-tray";
const activeHosts = new Set<string>();
const hostListeners = new Set<() => void>();

function notifyHostListeners() {
  for (const listener of hostListeners) listener();
}

function useIsPrimaryToasterHost(hostId: string): boolean {
  const [, setTick] = useState(0);

  useEffect(() => {
    activeHosts.add(hostId);
    const listener = () => setTick((n) => n + 1);
    hostListeners.add(listener);
    notifyHostListeners();
    return () => {
      activeHosts.delete(hostId);
      hostListeners.delete(listener);
      notifyHostListeners();
    };
  }, [hostId]);

  const first = activeHosts.values().next().value;
  return first === hostId || first === undefined;
}

function notificationTray(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const existing = document.getElementById(TRAY_ID);
  if (existing) return existing;
  const tray = document.createElement("div");
  tray.id = TRAY_ID;
  tray.setAttribute("role", "region");
  tray.setAttribute("aria-label", "Notificaciones");
  tray.className =
    "pointer-events-none fixed right-4 bottom-4 z-40 flex max-h-[82vh] w-[calc(100vw-2rem)] max-w-md flex-col gap-2.5 overflow-y-auto print:hidden";
  document.body.appendChild(tray);
  return tray;
}

/**
 * Bandeja flotante de notificaciones integrada con `@shadcn/sonner`.
 *
 * El progreso de operaciones largas vive en `OperationProgressDialog` (modal),
 * manteniendo las notificaciones limpias y con auto-cierre automático.
 */
export function NotificationHost({
  items,
  autoDismissMs,
}: {
  items: NotificationItem[];
  /** Fuerza el mismo TTL para todas las tarjetas (tests, demos). */
  autoDismissMs?: number;
}) {
  const hostId = useId();
  const isPrimaryHost = useIsPrimaryToasterHost(hostId);
  const { toasts: sonnerToasts } = useSonner();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const dismissedRef = useRef<Set<string>>(new Set());
  const activeToastIdsRef = useRef<Set<string>>(new Set());

  const handleDismiss = useCallback(
    (item: NotificationItem) => {
      if (dismissedRef.current.has(item.signature)) return;
      dismissedRef.current.add(item.signature);
      const toastId = `${hostId}:${item.id}`;
      activeCards.delete(toastId);
      notifyCardListeners();
      setDismissed((prev) => {
        if (prev.has(item.signature)) return prev;
        const next = new Set(prev);
        next.add(item.signature);
        return next;
      });
      toast.dismiss(toastId);
      item.onDismiss?.();
    },
    [hostId],
  );

  // Una firma descartada solo debe seguir silenciada mientras el estado que la
  // produjo siga vivo. Si el origen se limpia y el mismo aviso vuelve (mismo
  // error al reintentar), tiene que mostrarse otra vez.
  useEffect(() => {
    const alive = new Set(items.map((item) => item.signature));
    for (const signature of [...dismissedRef.current]) {
      if (!alive.has(signature)) dismissedRef.current.delete(signature);
    }
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

  // Sincroniza las notificaciones visibles con Sonner (`toast.custom` / `toast.dismiss`).
  useLayoutEffect(() => {
    const currentSet = activeToastIdsRef.current;
    const nextIds = new Set<string>();

    for (const item of visibleItems) {
      const toastId = `${hostId}:${item.id}`;
      nextIds.add(toastId);
      const ttl = autoDismissMs ?? autoDismissFor(item);
      activeCards.set(toastId, { item, ttl, onDismiss: handleDismiss });

      if (!currentSet.has(toastId)) {
        currentSet.add(toastId);
        toast.custom(() => <SonnerToastSlot toastId={toastId} />, {
          id: toastId,
          duration: ttl <= 0 ? Infinity : ttl,
          onAutoClose: () => handleDismiss(item),
          onDismiss: () => handleDismiss(item),
        });
      }
    }

    for (const toastId of [...currentSet]) {
      if (!nextIds.has(toastId)) {
        currentSet.delete(toastId);
        activeCards.delete(toastId);
        toast.dismiss(toastId);
      }
    }
    notifyCardListeners();
  }, [visibleItems, autoDismissMs, hostId, handleDismiss]);

  useEffect(() => {
    const currentSet = activeToastIdsRef.current;
    return () => {
      for (const toastId of currentSet) {
        activeCards.delete(toastId);
        toast.dismiss(toastId);
      }
      currentSet.clear();
      notifyCardListeners();
    };
  }, []);

  const tray = notificationTray();
  if (!tray) return null;

  const mountedInSonner = new Set(
    sonnerToasts
      .filter((t) => !(t as { delete?: boolean }).delete)
      .map((t) => String(t.id)),
  );
  const pendingItems = visibleItems.filter(
    (item) => !mountedInSonner.has(`${hostId}:${item.id}`),
  );

  if (!isPrimaryHost && !pendingItems.length) return null;

  return createPortal(
    <>
      {isPrimaryHost ? <Toaster /> : null}
      {pendingItems.length ? (
        <div className="flex flex-col gap-2.5">
          {pendingItems.map((item) => (
            <NotificationCard
              key={item.id}
              item={item}
              autoDismissMs={autoDismissMs ?? autoDismissFor(item)}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      ) : null}
    </>,
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
