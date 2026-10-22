import type {
  DocumentResponse,
  IntelisisUfeBusqueda,
  IntelisisUfeDetalle,
  IntelisisUfeResponse,
  IntelisisUfeValidacion,
  MovSynerPosRequestDocumento,
  MovSynerPosResponse,
  SearchResponse,
  SessionUser,
  SummaryResponse,
  SunatDocumentInput,
  SunatJobResponse,
  SunatScope,
  SunatSubmissionResponse,
} from "./types";

export class AuthError extends Error {
  constructor() {
    super("auth");
    this.name = "AuthError";
  }
}

/** A newer request superseded this one (or the view unmounted). */
export class RequestAbortedError extends Error {
  constructor() {
    super("Consulta cancelada.");
    this.name = "RequestAbortedError";
  }
}

/** Non-2xx response with its HTTP status, so callers can branch on 404. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const TIMEOUT_MS = 60_000;
/** GraphQL fallbacks can legitimately take longer than a plain DB read. */
const LONG_TIMEOUT_MS = 180_000;
/** One summary poll is cheap, but a terminal poll also writes the detail. */
const SUNAT_STATUS_TIMEOUT_MS = 60_000;
/** Queueing is fast now; the long work happens in the server background task. */
const SUNAT_SUBMIT_TIMEOUT_MS = 30_000;
const SUNAT_SUBMISSION_TIMEOUT_MS = 30_000;
/** A MovSynerPos batch re-queries GraphQL and inserts per document. */
const MOVSYNERPOS_TIMEOUT_MS = 180_000;

/**
 * Tope de documentos por solicitud SUNAT (lo impone el servidor).
 *
 * La pantalla Intelisis UFE puede tener miles de filas en tabla y las
 * manda todas; por encima de este tope la peticion se rechaza entera.
 */
export const SUNAT_LOTE_MAX = 2000;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function api<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // Combine the caller's signal with our timeout.
  const external = options.signal;
  const forwardAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      signal: controller.signal,
    });
    if (response.status === 401) throw new AuthError();
    let body: { detail?: unknown };
    try {
      body = await response.json();
    } catch {
      throw new Error("Respuesta inválida del servidor.");
    }
    if (!response.ok) {
      // Un 422 de validacion trae `detail` como lista de errores: nunca
      // mostrarlo crudo (salia "[object Object]").
      const detail = body.detail;
      const message =
        typeof detail === "string" && detail.trim()
          ? detail
          : response.status === 422
            ? "Los filtros enviados no son válidos."
            : "Error de consulta";
      throw new ApiError(response.status, message);
    }
    return body as T;
  } catch (error: unknown) {
    if (isAbortError(error)) {
      // Caller cancelled: let the hook ignore it silently.
      if (external?.aborted) throw new RequestAbortedError();
      if (timedOut) {
        throw new Error("La consulta tardó demasiado. Intenta de nuevo.");
      }
      throw new RequestAbortedError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", forwardAbort);
  }
}

export function getSession(): Promise<{ user: SessionUser | null }> {
  return api("/api/me");
}

export function getSummary(
  params: {
    start_date: string;
    end_date: string;
    types: string;
  },
  signal?: AbortSignal,
): Promise<SummaryResponse> {
  const qs = new URLSearchParams(params);
  return api(`/api/summary?${qs}`, { signal }, LONG_TIMEOUT_MS);
}

export function searchByNumber(
  number: string,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const qs = new URLSearchParams({ number });
  return api(`/api/search?${qs}`, { signal }, LONG_TIMEOUT_MS);
}

export function getDocument(
  tipo: string,
  oid: string,
  docDate: string,
  number?: string,
  signal?: AbortSignal,
): Promise<DocumentResponse> {
  const qs = new URLSearchParams({ doc_date: docDate });
  if (number) qs.set("number", number);
  const url =
    `/api/document/${encodeURIComponent(tipo)}/${encodeURIComponent(oid)}` +
    `?${qs}`;
  return api(url, { signal });
}

/**
 * Comprobantes de origen Intelisis con el estado del generador UFE.
 *
 * El rango completo (hasta 31 dias) se resuelve en una consulta contra
 * PUnidas, asi que necesita el mismo margen que un resumen con GraphQL.
 */
