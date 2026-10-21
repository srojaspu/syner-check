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
  /** SUNAT cache status (null = aún no consultado). */
  sunat?: { estado?: string; fecha_consulta?: string } | null;
  /** Backend-assigned flow bucket for each stage (used by the table filter). */
  flow_states?: Partial<Record<FlowStageKey, string>>;
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

export type FlowStageKey = "intelisis" | "sunat";

export interface FlowStateCount {
  key: string;
  label: string;
  count: number;
}

export interface FlowStageSummary {
  key: FlowStageKey;
  enabled: boolean;
  total: number;
  /** Documents with a known state (SUNAT: excludes "sin consultar"). */
  consulted: number;
  states: FlowStateCount[];
}

export interface FlowBreakdown {
  per_tipo: Record<string, FlowPerTipo>;
  totals: FlowPerTipo;
  stages?: Partial<Record<FlowStageKey, FlowStageSummary>>;
}

export interface SummaryResponse {
  documents: Record<string, Voucher[]>;
  sql_count: number;
  graphql_count: number;
  intelisis_enabled: boolean;
  intelisis_count: number;
  sunat_enabled: boolean;
  flow?: FlowBreakdown;
  intelisis_warning?: string | null;
  range: { start: string; end: string };
}

export interface SearchResponse {
  results: Voucher[];
  source: "sql_index" | "graphql_fallback";
  searched_range?: { start: string; end: string };
  intelisis_enabled: boolean;
  intelisis_warning?: string | null;
  sunat_enabled: boolean;
}

export type SunatScope = "no_aceptados" | "todos";

export interface SunatOmitted {
  aceptados: number;
  en_proceso: number;
  sin_confirmar: number;
  invalidos: { tipo: string; number: string; reason: string }[];
}

export interface SunatSubmissionResponse {
  solicitud_id: string;
  estado: string;
  fase: string;
  mensaje: string;
  total: number;
  alcance: SunatScope;
  por_enviar: number;
  chunks_total: number;
  chunks_done: number;
  enviados: number;
  omitidos: SunatOmitted;
  trabajos: { trabajo_id: number; cantidad: number; estado?: string }[];
  errores: { cantidad: number; mensaje: string; sin_confirmar?: boolean }[];
  porcentaje: number;
  iniciado_en: string;
  actualizado_en: string;
  reutilizada?: boolean;
}

export interface SunatJobResponse {
  trabajo_id: number;
  estado: string;
  total: number;
  procesados: number;
  exitosos: number;
  errores: number;
  pendientes: number;
  porcentaje: number;
  mensaje: string;
  resultados: { serie: string; numero: string; estado: string }[];
  actualizado_en: string;
}

export interface DocumentResponse {
  document: Voucher;
}

/** Manual resend to dbo.MovSynerPos (INSERT-only, backend re-queries detail). */
export type MovSynerPosEstado =
  | "insertado"
  | "reparado"
  | "sin_cambios"
  | "conflicto"
  | "error";

/** Only identity leaves the browser; amounts and lines are never trusted. */
export interface MovSynerPosRequestDocumento {
  tipo: TipoDocumento;
  oid: string;
  number?: string;
  date?: string;
}

export interface MovSynerPosDetalle {
  tipo: TipoDocumento | string;
  oid: string;
  number: string;
  estado: MovSynerPosEstado;
  lineas_insertadas: number;
  lineas_existentes: number;
  lineas_faltantes: number;
  error: string | null;
}

export interface MovSynerPosResponse {
  solicitud_id: string;
  total: number;
  insertados: number;
  reparados: number;
  sin_cambios: number;
  conflictos: number;
  errores: number;
  detalle: MovSynerPosDetalle[];
}
