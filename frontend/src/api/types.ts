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

/**
 * Lo mínimo que el validador necesita de un documento.
 *
 * Lo cumplen tanto un `Voucher` (origen SynerPOS) como una fila de la
 * pantalla Intelisis UFE: el backend arma el payload final.
 */
export interface SunatDocumentInput {
  tipo: string;
  number?: string;
  date?: string;
  crossTotal?: number;
}

/** Documento seleccionable para una consulta a SUNAT. */
export interface SunatSelectable extends SunatDocumentInput {
  sunat?: { estado?: string; fecha_consulta?: string } | null;
}

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

/** Estado de la venta en el ERP (`dbo.Venta.Estatus`). */
export type UfeEstatusErp =
  | "CONCLUIDO"
  | "PENDIENTE"
  | "SINAFECTAR"
  | "CANCELADO";

/** Situación documental de una venta sin comprobante electrónico. */
export type IntelisisUfeSituacion = "sin_documento" | "documento_invalido";

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
  /** Identidad en SUNAT: prefijo de tipo + serie + correlativo. */
  comprobante: string;
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

/** Cobertura del generador por dia (el equivalente al bloque "cobertura" del PHP). */
export interface IntelisisUfeDia {
  dia: string;
  documentos: number;
  sin_traza: number;
  con_incidencia: number;
}

export interface IntelisisUfeKpis {
  /** Documentos en la grilla (solo CONCLUIDO/PENDIENTE). */
  total: number;
  /** Ventas del eje en el ERP: los cuatro estados (incluye las que no tienen documento). */
  total_ventas: number;
  conformes: number;
  con_incidencia: number;
  /** Incidencia D19: solo CONCLUIDO sin registro en la bitácora. */
  sin_traza: number;
  /** PENDIENTE sin registro: todavía no debía pasar por el generador. */
  pendientes_conclusion: number;
  en_espera: number;
  no_aplica: number;
  sin_cobertura_sunat: number;
  /** Documentos con tipo SUNAT válido (los que se pueden consultar). */
  sunat_consultables: number;
  /** Desglose por estatus del ERP: los cuatro estados del período. */
  por_estatus: { key: string; count: number }[];
  /** Lo que la grilla puede devolver (CONCLUIDO/PENDIENTE): alimenta el filtro. */
  por_estatus_listado: { key: string; count: number }[];
  /** Desglose por estado del generador (columna Estado). */
  por_estado_generacion: { key: string; count: number }[];
  /** Desglose por estado SUNAT. */
  por_estado_sunat: { key: string; count: number }[];
  por_generador: { key: string; count: number }[];
  por_incidencia: { key: string; count: number }[];
  por_sucursal: IntelisisUfeSucursal[];
  por_dia?: IntelisisUfeDia[];
}

/**
 * Filtros de la pantalla.
 *
 * Los de la fila de la tabla (`tipo` incluido) se aplican al instante en el
 * navegador; los KPIs y `tipos` viajan en la consulta al servidor.
 */
export interface IntelisisUfeFiltros {
  estado?: string;
  /** Estatus de la venta en el ERP (columna ERP). */
  estatus?: string;
  /** Tipo de la fila de filtros de la tabla: no viaja al servidor. */
  tipo?: string;
  /** Tipos de documento de la consulta (chips del panel): FA, BO, NC, ND. */
  tipos?: string[];
  generador?: string;
  sunat?: string;
  sucursal?: number;
  q?: string;
}

export interface IntelisisUfeResponse {
  desde: string;
  hasta: string;
  bitacora_desde: string;
  intelisis_enabled: boolean;
  kpis: IntelisisUfeKpis;
  /** Filas que vuelve el listado (ya recortadas, si aplica). */
  filtrados: number;
  /** Filas que pasan el filtro, antes del recorte. */
  filtrados_total?: number;
  /** True cuando el listado se recorto por el tope de filas. */
  truncado?: boolean;
  max_filas?: number;
  rows: IntelisisUfeRow[];
}

/**
 * Una venta registrada en Intelisis que nunca llegó a afectarse.
 *
 * `situacion` distingue las dos causas: nunca pasó por la bitácora
 * (`sin_documento`) o el generador dejó un número inválido
 * (`documento_invalido`, p. ej. `175-00000000`), que no es un comprobante.
 */
