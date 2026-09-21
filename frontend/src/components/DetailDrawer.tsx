import type { ReactNode } from "react";
import { Copy, Printer, ReceiptText, X } from "lucide-react";
import { formatDateTime, formatMoney } from "../api/format";
import type { Voucher } from "../api/types";

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <b>{value ?? "—"}</b>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="detail-section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function ItemsTable({ doc }: { doc: Voucher }) {
  if (!doc.items?.length) return null;
  const currency = doc.currency?.isoCode ?? "PEN";
  return (
    <Section title={`Productos (${doc.items.length})`}>
      <div className="table-wrap">
        <table className="mini-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Descripción</th>
              <th>Cant.</th>
              <th>Precio</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {doc.items.map((item, index) => (
              <tr key={index}>
                <td>{item.sku || item.skuPu || "—"}</td>
                <td>{item.description || "—"}</td>
                <td>{item.quantity ?? "—"}</td>
                <td>{formatMoney(item.crossUnitPrice, currency)}</td>
                <td>{formatMoney(item.crossPrice, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function TaxesTable({ doc }: { doc: Voucher }) {
  if (!doc.taxes?.length) return null;
  const currency = doc.currency?.isoCode ?? "PEN";
  return (
    <Section title="Impuestos">
      <table className="mini-table">
        <tbody>
          {doc.taxes.map((tax, index) => (
            <tr key={index}>
              <td>{tax.name}</td>
              <td>{formatMoney(tax.base, currency)}</td>
              <td>{formatMoney(tax.amount, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function PaymentsTable({ doc }: { doc: Voucher }) {
  if (!doc.payments?.length) return null;
  const currency = doc.currency?.isoCode ?? "PEN";
  return (
    <Section title="Pagos">
      <div className="table-wrap">
        <table className="mini-table">
          <thead>
            <tr>
              <th>Medio</th>
              <th>Proveedor</th>
              <th>Autorización</th>
              <th>Importe</th>
            </tr>
          </thead>
          <tbody>
            {doc.payments.map((payment, index) => (
              <tr key={index}>
                <td>{payment.medio || payment.name}</td>
                <td>{payment.cardProvider || payment.serviceProvider || "—"}</td>
                <td>{payment.authorization || "—"}</td>
                <td>
                  {formatMoney(
                    payment.amount,
                    payment.currency?.isoCode ?? currency,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  if (!open) return null;
  const currency = document?.currency?.isoCode ?? "PEN";
  const emitted = formatDateTime(document?.createdDate, document?.date);
  return (
    <div className="drawer-wrap">
      <div className="drawer-backdrop" onClick={onClose} aria-hidden />
      <aside className="drawer" role="dialog" aria-label="Detalle del documento">
        <button className="close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        {loading ? (
          <div className="empty">Cargando detalle…</div>
        ) : error ? (
          <div className="empty">{error}</div>
        ) : document ? (
          <div id="detail">
            <div className="detail-title">
              <div className="eyebrow">{document.tipo}</div>
              <h2>
                <ReceiptText size={20} aria-hidden />{" "}
                {document.number || "Sin número"}
              </h2>
              <p>
                {emitted.text} ·{" "}
                {document.contactName ||
                  document.contact?.name ||
                  "Cliente no informado"}
              </p>
              <div className="detail-actions">
                <button
                  type="button"
                  className="btn secondary"
                  onClick={onCopy}
                >
                  <Copy size={15} aria-hidden /> {copied ? "Copiado ✓" : "Copiar número"}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => window.print()}
                >
                  <Printer size={15} aria-hidden /> Imprimir
                </button>
              </div>
            </div>
            <div className="detail-grid">
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
            </div>
            {document.docRef ? (
              <div className="reference">
                Nota de crédito relacionada: <b>{document.docRef}</b>
              </div>
            ) : null}
            <ItemsTable doc={document} />
            <TaxesTable doc={document} />
            <PaymentsTable doc={document} />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
