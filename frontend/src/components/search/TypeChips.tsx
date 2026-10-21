import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export const ALL_TIPOS = ["FACTURA", "BOLETA", "NOTA DE CREDITO"] as const;

/**
 * Tipos del universo Intelisis UFE: el mismo mas la nota de debito (que
 * el generador tambien procesa, con su propio SP).
 */
export const ALL_TIPOS_UFE = [
  "FACTURA",
  "BOLETA",
  "NOTA DE CREDITO",
  "NOTA DE DEBITO",
] as const;

const TIPO_LABELS: Record<string, string> = {
  FACTURA: "Factura",
  BOLETA: "Boleta",
  "NOTA DE CREDITO": "Nota de crédito",
  "NOTA DE DEBITO": "Nota de débito",
};

/** Multi-select chips for document types. Controlled by the parent. */
export function TypeChips({
  values,
  onChange,
  tipos = ALL_TIPOS as readonly string[],
}: {
  values: string[];
  onChange: (values: string[]) => void;
  /** Tipos a mostrar; por defecto, los del flujo SynerPOS. */
  tipos?: readonly string[];
}) {
  const toggle = (tipo: string) => {
    onChange(
      values.includes(tipo)
        ? values.filter((value) => value !== tipo)
        : [...values, tipo],
    );
  };
  return (
    <div className="flex flex-wrap gap-2">
      {tipos.map((tipo) => {
        // IDs cannot contain spaces: aria-labelledby splits on whitespace,
        // so "tipo-NOTA DE CREDITO" would resolve to no accessible name.
        const id = `tipo-${tipo.replace(/\s+/g, "-")}`;
        return (
          <div key={tipo} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={values.includes(tipo)}
              onCheckedChange={() => toggle(tipo)}
            />
            <Label htmlFor={id}>{TIPO_LABELS[tipo]}</Label>
          </div>
        );
      })}
    </div>
  );
}
