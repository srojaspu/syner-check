const LOCALE = "es-PE";

/** Plain date (YYYY-MM-DD) for table cells and filters. */
export function formatDate(value?: string): string {
  if (!value) return "—";
  const day = String(value).slice(0, 10);
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Emission timestamp for display + Excel.
 * Prefers GraphQL `createdDate`; credit notes carry none, so it falls
 * back to the date-only field (time unknown, rendered without hour).
 */
export function formatDateTime(
  createdDate?: string,
  date?: string,
): { text: string; iso: string } {
  const raw = (createdDate ?? "").trim();
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        text: parsed.toLocaleString(LOCALE, {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        iso: parsed.toISOString(),
      };
    }
  }
  const day = (date ?? "").slice(0, 10);
  return { text: formatDate(day), iso: day };
}

export function formatMoney(value: unknown, currency = "PEN"): string {
  if (value === null || value === undefined || value === "") return "—";
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
    }).format(Number(value));
  } catch {
    return String(value);
  }
}

/** Local YYYY-MM-DD for a Date (timezone-safe). */
export function toISODate(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}
