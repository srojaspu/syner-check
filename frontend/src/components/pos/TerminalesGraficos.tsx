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
import { PosRankingBars } from "./PosRankingBars";
import type {
  PosInstanceStats,
  PosOperationalCards,
} from "./posAnalytics";

export function TerminalesGraficos({
  series,
  claves,
  versiones,
  instancias,
  cards,
  granularity,
  selectedClave,
  onSelectClave,
}: {
  series: PosSerie[];
  claves: PosClave[];
  versiones: PosVersion[];
  instancias: PosInstanceStats[];
  cards: PosOperationalCards;
  granularity: "hour" | "day";
  selectedClave?: string;
  onSelectClave?: (clave: string) => void;
}) {
  const fallasPorInstancia = [...instancias]
    .filter((item) => item.fallas > 0)
    .sort(
      (a, b) =>
        b.fallas - a.fallas || a.instancia.localeCompare(b.instancia),
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="flex h-full flex-col lg:col-span-2">
          <CardHeader>
            <CardTitle>
              Eventos por {granularity === "hour" ? "hora" : "día"}
            </CardTitle>
            <CardDescription>
              Apilado por nivel. Pasa el cursor sobre una barra para ver el
              detalle.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <PosTimeline series={series} granularity={granularity} />
          </CardContent>
        </Card>

        <Card className="flex h-full flex-col">
          <CardHeader>
            <CardTitle>Claves más frecuentes</CardTitle>
            <CardDescription>
              Haz clic en un tipo de evento para filtrarlo en la tabla.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            <PosTopClaves
              claves={claves.slice(0, 8)}
              versiones={versiones}
              selectedClave={selectedClave}
              onSelectClave={onSelectClave}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Eventos por instancia</CardTitle>
            <CardDescription>
              Volumen registrado en la ventana, por NUC.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PosRankingBars
              label="Eventos por instancia"
              items={instancias.map((item) => ({
                label: item.instancia,
                value: item.eventos,
                hint: `${item.fallas} fallas · ${item.errores} errores`,
                tone: "neutral",
              }))}
              emptyLabel="Sin eventos en la ventana."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fallas por instancia</CardTitle>
            <CardDescription>
              Advertencias y errores agrupados por NUC.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PosRankingBars
              label="Fallas por instancia"
              items={fallasPorInstancia.map((item) => ({
                label: item.instancia,
                value: item.fallas,
                hint: `${item.errores} errores · ${item.advertencias} advertencias`,
                tone: item.errores > 0 ? "critical" : "warn",
              }))}
              emptyLabel="Sin fallas en la ventana."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ventas por resultado</CardTitle>
            <CardDescription>
              Pedidos clasificados según el resultado de su flujo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PosRankingBars
              label="Ventas por resultado"
              items={[
                {
                  label: "100% exitosas",
                  value: cards.ventasExitosas.count,
                  hint: `${cards.ventasExitosas.conTarjeta} con tarjeta`,
                  tone: "ok",
                },
                {
                  label: "Con incidencias resueltas",
                  value: cards.ventasResueltas.count,
                  hint: `${cards.ventasResueltas.advertenciasCount} advertencias superadas`,
                  tone: "warn",
                },
                {
                  label: "Fallidas o inconclusas",
                  value: cards.ventasFallidas.count,
                  hint:
                    cards.ventasFallidas.montoRiesgo !== null
                      ? `S/ ${cards.ventasFallidas.montoRiesgo} en riesgo`
                      : "monto no disponible",
                  tone: "critical",
                },
              ]}
              emptyLabel="Sin pedidos clasificados."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
