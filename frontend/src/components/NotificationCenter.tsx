import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Toaster, toast } from "@/components/ui/sonner";

export type NotificationTone = "info" | "success" | "warning" | "error";

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface NotificationItem {
  /** Clave estable de la fuente (ej. "synerpos-error", "ufe-reenvio"). */
  id: string;
  /** Huella del estado actual: si cambia, la notificación vuelve a mostrarse. */
  signature: string;
  tone: NotificationTone;
  title: string;
  description?: ReactNode;
  /** Botón de acción del toast (ej. "Reintentar"). */
  action?: NotificationAction;
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

/**
 * Región accesible que aloja el único `<Toaster />`. Vive en `body` para que
 * ocultar una página (`hidden`) no oculte también los avisos.
 */
const TRAY_ID = "notification-tray";

function notificationTray(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const existing = document.getElementById(TRAY_ID);
  if (existing) return existing;
  const tray = document.createElement("div");
  tray.id = TRAY_ID;
  tray.setAttribute("role", "region");
  tray.setAttribute("aria-label", "Notificaciones");
  tray.className = "print:hidden";
  document.body.appendChild(tray);
  return tray;
}

const AppToasterContext = createContext(false);

/**
 * Monta el `<Toaster />` una sola vez en la raíz de la app (patrón de
 * shadcn). Con él presente, ningún `NotificationHost` monta el suyo.
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const tray = notificationTray();
  return (
    <AppToasterContext.Provider value={true}>
      {children}
      {tray ? createPortal(<Toaster />, tray) : null}
    </AppToasterContext.Provider>
  );
}

/*
 * Respaldo para cuando no hay `NotificationProvider` (pantallas montadas
 * sueltas, tests): el primer host registrado es el único dueño del Toaster.
 * Sonner reenvía los toasts activos a cada Toaster que se suscribe, así que
 * no se pierde nada si el dueño cambia.
 */
const activeHosts = new Set<string>();
const hostListeners = new Set<() => void>();

function notifyHostListeners() {
  for (const listener of hostListeners) listener();
}

function useOwnsFallbackToaster(hostId: string, enabled: boolean): boolean {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    activeHosts.add(hostId);
    const listener = () => setTick((n) => n + 1);
    hostListeners.add(listener);
    notifyHostListeners();
    return () => {
      activeHosts.delete(hostId);
      hostListeners.delete(listener);
      notifyHostListeners();
    };
  }, [hostId, enabled]);

  return enabled && activeHosts.values().next().value === hostId;
}

/**
 * Sincroniza una lista declarativa de avisos con Sonner.
 *
 * Cada aviso es un toast nativo (título, descripción y acción), con su propio
 * temporizador: se apilan, se expanden al pasar el cursor y se cierran de
 * forma independiente. El progreso de operaciones largas vive en
 * `OperationProgressDialog` (modal).
 */
export function NotificationHost({
  items,
  autoDismissMs,
}: {
  items: NotificationItem[];
  /** Fuerza el mismo TTL para todos los avisos (tests, demos). */
  autoDismissMs?: number;
}) {
  const hostId = useId();
  const hasAppToaster = useContext(AppToasterContext);
  const ownsToaster = useOwnsFallbackToaster(hostId, !hasAppToaster);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const dismissedRef = useRef<Set<string>>(new Set());
  /** toastId -> firma mostrada, para saber qué crear, actualizar o cerrar. */
  const shownRef = useRef<Map<string, string>>(new Map());

  const handleDismiss = useCallback(
    (item: NotificationItem) => {
      if (dismissedRef.current.has(item.signature)) return;
      dismissedRef.current.add(item.signature);
      shownRef.current.delete(`${hostId}:${item.id}`);
      setDismissed((prev) => {
        if (prev.has(item.signature)) return prev;
        const next = new Set(prev);
        next.add(item.signature);
        return next;
      });
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

  useLayoutEffect(() => {
    const shown = shownRef.current;
    const nextIds = new Set<string>();

    for (const item of items) {
      if (dismissed.has(item.signature)) continue;
      const toastId = `${hostId}:${item.id}`;
      nextIds.add(toastId);
      if (shown.get(toastId) === item.signature) continue;
      shown.set(toastId, item.signature);

      const ttl = autoDismissMs ?? autoDismissFor(item);
      toast[item.tone](item.title, {
        id: toastId,
        description: item.description,
        // Sonner cierra el toast al pulsar la acción sin llamar a onDismiss.
        action: item.action && {
          label: item.action.label,
          onClick: () => {
            item.action?.onClick();
            handleDismiss(item);
          },
        },
        duration: ttl <= 0 ? Infinity : ttl,
        // Sin auto-cierre, el usuario necesita una forma visible de cerrarlo.
        closeButton: ttl <= 0,
        onAutoClose: () => handleDismiss(item),
        onDismiss: () => handleDismiss(item),
      });
    }

    for (const toastId of [...shown.keys()]) {
      if (!nextIds.has(toastId)) {
        shown.delete(toastId);
        toast.dismiss(toastId);
      }
    }
  }, [items, dismissed, autoDismissMs, hostId, handleDismiss]);

  useEffect(() => {
    const shown = shownRef.current;
    return () => {
      for (const toastId of shown.keys()) toast.dismiss(toastId);
      shown.clear();
    };
  }, []);

  if (!ownsToaster) return null;
  const tray = notificationTray();
  return tray ? createPortal(<Toaster />, tray) : null;
}
