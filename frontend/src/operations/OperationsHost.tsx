import { useEffect, useMemo } from "react";
import {
  NotificationHost,
  type NotificationAction,
  type NotificationItem,
} from "../components/NotificationCenter";
import { MovSynerPosProgress } from "../components/MovSynerPosProgress";
import { OperationProgressDialog } from "../components/OperationProgressDialog";
import { SunatProgress } from "../components/SunatProgress";
import { useOperations } from "./OperationsContext";

const SUNAT_RISK =
  "Si cancelas ahora, se detendrá el envío de lotes pendientes y el seguimiento en pantalla. Los lotes que ya fueron registrados en el servidor seguirán procesándose en segundo plano para evitar inconsistencias o cobros duplicados de cuota.";

const MOVSYNERPOS_RISK =
  "Si cancelas ahora, los documentos de los lotes que ya fueron insertados en MovSynerPos permanecerán guardados (la operación no se revierte) y los documentos restantes quedarán pendientes de envío.";

/** Evita perder el seguimiento con un refresh accidental mientras corre. */
function useBeforeUnloadGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}

function retryFailedAction(
  count: number,
  onRetry: () => void,
): NotificationAction | undefined {
  if (count <= 0) return undefined;
  return { label: `Reintentar ${count} fallidos`, onClick: onRetry };
}

/**
 * Único punto de presentación de las operaciones largas.
 *
 * - Un solo modal por operación (vive fuera de las páginas y sobrevive al
 *   cambio de pestaña).
 * - El error y la advertencia se muestran **dentro** del modal: mientras está
 *   abierto, `@base-ui` aplica `aria-hidden` fuera del portal y atrapa el foco,
 *   así que un toast flotante quedaría inaccesible.
 * - Si el usuario cierra el modal, el resultado (error/warning/aviso) pasa a
 *   la bandeja flotante.
 */
export function OperationsHost() {
  const { sunat, movsynerpos } = useOperations();

  useBeforeUnloadGuard(sunat.busy || movsynerpos.busy);

  const {
    progress: sunatProgress,
    error: sunatError,
    warning: sunatWarning,
    notice: sunatNotice,
    busy: sunatBusy,
    refreshing: sunatRefreshing,
  } = sunat;
  const {
    progress: movProgress,
    error: movError,
    warning: movWarning,
    notice: movNotice,
    busy: movBusy,
    refreshing: movRefreshing,
    failed: movFailed,
    retry: retryMov,
  } = movsynerpos;
  const failedCount = movFailed.length;

  const items = useMemo<NotificationItem[]>(() => {
    const list: NotificationItem[] = [];

    if (!sunatProgress && sunatError) {
      list.push({
        id: "sunat-error",
        signature: `sunat-error:${sunatError}`,
        tone: "error",
        title: "No se pudo validar en SUNAT",
        description: sunatError,
      });
    }

    if (!sunatProgress && sunatWarning) {
      list.push({
        id: "sunat-warning",
        signature: `sunat-warning:${sunatWarning}`,
        tone: "warning",
        title: "Validación en SUNAT",
        description: sunatWarning,
      });
    }

    if (!sunatBusy && !sunatRefreshing && sunatNotice) {
      list.push({
        id: "sunat-notice",
        signature: `sunat-notice:${sunatNotice}`,
        tone: "info",
        title: "Validación en SUNAT",
        description: sunatNotice,
      });
    }

    if (!movProgress && movError) {
      list.push({
        id: "movsynerpos-error",
        signature: `mov-error:${movError}:${failedCount}`,
        tone: "error",
        title: "No se pudo enviar a MovSynerPos",
        description: movError,
        action: retryFailedAction(failedCount, () => void retryMov()),
      });
    }

    if (!movProgress && movWarning) {
      list.push({
        id: "movsynerpos-warning",
        signature: `mov-warning:${movWarning}:${failedCount}`,
        tone: "warning",
        title: "Observaciones en MovSynerPos",
        description: movWarning,
        action: retryFailedAction(failedCount, () => void retryMov()),
      });
    }

    if (!movBusy && !movRefreshing && movNotice) {
      list.push({
        id: "movsynerpos-notice",
        signature: `mov-notice:${movNotice}`,
        tone: "info",
        title: "Envío a MovSynerPos",
        description: movNotice,
      });
    }

    return list;
  }, [
    sunatProgress,
    sunatError,
    sunatWarning,
    sunatNotice,
    sunatBusy,
    sunatRefreshing,
    movProgress,
    movError,
    movWarning,
    movNotice,
    movBusy,
    movRefreshing,
    failedCount,
    retryMov,
  ]);

  return (
    <>
      <OperationProgressDialog
        open={Boolean(sunatProgress)}
        status={sunat.status}
        title="Progreso de validación en SUNAT"
        description="Consultando el estado de los comprobantes seleccionados contra SUNAT."
        riskDescription={SUNAT_RISK}
        onCancel={() => {
          void sunat.cancel();
        }}
        onClose={sunat.dismissProgress}
      >
        <SunatProgress
          progress={sunatProgress}
          notice={sunatNotice}
          warning={sunatWarning}
          error={sunatError}
        />
      </OperationProgressDialog>

      <OperationProgressDialog
        open={Boolean(movProgress)}
        status={movsynerpos.status}
        title="Progreso de envío a MovSynerPos"
        description="Reconsultando documentos en SynerCom e insertando líneas en MovSynerPos."
        riskDescription={MOVSYNERPOS_RISK}
        onCancel={() => {
          void movsynerpos.cancel();
        }}
        onClose={movsynerpos.dismissProgress}
      >
        <MovSynerPosProgress
          progress={movProgress}
          notice={movNotice}
          warning={movWarning}
          error={movError}
          failedCount={movsynerpos.failed.length}
          running={movsynerpos.status === "running"}
          onRetry={() => {
            void movsynerpos.retry();
          }}
        />
      </OperationProgressDialog>

      <NotificationHost items={items} />
    </>
  );
}
