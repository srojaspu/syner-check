import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { useMovSynerPos } from "../hooks/useMovSynerPos";
import { useSunat } from "../hooks/useSunat";

/**
 * Estado compartido de las operaciones largas.
 *
 * Vive por encima del ruteo para que un proceso lanzado en SynerPos no muera
 * al cambiar a Intelisis UFE (antes la página se desmontaba y el cleanup del
 * hook abortaba la petición en curso), y para que exista una sola instancia
 * del modal y de las notificaciones de operación.
 */
export interface OperationsValue {
  sunat: ReturnType<typeof useSunat>;
  movsynerpos: ReturnType<typeof useMovSynerPos>;
  /**
   * Verdadero mientras cualquiera de las dos operaciones corre o mantiene su
   * resultado abierto. Las páginas lo usan para no iniciar una segunda
   * operación (dos modales de progreso a la vez no son representables).
   */
  active: boolean;
}

const OperationsContext = createContext<OperationsValue | null>(null);

export function OperationsProvider({
  onAuthFailure,
  children,
}: {
  onAuthFailure: () => void;
  children: ReactNode;
}) {
  const sunat = useSunat(onAuthFailure);
  const movsynerpos = useMovSynerPos(onAuthFailure);
  const active =
    sunat.busy ||
    movsynerpos.busy ||
    sunat.refreshing ||
    movsynerpos.refreshing ||
    Boolean(sunat.progress) ||
    Boolean(movsynerpos.progress);
  const value = useMemo(
    () => ({ sunat, movsynerpos, active }),
    [sunat, movsynerpos, active],
  );

  return (
    <OperationsContext.Provider value={value}>
      {children}
    </OperationsContext.Provider>
  );
}

export function useOperations(): OperationsValue {
  const value = useContext(OperationsContext);
  if (!value) {
    throw new Error(
      "useOperations debe usarse dentro de <OperationsProvider>.",
    );
  }
  return value;
}
