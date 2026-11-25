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
}: {
  series: PosSerie[];
  claves: PosClave[];
  versiones: PosVersion[];
  granularity: "hour" | "day";
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
          <CardDescription>Catálogo observado en la ventana.</CardDescription>
        </CardHeader>
        <CardContent>
          <PosTopClaves claves={claves.slice(0, 8)} versiones={versiones} />
        </CardContent>
      </Card>
    </div>
  );
}
