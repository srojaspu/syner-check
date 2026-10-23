import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { IntelisisReenvioResultado } from "../api/types";

interface IntelisisUfeReenvioAvisoProps {
  resultado: IntelisisReenvioResultado | null;
  aviso: string | null;
  onCerrar: () => void;
}

/**
 * Aviso de la última acción sobre la cola.
 *
 * El detalle por documento importa: el lote no es atómico y un documento
 * rechazado (por estado, por duplicado o por la guarda del ERP) no bloquea a
 * los demás.
 */
export function IntelisisUfeReenvioAviso({
  resultado,
  aviso,
  onCerrar,
}: IntelisisUfeReenvioAvisoProps) {
  if (!resultado && !aviso) return null;
  const rechazados = resultado?.detalle.filter(
    (item) => item.estado === "rechazado",
  );

  return (
    <Alert>
      <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
      <AlertTitle>
        {resultado
          ? resultado.encolados
            ? "Reenvío encolado"
            : "Sin cambios en la cola"
          : "Cola actualizada"}
      </AlertTitle>
      <AlertDescription>
        {resultado ? (
          <p>
            {resultado.encolados
              ? `${resultado.encolados} en cola`
              : "No se encoló nada nuevo"}
            {resultado.duplicados
              ? ` · ${resultado.duplicados} ya registrados (mismo token)`
              : ""}
            {resultado.rechazados ? ` · ${resultado.rechazados} rechazados` : ""}
            {resultado.encolados
              ? ". El worker del ERP los procesará en su próxima vuelta."
              : "."}
          </p>
        ) : (
          <p>{aviso}</p>
        )}
        {rechazados?.length ? (
          <ul className="mt-2 list-disc pl-4">
            {rechazados.map((item) => (
              <li key={`${item.id_venta}-${item.documento}`}>
                <b>{item.documento || `#${item.id_venta}`}</b>: {item.motivo}
              </li>
            ))}
          </ul>
        ) : null}
      </AlertDescription>
      <AlertAction>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onCerrar}
          aria-label="Cerrar el aviso"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={2} />
        </Button>
      </AlertAction>
    </Alert>
  );
}
