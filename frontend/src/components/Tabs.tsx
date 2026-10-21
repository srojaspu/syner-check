import {
  Tabs as UiTabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

/**
 * Selector del modo de consulta ("Rango de fechas" / "Numero de
 * comprobante").
 *
 * Compartido por las dos pantallas: comprobantes de SynerPOS y
 * comprobantes Intelisis UFE. Los valores internos de cada modo pueden
 * ser distintos; las etiquetas son las mismas.
 */
export function Tabs<T extends string>({
  mode,
  onChange,
  options,
}: {
  mode: T;
  onChange: (mode: T) => void;
  /** Etiquetas del modo; por defecto, las de la pantalla de comprobantes. */
  options?: { value: T; label: string }[];
}) {
  const items =
    options ??
    ([
      { value: "range" as T, label: "Rango de fechas" },
      { value: "number" as T, label: "Número de comprobante" },
    ] as { value: T; label: string }[]);
  return (
    <UiTabs
      value={mode}
      onValueChange={(value) => onChange(value as T)}
    >
      <TabsList>
        {items.map((item) => (
          <TabsTrigger key={item.value} value={item.value}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </UiTabs>
  );
}
