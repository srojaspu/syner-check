import type {
  DocumentResponse,
  IntelisisUfeDetalle,
  IntelisisUfeResponse,
  IntelisisUfeValidacion,
  MovSynerPosRequestDocumento,
  MovSynerPosResponse,
  SearchResponse,
  SessionUser,
  SummaryResponse,
  SunatJobResponse,
  SunatScope,
  SunatSubmissionResponse,
  Voucher,
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
    let body: { detail?: string };
    try {
      body = await response.json();
    } catch {
      throw new Error("Respuesta inválida del servidor.");
    }
    if (!response.ok) {
      throw new ApiError(response.status, body.detail ?? "Error de consulta");
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
    tipo?: string;
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
  if (params.tipo) qs.set("tipo", params.tipo);
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
  documentos: Pick<Voucher, "tipo" | "number" | "date" | "crossTotal">[],
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
