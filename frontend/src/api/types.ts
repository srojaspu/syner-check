/** Backend contract mirrors (same JSON the FastAPI endpoints return). */

export type TipoDocumento = "FACTURA" | "BOLETA" | "NOTA DE CREDITO";

export interface SessionUser {
  email: string;
  name: string;
  picture: string;
  auth_mode: string;
}

export interface Currency {
  isoCode?: string;
  name?: string;
  symbol?: string;
}

export interface Contact {
  idNumber?: string;
  name?: string;
  email?: string;
}

export interface DocPromotion {
  oid?: string;
  label?: string;
  name?: string;
  description?: string;
  netDiscount?: number;
  crossDiscount?: number;
  netUnitDiscount?: number;
  crossUnitDiscount?: number;
}

export interface DocItem {
  sku?: string;
  skuPu?: string;
  description?: string;
  quantity?: number;
  crossUnitPrice?: number;
  crossPrice?: number;
  promotion?: DocPromotion;
}

export interface DocTax {
  name?: string;
  base?: number;
  amount?: number;
}

export interface DocPayment {
  medio?: string;
  name?: string;
  cardProvider?: string;
  serviceProvider?: string;
  authorization?: string;
  amount?: number;
  currency?: Currency;
}

/** One voucher row, from summary lists or search results. */
export interface Voucher {
  oid: string;
  number?: string;
  date?: string;
  /** Emission timestamp; absent on credit notes (schema has none). */
  createdDate?: string;
  tipo: TipoDocumento;
  seller?: string;
  contactName?: string;
  contact?: Contact;
  currency?: Currency;
  netTotal?: number;
  crossTotal?: number;
  netTotalDiscount?: number;
  crossTotalDiscount?: number;
  taxNumber?: string;
  docRef?: string;
  motivo?: string;
  motivoAnulacion?: string;
  items?: DocItem[];
  taxes?: DocTax[];
  payments?: DocPayment[];
  in_sql: boolean;
  /** Triple-flow: presente en Intelisis/Venta (SE-*). False si degradado. */
  in_intelisis?: boolean;
  /** Cabecera Intelisis matcheada por (tipo, número, fecha). */
  intelisis?: Record<string, unknown>;
  /** SQL index row, present only on sql_index search hits. */
  sql?: Record<string, unknown>;
}

export interface FlowPerTipo {
  graphql: number;
  in_mov: number;
  in_intelisis: number;
  full: number;
  pending_in_intelisis: number;
  cancelled_in_intelisis: number;
  missing_in_mov: number;
  missing_in_intelisis: number;
}

export interface SummaryResponse {
  documents: Record<string, Voucher[]>;
  sql_count: number;
  graphql_count: number;
  intelisis_enabled: boolean;
  intelisis_count: number;
  flow?: { per_tipo: Record<string, FlowPerTipo>; totals: FlowPerTipo };
  intelisis_warning?: string | null;
  range: { start: string; end: string };
}

export interface SearchResponse {
  results: Voucher[];
  source: "sql_index" | "graphql_fallback";
  searched_range?: { start: string; end: string };
  intelisis_enabled: boolean;
  intelisis_warning?: string | null;
}

export interface DocumentResponse {
  document: Voucher;
}
