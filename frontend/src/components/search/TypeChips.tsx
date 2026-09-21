import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export const ALL_TIPOS = ["FACTURA", "BOLETA", "NOTA DE CREDITO"] as const;

const TIPO_LABELS: Record<string, string> = {
  FACTURA: "Factura",
  BOLETA: "Boleta",
  "NOTA DE CREDITO": "Nota de crédito",
};

/** Multi-select chips for document types. Controlled by the parent. */
export function TypeChips({
  values,
  onChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
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
      {ALL_TIPOS.map((tipo) => {
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
