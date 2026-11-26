import type { PosClave, PosSerie, PosVersion } from "../../api/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PosTimeline } from "./PosTimeline";
import { PosTopClaves } from "./PosTopClaves";

export function TerminalesGraficos({
  series,
  claves,
  versiones,
  granularity,
  selectedClave,
  onSelectClave,
}: {
  series: PosSerie[];
  claves: PosClave[];
  versiones: PosVersion[];
  granularity: "hour" | "day";
  selectedClave?: string;
  onSelectClave?: (clave: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>
            Eventos por {granularity === "hour" ? "hora" : "día"}
          </CardTitle>
          <CardDescription>
            Apilado por nivel. Pasa el cursor sobre una barra para ver el
            detalle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PosTimeline series={series} granularity={granularity} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Claves más frecuentes</CardTitle>
          <CardDescription>
            Haz clic en un tipo de evento para filtrarlo en la tabla.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PosTopClaves
            claves={claves.slice(0, 8)}
            versiones={versiones}
            selectedClave={selectedClave}
            onSelectClave={onSelectClave}
          />
        </CardContent>
      </Card>
    </div>
  );
}
