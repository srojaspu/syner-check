import { useEffect, useState } from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Tick02Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "cn";

export interface SearchComboboxProps {
  items: string[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  labelFor: (value: string) => string;
  placeholder: string;
  ariaLabel: string;
  emptyLabel?: string;
  className?: string;
}

/**
 * Selector con autocompletado (Base UI Combobox), mismo lenguaje visual que
 * los controles de filtro del proyecto.
 */
export function SearchCombobox({
  items,
  value,
  onValueChange,
  labelFor,
  placeholder,
  ariaLabel,
  emptyLabel = "Sin coincidencias",
  className,
}: SearchComboboxProps) {
  const [query, setQuery] = useState(() => (value ? labelFor(value) : ""));

  useEffect(() => {
    setQuery(value ? labelFor(value) : "");
    // labelFor is stable enough for this controlled display; sync on selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <ComboboxPrimitive.Root
      items={items}
      value={value}
      inputValue={query}
      onInputValueChange={setQuery}
      onValueChange={(next) => {
        onValueChange(next ?? null);
        setQuery(next ? labelFor(next) : "");
      }}
      itemToStringLabel={labelFor}
    >
      <ComboboxPrimitive.InputGroup
        className={cn("relative w-56", className)}
      >
        <ComboboxPrimitive.Input
          aria-label={ariaLabel}
          placeholder={placeholder}
          className="h-9 w-full min-w-0 rounded-4xl border border-input bg-input/30 px-3 py-1 pr-14 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
          {value ? (
            <ComboboxPrimitive.Clear
              aria-label={`Quitar filtro ${ariaLabel}`}
              className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
            </ComboboxPrimitive.Clear>
          ) : null}
          <ComboboxPrimitive.Trigger
            aria-label={`Abrir ${ariaLabel}`}
            className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={UnfoldMoreIcon} size={14} strokeWidth={2} />
          </ComboboxPrimitive.Trigger>
        </div>
      </ComboboxPrimitive.InputGroup>

      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          sideOffset={4}
          className="isolate z-50"
        >
          <ComboboxPrimitive.Popup className="w-[var(--anchor-width)] min-w-56 overflow-hidden rounded-xl border border-border/70 bg-popover p-1 text-popover-foreground shadow-xl outline-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <ComboboxPrimitive.Empty className="px-3 py-2 text-sm text-muted-foreground">
              {emptyLabel}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="max-h-64 overflow-y-auto">
              {(item: string) => (
                <ComboboxPrimitive.Item
                  key={item}
                  value={item}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted"
                >
                  <span className="truncate">{labelFor(item)}</span>
                  <ComboboxPrimitive.ItemIndicator className="shrink-0 text-foreground">
                    <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} />
                  </ComboboxPrimitive.ItemIndicator>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}
