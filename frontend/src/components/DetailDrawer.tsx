import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  Loading02Icon,
  PrinterIcon,
  ReceiptTextIcon,
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
import { formatDateTime, formatMoney } from "../api/format";
import type { Voucher } from "../api/types";

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value ?? "—"}</dd>
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

function ItemsTable({ doc }: { doc: Voucher }) {
  if (!doc.items?.length) return null;
  const currency = doc.currency?.isoCode ?? "PEN";
  return (
    <Section title={`Productos (${doc.items.length})`}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead>Descripción</TableHead>
            <TableHead>Cant.</TableHead>
            <TableHead>Precio</TableHead>
            <TableHead>Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {doc.items.map((item, index) => (
            <TableRow key={index}>
              <TableCell>{item.sku || item.skuPu || "—"}</TableCell>
              <TableCell>
                {item.description || "—"}
                {!!(item.promotion?.crossDiscount ||
                  item.promotion?.netDiscount) && (
                  <small className="block text-muted-foreground">
                    {item.promotion?.label ||
                      item.promotion?.name ||
                      "Promo"}
                    : −
                    {formatMoney(
                      item.promotion?.crossDiscount ??
                        item.promotion?.netDiscount,
                      currency,
                    )}
                  </small>
                )}
              </TableCell>
              <TableCell>{item.quantity ?? "—"}</TableCell>
              <TableCell className="tabular-nums">
                {formatMoney(item.crossUnitPrice, currency)}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatMoney(item.crossPrice, currency)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

function TaxesTable({ doc }: { doc: Voucher }) {
  if (!doc.taxes?.length) return null;
  const currency = doc.currency?.isoCode ?? "PEN";
  return (
    <Section title="Impuestos">
      <Table>
        <TableBody>
          {doc.taxes.map((tax, index) => (
            <TableRow key={index}>
              <TableCell>{tax.name}</TableCell>
              <TableCell className="tabular-nums">
                {formatMoney(tax.base, currency)}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatMoney(tax.amount, currency)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

function PaymentsTable({ doc }: { doc: Voucher }) {
  if (!doc.payments?.length) return null;
  const currency = doc.currency?.isoCode ?? "PEN";
  return (
    <Section title="Pagos">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Medio</TableHead>
            <TableHead>Proveedor</TableHead>
            <TableHead>Autorización</TableHead>
            <TableHead>Importe</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {doc.payments.map((payment, index) => (
            <TableRow key={index}>
              <TableCell>{payment.medio || payment.name}</TableCell>
              <TableCell>
                {payment.cardProvider || payment.serviceProvider || "—"}
              </TableCell>
              <TableCell>{payment.authorization || "—"}</TableCell>
              <TableCell className="tabular-nums">
                {formatMoney(
                  payment.amount,
                  payment.currency?.isoCode ?? currency,
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

export function DetailDrawer({
  open,
  document,
  loading,
  error,
  copied,
  onCopy,
  onClose,
}: {
  open: boolean;
  document: Voucher | null;
  loading: boolean;
  error: string | null;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  const currency = document?.currency?.isoCode ?? "PEN";
  const emitted = formatDateTime(document?.createdDate, document?.date);
  return (
    <Sheet
      open={open}
      onOpenChange={(value, eventDetails) => {
        // The detail only closes from its X button: backdrop clicks are
        // ignored so an accidental outside press never loses the view.
        if (eventDetails?.reason === "outside-press") return;
        if (!value) onClose();
      }}
    >
      {/* sm:max-w-2xl needs `!`: the base sheet caps right panels at
          sm:max-w-sm with a higher-specificity data-attribute selector. */}
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl!"
        aria-label="Detalle del documento"
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
            Cargando detalle…
          </div>
        ) : error ? (
          <div className="p-6">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : document ? (
          <div id="detail" className="flex flex-col gap-6">
            <SheetHeader className="items-start text-left">
              <Badge variant="secondary">{document.tipo}</Badge>
              <SheetTitle className="flex items-center gap-2 text-lg">
                <HugeiconsIcon icon={ReceiptTextIcon} size={20} strokeWidth={2} aria-hidden />{" "}
                {document.number || "Sin número"}
              </SheetTitle>
              <SheetDescription>
                {emitted.text} ·{" "}
                {document.contactName ||
                  document.contact?.name ||
                  "Cliente no informado"}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-wrap gap-2 px-6">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onCopy}
              >
                <HugeiconsIcon icon={Copy01Icon} size={15} strokeWidth={2} aria-hidden />{" "}
                {copied ? "Copiado ✓" : "Copiar número"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => window.print()}
              >
                <HugeiconsIcon icon={PrinterIcon} size={15} strokeWidth={2} aria-hidden /> Imprimir
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-3 px-6">
              <Field label="OID" value={document.oid} />
              <Field
                label="Cliente"
                value={document.contact?.name || document.contactName}
              />
              <Field label="Documento cliente" value={document.contact?.idNumber} />
              <Field label="Correo" value={document.contact?.email} />
              <Field
                label="Subtotal"
                value={formatMoney(document.netTotal, currency)}
              />
              {!!document.netTotalDiscount && (
                <Field
                  label="Dscto. subtotal"
                  value={formatMoney(document.netTotalDiscount, currency)}
                />
              )}
              <Field
                label="Total"
                value={formatMoney(document.crossTotal, currency)}
              />
              {!!document.crossTotalDiscount && (
                <Field
                  label="Descuento"
                  value={formatMoney(document.crossTotalDiscount, currency)}
                />
              )}
              <Field label="Moneda" value={document.currency?.name || currency} />
              <Field label="Vendedor" value={document.seller} />
              {!!document.taxNumber && (
                <Field label="RUC" value={document.taxNumber} />
              )}
            </dl>
            <div className="flex flex-col gap-2 px-6">
              {document.docRef ? (
                <Alert>
                  <AlertDescription>
                    Nota de crédito relacionada: <b>{document.docRef}</b>
                  </AlertDescription>
                </Alert>
              ) : null}
              {!!document.motivo && (
                <Alert>
                  <AlertDescription>
                    Motivo: <b>{document.motivo}</b>
                  </AlertDescription>
                </Alert>
              )}
              {!!document.motivoAnulacion && (
                <Alert>
                  <AlertDescription>
                    Motivo anulación: <b>{document.motivoAnulacion}</b>
                  </AlertDescription>
                </Alert>
              )}
            </div>
            <div className="flex flex-col gap-6 px-6 pb-6">
              <ItemsTable doc={document} />
              <TaxesTable doc={document} />
              <PaymentsTable doc={document} />
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
