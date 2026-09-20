import type {
  DocumentResponse,
  SearchResponse,
  SessionUser,
  SummaryResponse,
} from "./types";

export class AuthError extends Error {
  constructor() {
    super("auth");
    this.name = "AuthError";
  }
}

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  if (response.status === 401) throw new AuthError();
  let body: { detail?: string };
  try {
    body = await response.json();
  } catch {
    throw new Error("Respuesta inválida del servidor.");
  }
  if (!response.ok) throw new Error(body.detail ?? "Error de consulta");
  return body as T;
}

export function getSession(): Promise<{ user: SessionUser | null }> {
  return api("/api/me");
}

export function getSummary(params: {
  start_date: string;
  end_date: string;
  types: string;
}): Promise<SummaryResponse> {
  const qs = new URLSearchParams(params);
  return api(`/api/summary?${qs}`);
}

export function searchByNumber(number: string): Promise<SearchResponse> {
  const qs = new URLSearchParams({ number });
  return api(`/api/search?${qs}`);
}

export function getDocument(
  tipo: string,
  oid: string,
  docDate: string,
  number?: string,
): Promise<DocumentResponse> {
  const qs = new URLSearchParams({ doc_date: docDate });
  if (number) qs.set("number", number);
  const url =
    `/api/document/${encodeURIComponent(tipo)}/${encodeURIComponent(oid)}` +
    `?${qs}`;
  return api(url);
}

export function logout(): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/auth/logout";
  document.body.appendChild(form);
  form.submit();
}