export function getIntelisisUfe(
  params: {
    desde: string;
    hasta: string;
    resultado?: string;
    estado?: string;
    incidencia?: string;
    /** Tipos de documento de la consulta (los chips del panel). */
    tipos?: string[];
    generador?: string;
    sunat?: string;
    sucursal?: number;
    q?: string;
  },
  signal?: AbortSignal,
): Promise<IntelisisUfeResponse> {
  const qs = new URLSearchParams();
  qs.set("desde", params.desde);
  qs.set("hasta", params.hasta);
  if (params.resultado) qs.set("resultado", params.resultado);
  if (params.estado) qs.set("estado", params.estado);
  if (params.incidencia) qs.set("incidencia", params.incidencia);
  // El tipo de documento es una lista: los filtros de la fila de la tabla
  // (incluido el Tipo por columna) se aplican en el navegador y no viajan.
  if (params.tipos?.length) qs.set("tipo", params.tipos.join(","));
  if (params.generador) qs.set("generador", params.generador);
  if (params.sunat) qs.set("sunat", params.sunat);
  if (params.sucursal !== undefined) qs.set("sucursal", String(params.sucursal));
  if (params.q) qs.set("q", params.q);
  return api(`/api/intelisis/ufe?${qs}`, { signal }, LONG_TIMEOUT_MS);
}

/** Trazabilidad de un comprobante UFE: venta, intentos del generador y SUNAT. */
export function getIntelisisUfeDetalle(
  idVenta: number,
  signal?: AbortSignal,
): Promise<IntelisisUfeDetalle> {
  return api(`/api/intelisis/ufe/${encodeURIComponent(idVenta)}`, { signal });
}

/** Busca un comprobante UFE por su numero oficial (sin periodo). */
export function buscarIntelisisUfe(
  documento: string,
  signal?: AbortSignal,
): Promise<IntelisisUfeBusqueda> {
  const qs = new URLSearchParams({ documento });
  return api(`/api/intelisis/ufe/buscar?${qs}`, { signal }, LONG_TIMEOUT_MS);
}

/**
 * Consulta individual en SUNAT.
 *
 * Es la unica accion que gasta cuota del validador: la pantalla la pide
 * de forma explicita, documento por documento.
 */
export function validarIntelisisUfe(
  idVenta: number,
  signal?: AbortSignal,
): Promise<IntelisisUfeValidacion> {
  return api(
    "/api/intelisis/ufe/validar",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_venta: idVenta }),
      signal,
    },
    SUNAT_STATUS_TIMEOUT_MS,
  );
}

export function logout(): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/auth/logout";
  document.body.appendChild(form);
  form.submit();
}

export function submitSunatLote(
  documentos: SunatDocumentInput[],
  alcance: SunatScope = "no_aceptados",
  signal?: AbortSignal,
): Promise<SunatSubmissionResponse> {
  return api(
    "/api/sunat/lotes",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentos, alcance }),
      signal,
    },
    SUNAT_SUBMIT_TIMEOUT_MS,
  );
}

export function sunatSubmissionStatus(
  solicitudId: string,
  signal?: AbortSignal,
): Promise<SunatSubmissionResponse> {
  return api(
    `/api/sunat/solicitudes/${encodeURIComponent(solicitudId)}`,
    { signal },
    SUNAT_SUBMISSION_TIMEOUT_MS,
  );
}

export function sunatJobStatus(
  trabajoId: number,
  signal?: AbortSignal,
): Promise<SunatJobResponse> {
  return api(
    `/api/sunat/lotes/${trabajoId}`,
    { signal },
    SUNAT_STATUS_TIMEOUT_MS,
  );
}

/**
 * Manual SynerCom -> dbo.MovSynerPos resend.
 *
 * Only document identity is sent; the backend re-queries each detail from
 * GraphQL. ``reparar`` inserts missing lines of documents that already have
 * some rows (never updates or deletes).
 */
export function sendMovSynerPos(
  documentos: MovSynerPosRequestDocumento[],
  reparar: boolean,
  signal?: AbortSignal,
): Promise<MovSynerPosResponse> {
  return api(
    "/api/movsynerpos/enviar",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentos, reparar }),
      signal,
    },
    MOVSYNERPOS_TIMEOUT_MS,
  );
}
