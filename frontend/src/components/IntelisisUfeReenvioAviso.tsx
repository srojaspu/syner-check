import type { ReactNode } from "react";
import type { IntelisisReenvioResultado } from "../api/types";

/**
 * Título y descripción del aviso de la última acción sobre la cola.
 *
 * El detalle por documento importa: el lote no es atómico y un documento
 * rechazado (por estado, por duplicado o por la guarda del ERP) no bloquea a
 * los demás.
 */
export function reenvioAviso(
  resultado: IntelisisReenvioResultado | null,
  aviso: string | null,
): { title: string; description: ReactNode } {
  const title = resultado
    ? resultado.encolados
      ? "Reenvío encolado"
      : "Sin cambios en la cola"
    : "Cola actualizada";

  if (!resultado) return { title, description: aviso ?? "" };

  const rechazados = resultado.detalle.filter(
    (item) => item.estado === "rechazado",
  );
  const resumen =
    (resultado.encolados
      ? `${resultado.encolados} en cola`
      : "No se encoló nada nuevo") +
    (resultado.duplicados
      ? ` · ${resultado.duplicados} ya registrados (mismo token)`
      : "") +
    (resultado.rechazados ? ` · ${resultado.rechazados} rechazados` : "") +
    (resultado.encolados
      ? ". El worker del ERP los procesará en su próxima vuelta."
      : ".");

  return {
    title,
    description: rechazados.length ? (
      <span className="flex flex-col gap-1.5">
        <span>{resumen}</span>
        <ul className="list-disc pl-4">
          {rechazados.map((item) => (
            <li key={`${item.id_venta}-${item.documento}`}>
              <b>{item.documento || `#${item.id_venta}`}</b>: {item.motivo}
            </li>
          ))}
        </ul>
      </span>
    ) : (
      resumen
    ),
  };
}
