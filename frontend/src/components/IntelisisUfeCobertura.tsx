import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronDownIcon, ChevronUpIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "../api/format";
import type { IntelisisUfeDia } from "../api/types";

/**
 * Cobertura por dia: emitidos, sin traza y con incidencia.
 *
 * Es el equivalente del bloque "cobertura" de la pestana FE del PHP (alla
 * era la carga del portal; aca, la del generador).
 */
export function IntelisisUfeCobertura({ dias }: { dias: IntelisisUfeDia[] }) {
  const [abierta, setAbierta] = useState(false);
  if (!dias.length) return null;
  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-medium">Cobertura por dia</h2>
            <p className="text-sm text-muted-foreground">
              Documentos emitidos, sin traza y con incidencia, dia por dia.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAbierta((valor) => !valor)}
            aria-expanded={abierta}
          >
            <HugeiconsIcon
              icon={abierta ? ChevronUpIcon : ChevronDownIcon}
              size={15}
              strokeWidth={2}
              aria-hidden
            />{" "}
            {abierta ? "Ocultar" : "Ver"} cobertura ({dias.length} dias)
          </Button>
        </div>
      </CardHeader>
      {abierta ? (
        <CardContent>
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dia</TableHead>
                  <TableHead className="text-right">Emitidos</TableHead>
                  <TableHead className="text-right">Sin traza</TableHead>
                  <TableHead className="text-right">Con incidencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dias.map((dia) => (
                  <TableRow key={dia.dia}>
                    <TableCell className="tabular-nums">
                      {formatDate(dia.dia)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dia.documentos.toLocaleString("es-PE")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dia.sin_traza > 0 ? (
                        <span className="text-destructive">
                          {dia.sin_traza.toLocaleString("es-PE")}
                        </span>
                      ) : (
                        "0"
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dia.con_incidencia > 0 ? (
                        <span className="text-destructive">
                          {dia.con_incidencia.toLocaleString("es-PE")}
                        </span>
                      ) : (
                        "0"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