export interface IntelisisUfeSinDocumentoRow {
  id_venta: number;
  mov: string;
  /** Folio del movimiento: 189 de 304 no tienen (`null`). */
  mov_id: string | null;
  documento: string | null;
  documento_invalido: string | null;
  situacion: IntelisisUfeSituacion;
  fecha_emision: string;
  sucursal: number;
  sucursal_nombre: string;
  cliente: string;
  total: number;
  /** La venta quedó creada sin detalle (51 de 304). */
  tiene_lineas: boolean;
}

export interface IntelisisUfeSinDocumentoResponse {
  desde: string;
  hasta: string;
  intelisis_enabled: boolean;
  total: number;
  max_filas: number;
  truncado: boolean;
  rows: IntelisisUfeSinDocumentoRow[];
}

/** Un intento del generador en la bitacora. */
export interface IntelisisUfeIntento {
  log_id: number;
  estado: string;
  etapa: string;
  documento: string;
  detalle: string;
  error_mensaje: string;
  fecha_inicio: string;
  fecha_fin: string;
  archivo_out: string;
  procedimiento: string;
  duracion_ms: number | null;
  hash: string;
  tipo_movimiento: string;
}

/** Trazabilidad de un comprobante (lo que muestra el drawer). */
export interface IntelisisUfeDetalle {
  id_venta: number;
  venta: IntelisisUfeRow;
  intentos: IntelisisUfeIntento[];
  sunat: { estado: string; consultado: string } | null;
  estado_sunat: UfeEstadoSunat;
}

export interface IntelisisUfeValidacion {
  id_venta: number;
  documento: string;
  comprobante: string;
  estado: string;
  resultado: {
    estado?: string;
    codigo_sunat?: string;
    ruc_estado?: string;
    ruc_condicion?: string;
    observaciones?: string[];
  };
}

/** Resultado de buscar un comprobante por su numero oficial. */
export interface IntelisisUfeBusqueda {
  documento_buscado: string;
  intelisis_enabled: boolean;
  encontrados: number;
  rows: IntelisisUfeRow[];
}

/* --- Cola de reenvios del ERP (`dbo.FE_Reenvio`) ------------------------ */

/** Los 7 estados reales de `CK_FE_Reenvio_Estado`. */
export type IntelisisReenvioEstado =
  | "EN_COLA"
  | "EJECUTANDO"
  | "FINALIZADO_OK"
  | "FINALIZADO_REVISAR"
  | "NO_EJECUTADO"
  | "NO_CONFIRMADO"
  | "REVISADO_MANUAL";

/** Resultado del encolado de un documento. */
export interface IntelisisReenvioDetalle {
  id_venta: number;
  documento: string;
  tipo: string;
  procedimiento: string;
  estado: "encolado" | "ya_registrado" | "rechazado";
  /** Razon del rechazo (o confirmacion de idempotencia). */
  motivo: string;
  queue_id: number | null;
}

export interface IntelisisReenvioResultado {
  total: number;
  encolados: number;
  duplicados: number;
  rechazados: number;
  detalle: IntelisisReenvioDetalle[];
}

/** Una fila de `dbo.FE_Reenvio` (los nombres son los de la tabla del ERP). */
export interface IntelisisReenvioFila {
  ID: number;
  IDVenta: number;
  Tipo: string;
  Procedimiento: string;
  Usuario: string;
  Motivo: string;
  Estado: IntelisisReenvioEstado;
  Creado: string | null;
  Inicio: string | null;
  Fin: string | null;
  SPID: number | null;
  LogDesde: number | null;
  LogHasta: number | null;
  Retorno: string | null;
  Detalle: string | null;
  RevisadoPor: string | null;
  Revision: string | null;
  LoteID: number | null;
}

/** Heartbeat del worker PHP del ERP (`dbo.FE_Worker`). */
export interface IntelisisFeWorker {
  ID: number;
  UltimoContacto: string | null;
  Estado: string | null;
  TrabajoID: number | null;
  SPID: number | null;
}

/** Respuesta de `GET /reenvios`: espejo de `feop_queue` del ERP. */
export interface IntelisisReenvioCola {
  /** El mutex `RMAND2:FE:WORKER` esta tomado. */
  ocupado: boolean;
  worker: IntelisisFeWorker | null;
  pendientes: number;
  sin_confirmar: number;
  activos: IntelisisReenvioFila[];
  historial: IntelisisReenvioFila[];
  resumen: Record<string, number>;
  total: number;
  /** Si el encolado esta habilitado (lo agrega el borde). */
  habilitado?: boolean;
  /** Tope de documentos por solicitud (lo agrega el borde). */
  max_batch?: number;
}

export interface IntelisisReenvioResolucion {
  queue_id: number;
  estado: IntelisisReenvioEstado;
  mensaje: string;
}
