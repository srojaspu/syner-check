import type { PosFalla } from "../../api/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtFecha, numeroFmt } from "./format";
import { EVENT_DICTIONARY, shortEventLabel } from "./posCatalog";
import { PosLevelBadge } from "./PosLevelBadge";

export function FallasTable({
  fallas,
  onFiltrar,
  onVerMuestra,
}: {
  fallas: PosFalla[];
  onFiltrar: (falla: PosFalla) => void;
  onVerMuestra: (falla: PosFalla) => void;
}) {
  if (fallas.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fallas agrupadas</CardTitle>
        <CardDescription>
          Incidencias recurrentes por tipo e instancia, de mayor a menor
          frecuencia.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table aria-label="Fallas agrupadas">
            <TableHeader>
              <TableRow>
                <TableHead>Falla / clave</TableHead>
                <TableHead>Instancia</TableHead>
                <TableHead>Nivel</TableHead>
                <TableHead className="text-right">Conteo</TableHead>
                <TableHead>Última</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fallas.slice(0, 10).map((falla) => (
                <TableRow key={`${falla.clave}-${falla.instancia}`}>
                  <TableCell
                    className="max-w-80"
                    title={EVENT_DICTIONARY[falla.clave]?.mensaje ?? falla.clave}
                  >
                    <div className="flex flex-col">
                      <span className="truncate text-xs font-medium">
                        {shortEventLabel(falla.clave)}
                      </span>
                      <span className="truncate font-mono text-[10px] text-muted-foreground">
                        {falla.clave}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-48 truncate">
                    {falla.instancia}
                  </TableCell>
                  <TableCell>
                    <PosLevelBadge nivel={falla.nivel} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {numeroFmt.format(falla.conteo)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {fmtFecha(falla.ultima)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onFiltrar(falla)}
                      >
                        Filtrar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onVerMuestra(falla)}
                      >
                        Ver muestra
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
