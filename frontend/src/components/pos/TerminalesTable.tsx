import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import type { PosTerminal } from "../../api/types";
import { DataTable } from "@/components/DataTable";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FadeScroll } from "./FadeScroll";
import { numeroFmt } from "./format";
import { terminalColumns } from "./terminalColumns";

/**
 * Tabla de instancias/terminales con el DataTable compartido:
 * buscador por sucursal/serial, cabecera fija y scroll con fade.
 */
export function TerminalesTable({
  terminales,
  hayEventos,
  onVerEventos,
}: {
  terminales: PosTerminal[];
  hayEventos: boolean;
  onVerEventos: (terminal: PosTerminal) => void;
}) {
  const [busqueda, setBusqueda] = useState("");

  const filtrados = useMemo(() => {
    const needle = busqueda.trim().toLowerCase();
    if (!needle) return terminales;
    return terminales.filter((terminal) => {
      const serial = terminal.serial ?? "";
      return (
        terminal.instancia.toLowerCase().includes(needle) ||
        serial.toLowerCase().includes(needle)
      );
    });
  }, [terminales, busqueda]);

  const columnas = useMemo(() => terminalColumns(), []);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>Instancias / terminales</CardTitle>
          <CardDescription>
            Cabecera fija. Haz clic en una fila para ver sus eventos.
          </CardDescription>
        </div>
        <div className="relative w-full sm:w-72">
          <HugeiconsIcon
            icon={Search01Icon}
            size={15}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
            placeholder="Buscar instancia o serial"
            aria-label="Buscar instancia o serial"
            className="pl-8"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <DataTable.Root
          data={filtrados}
          columns={columnas}
          initialPageSize={200}
          showFilters={false}
          onRowClick={onVerEventos}
          rowActionLabel={(terminal) =>
            `Ver eventos de ${terminal.instancia}${
              terminal.serial ? ` (${terminal.serial})` : ""
            }`
          }
        >
          <FadeScroll className="max-h-[26rem]">
            <DataTable.View
              label="Instancias y terminales"
              empty={
                <div className="flex flex-col items-center gap-1.5">
                  <HugeiconsIcon
                    icon={Search01Icon}
                    size={20}
                    strokeWidth={2}
                    className="text-muted-foreground"
                    aria-hidden
                  />
                  <p className="font-medium">Sin terminales</p>
                  <p className="text-sm text-muted-foreground">
                    {hayEventos
                      ? "Ninguna instancia coincide con la búsqueda."
                      : "No hay eventos en esta ventana."}
                  </p>
                </div>
              }
            />
          </FadeScroll>
        </DataTable.Root>
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          {numeroFmt.format(filtrados.length)} de{" "}
          {numeroFmt.format(terminales.length)} terminales
        </p>
      </CardContent>
    </Card>
  );
}
