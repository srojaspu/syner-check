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

/* --- Pantalla Intelisis UFE (comprobantes de origen Intelisis) --------- */

/** Estado tecnico del generador (7 valores, los del drawer). */
export type UfeEstadoGeneracion =
  | "generado"
  | "error_validacion"
  | "omitido_validacion"
  | "sin_bloque"
  | "en_proceso"
  | "sin_registro"
  | "fuera_de_bitacora";

/** Vocabulario del bloque "Generador" (paridad con la pestana FE del PHP). */
export type UfeGenerador =
  | "OK REGISTRADO"
  | "SIN OK"
  | "SIN TRAZA"
  | "NO APLICA";

/** Resultado de la revision: CONFORME o REVISAR. */
export type UfeResultado = "CONFORME" | "REVISAR";

/** Estado SUNAT: reemplaza al estado del portal de Carvajal (D15). */
export type UfeEstadoSunat =
  | "ACEPTADO"
  | "SUNAT NO ENCONTRADO"
  | "SUNAT NO ACEPTADO"
  | "SUNAT SIN CONSULTA";

export interface IntelisisUfeRow {
  id_venta: number;
  /** Tipo de movimiento: BO, FA, NC, ND. */
  tipo: string;
  /** TipoDocumentoPU de Intelisis: 01, 03, 07, 08. */
  tipo_documento_pu: string;
  /** Documento oficial (de la bitacora) o estimado si no hay traza. */
  documento: string;
  documento_estimado: boolean;
  documento_teorico: string;
  mov: string;
  mov_id: string;
  fecha_emision: string;
  sucursal: number;
  sucursal_nombre: string;
  cliente: string;
  cliente_codigo: string;
  ruc: string;
  importe: number;
  impuestos: number;
  total: number;
  estatus_erp: string;
  /** Documento que acredita (notas de credito). */
  referencia: string;
  estado_generacion: UfeEstadoGeneracion;
  generador: UfeGenerador;
  incidencias: string[];
  resultado: UfeResultado;
  detalle_incidencia: string | null;
  /** Emitido hoy dentro de la ventana de gracia: todavia no es un fallo. */
  en_espera: boolean;
  /** No aplica el generador (nota de credito que acredita un SE-*). */
  exento_generador: boolean;
  fuera_de_bitacora: boolean;
  etapa: string;
  intentos: number;
  ok_registrados: number;
  ultimo_intento: string;
  hash: string;
  archivo_out: string;
  procedimiento: string;
  tipo_sunat: string;
  sunat: { estado: string; consultado: string } | null;
  estado_sunat: UfeEstadoSunat;
  reenvio: { estado: string | null; id: number | null } | null;
}

export interface IntelisisUfeSucursal {
  sucursal: number;
  nombre: string;
  ventas: number;
  incidencias: number;
}

export interface IntelisisUfeKpis {
  total: number;
  conformes: number;
  con_incidencia: number;
  sin_traza: number;
  en_espera: number;
  no_aplica: number;
  sin_cobertura_sunat: number;
  por_generador: { key: string; count: number }[];
  por_incidencia: { key: string; count: number }[];
  por_sucursal: IntelisisUfeSucursal[];
}

export interface IntelisisUfeResponse {
  desde: string;
  hasta: string;
  bitacora_desde: string;
  intelisis_enabled: boolean;
  kpis: IntelisisUfeKpis;
  filtrados: number;
  rows: IntelisisUfeRow[];
}
