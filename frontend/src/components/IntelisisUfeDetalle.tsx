import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  Loading02Icon,
  Search01Icon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMoney } from "../api/format";
import type {
  IntelisisUfeDetalle,
  IntelisisUfeIntento,
  UfeEstadoSunat,
} from "../api/types";

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words">{value ?? "—"}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function sunatVariant(estado: UfeEstadoSunat) {
  if (estado === "ACEPTADO") return "default" as const;
  if (estado === "SUNAT NO ACEPTADO" || estado === "SUNAT NO ENCONTRADO") {
    return "destructive" as const;
  }
  return "outline" as const;
}

function Intentos({ intentos }: { intentos: IntelisisUfeIntento[] }) {
  if (!intentos.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Este comprobante no tiene intentos en la bitácora: nunca pasó por el
        generador.
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>LogID</TableHead>
          <TableHead>Inicio</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Etapa</TableHead>
          <TableHead>Detalle</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {intentos.map((intento) => (
          <TableRow key={intento.log_id}>
            <TableCell className="tabular-nums">{intento.log_id}</TableCell>
            <TableCell className="tabular-nums">
              {intento.fecha_inicio?.replace("T", " ") || "—"}
            </TableCell>
            <TableCell>
              <Badge
                variant={
                  intento.estado === "OK" ? "secondary" : "destructive"
                }
              >
                {intento.estado || "—"}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {intento.etapa || "—"}
            </TableCell>
            <TableCell>
              <span
                className="block max-w-56 truncate"
                title={intento.detalle || intento.error_mensaje || ""}
              >
                {intento.detalle || intento.error_mensaje || "—"}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Drawer de trazabilidad del comprobante: la venta, los intentos del
 * generador y el estado SUNAT.
 */
export function IntelisisUfeDetalle({
  open,
  detalle,
  loading,
  error,
  validando,
  onValidar,
  onClose,
}: {
  open: boolean;
  detalle: IntelisisUfeDetalle | null;
  loading: boolean;
  error: string | null;
  validando: number | null;
  aviso?: string | null;
  errorValidacion?: string | null;
  onValidar: (idVenta: number) => void;
  onClose: () => void;
}) {
  const venta = detalle?.venta;
  return (
    <Sheet
      open={open}
      onOpenChange={(value, eventDetails) => {
        if (eventDetails?.reason === "outside-press") return;
        if (!value) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl!"
        aria-label="Trazabilidad del comprobante"
      >
        {loading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <HugeiconsIcon
              icon={Loading02Icon}
              size={16}
              strokeWidth={2}
              className="animate-spin"
              aria-hidden
            />
            Cargando trazabilidad…
          </div>
        ) : error ? (
          <div className="p-6">
            <Alert variant="destructive">
              <HugeiconsIcon icon={TriangleAlertIcon} strokeWidth={2} />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : venta ? (
          <div className="flex flex-col gap-6">
            <SheetHeader className="items-start text-left">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{venta.tipo}</Badge>
                <Badge variant={sunatVariant(venta.estado_sunat)}>
                  {venta.estado_sunat}
                </Badge>
              </div>
              <SheetTitle className="text-lg">
                {venta.comprobante || venta.documento}
              </SheetTitle>
              <SheetDescription>
                {formatDate(venta.fecha_emision)} · {venta.cliente || "Sin cliente"}
                {venta.sucursal_nombre ? ` · ${venta.sucursal_nombre}` : ""}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap gap-2 px-6">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={validando !== null}
                onClick={() => onValidar(venta.id_venta)}
                title="Consulta este comprobante en SUNAT"
              >
                {validando === venta.id_venta ? (
                  <HugeiconsIcon
                    icon={Loading02Icon}
                    size={15}
                    strokeWidth={2}
                    className="animate-spin"
                    aria-hidden
                  />
                ) : (
                  <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={2} aria-hidden />
                )}{" "}
                {validando === venta.id_venta
                  ? "Consultando…"
                  : "Validar en SUNAT"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    String(venta.comprobante || venta.documento || ""),
                  )
                }
              >
                <HugeiconsIcon icon={Copy01Icon} size={15} strokeWidth={2} aria-hidden />{" "}
                Copiar número
              </Button>
            </div>

            <dl className="grid grid-cols-2 gap-3 px-6">
              <Field label="Comprobante SUNAT" value={venta.comprobante} />
              <Field
                label="Documento en bitácora"
                value={
                  <span className="flex items-center gap-1.5">
                    {venta.documento}
                    {venta.documento_estimado ? (
                      <Badge variant="outline">estimado</Badge>
                    ) : null}
                  </span>
                }
              />
              <Field label="ID ERP" value={venta.id_venta} />
              <Field label="Movimiento" value={`${venta.mov} ${venta.mov_id}`} />
              <Field
                label="Sucursal"
                value={`${venta.sucursal} · ${venta.sucursal_nombre}`}
              />
              <Field label="Estatus ERP" value={venta.estatus_erp} />
              <Field label="Total" value={formatMoney(venta.total, "PEN")} />
              {venta.importe_sunat !== venta.total ? (
                <Field
                  label="Importe SUNAT"
                  value={formatMoney(venta.importe_sunat, "PEN")}
                />
              ) : null}
              <Field label="Cliente" value={venta.cliente} />
              {venta.referencia ? (
                <Field label="Documento que acredita" value={venta.referencia} />
              ) : null}
              {venta.hash ? <Field label="Hash de salida" value={venta.hash} /> : null}
            </dl>

            <div className="flex flex-col gap-6 px-6 pb-6">
              <Section title="Estado SUNAT">
                <p className="text-sm">
                  <Badge variant={sunatVariant(venta.estado_sunat)}>
                    {venta.estado_sunat}
                  </Badge>{" "}
                  {venta.sunat?.consultado ? (
                    <span className="text-muted-foreground">
                      consultado el {venta.sunat.consultado.replace("T", " ")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      todavía sin consultar
                    </span>
                  )}
                </p>
              </Section>

              <Section title={`Intentos del generador (${detalle?.intentos.length ?? 0})`}>
                <Intentos intentos={detalle?.intentos ?? []} />
              </Section>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
