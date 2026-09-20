from __future__ import annotations

import csv
import os
import sys
from collections import Counter
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any


def normalize_key(value: Any) -> str:
    """Generic key normalizer: trim + upper-case, numbers to plain str."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value).upper()
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return repr(value).strip().upper()
    if isinstance(value, Decimal):
        if value == value.to_integral_value():
            return str(int(value))
        return str(value.normalize()).upper()
    return str(value).strip().upper()


def _normalize_id(value: Any) -> str:
    """IDSynerPos/oid as string ('14140.100075' float == '14140.100075')."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value).strip().upper()
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return repr(value).strip().upper()
    if isinstance(value, Decimal):
        if value == value.to_integral_value():
            return str(int(value))
        return str(value.normalize()).upper()
    text = str(value).strip()
    if not text:
        return ""
    upper = text.upper()
    try:
        as_float = float(upper)
    except ValueError:
        return upper
    if as_float.is_integer():
        return str(int(as_float))
    return upper


def _normalize_branch(value: Any) -> str:
    """Sucursal as string without decimals ('104.0' -> '104')."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value).strip().upper()
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return repr(value).strip().upper()
    if isinstance(value, Decimal):
        if value == value.to_integral_value():
            return str(int(value))
        return str(value.normalize()).upper()
    text = str(value).strip()
    if not text:
        return ""
    try:
        as_float = float(text)
    except ValueError:
        return text.upper()
    if as_float.is_integer():
        return str(int(as_float))
    return text.upper()


def _normalize_date_only(value: Any) -> str:
    """FechaDocumento reduced to YYYY-MM-DD (date part only)."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    if not text:
        return ""
    for candidate in (text, text.replace("Z", "+00:00")):
        try:
            return datetime.fromisoformat(candidate).date().isoformat()
        except ValueError:
            continue
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:10], fmt).date().isoformat()
        except ValueError:
            continue
    return text[:10].upper()


def _first_present(data: dict[str, Any], names: tuple[str, ...]) -> Any:
    for name in names:
        if isinstance(data, dict) and data.get(name) not in (None, ""):
            return data.get(name)
    return ""


def _parse_created_datetime(value: Any) -> datetime | None:
    """Parse a GraphQL createdDate into an aware datetime, or None.

    Accepts ISO strings with `Z`/offset or timezone-naive (assumed local).
    Never raises: unparseable input yields None (caller falls back).
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        return None
    else:
        text = str(value).strip()
        if not text:
            return None
        parsed = None
        candidates = [text]
        if text.endswith(("Z", "z")):
            candidates.append(text[:-1] + "+00:00")
        elif "Z" in text or "z" in text:
            candidates.append(text.replace("Z", "+00:00").replace("z", "+00:00"))
        for candidate in candidates:
            try:
                parsed = datetime.fromisoformat(candidate)
                break
            except ValueError:
                continue
        if parsed is None:
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S"):
                try:
                    parsed = datetime.strptime(text[:19], fmt)
                    break
                except ValueError:
                    continue
        if parsed is None:
            return None
    try:
        if parsed.tzinfo is None:
            return parsed.astimezone()
        return parsed
    except Exception:
        return None


def _format_hace(created: datetime, now: datetime) -> str:
    """Elapsed label: >=48h -> `hace Nd`; >=60m -> `hace Xh Ym`; else `hace Zm`.

    Future deltas yield "" (caller omits the hace part). No accents.
    """
    try:
        total_seconds = (now - created).total_seconds()
    except Exception:
        return ""
    if total_seconds < 0:
        return ""
    if total_seconds >= 48 * 3600:
        return f"hace {int(total_seconds // 86400)}d"
    if total_seconds >= 3600:
        hours = int(total_seconds // 3600)
        minutes = int((total_seconds % 3600) // 60)
        if minutes:
            return f"hace {hours}h {minutes}m"
        return f"hace {hours}h"
    return f"hace {int(total_seconds // 60)}m"


def _format_fecha_display(
    fecha_only: Any, created_raw: Any, now: datetime | None = None
) -> str:
    """Display `YYYY-MM-DD HH:MM (hace X)`; falls back to date-only.

    Parse failures (or missing createdDate) return the date-only string;
    future timestamps keep `HH:MM` but omit the hace part. Never raises.
    """
    fecha = str(fecha_only or "")
    try:
        created = _parse_created_datetime(created_raw)
        if created is None:
            return fecha
        local = created.astimezone()
        moment = f"{local.hour:02d}:{local.minute:02d}"
        base_date = fecha or local.date().isoformat()
        base = f"{base_date} {moment}" if base_date else moment
        current = now if isinstance(now, datetime) else datetime.now().astimezone()
        hace = _format_hace(created, current)
        if hace:
            return f"{base} ({hace})"
        return base
    except Exception:
        return fecha


# --- Comparacion por grano cabecera (resumen consola + export CSV) ---
#
# Grano: UNA fila por documento cabecera.
#   clave cabecera = (_normalize_id, normalize_key(tipo), _normalize_date_only)
#     GraphQL: oid + tipo de la coleccion + date
#     SQL:     IDSynerPos + TipoDocumento + FechaDocumento
# (SerieNumero/number NO forma parte de la clave; se conserva para mostrar
# y exportar. Sucursal NO forma parte: no se selecciona en SQL.)
#
# Las claves repetidas se cuentan con Counter, nunca se colapsan: dos
# cabeceras GraphQL identicas con una sola contraparte SQL dan
# 1 coincidente + 1 faltante.
#
# El grano SQL es LINEA (su PK incluye Idx): varias filas SQL pueden
# compartir una clave cabecera (documentos multi-linea). _compare_header_tipo
# colapsa esas filas a UNA por clave cabecera antes de contar, para que
# sql/matched/extra_in_sql cuenten DOCUMENTOS y no lineas. El detalle de
# lineas (compare_line_detail) conserva las filas crudas y compara bolsas.
#
# El detalle de lineas (opt-in) compara bolsas (Counter) de
# (id_norm, tipo_norm, sku_norm) solo en cabeceras coincidentes.
# Idx se excluye (GraphQL no lo tiene) y los sku vacios se ignoran.

CANONICAL_TIPOS = ("FACTURA", "BOLETA", "NOTA DE CREDITO")

CSV_EXPORT_COLUMNS = ("tipo", "IDSynerPos", "SerieNumero", "fecha")

_TIPO_ALIASES = {
    "factura": "FACTURA",
    "facturas": "FACTURA",
    "invoice": "FACTURA",
    "invoices": "FACTURA",
    "boleta": "BOLETA",
    "boletas": "BOLETA",
    "receipt": "BOLETA",
    "receipts": "BOLETA",
    "nc": "NOTA DE CREDITO",
    "n/c": "NOTA DE CREDITO",
    "nota de credito": "NOTA DE CREDITO",
    "nota de crédito": "NOTA DE CREDITO",
    "nota_de_credito": "NOTA DE CREDITO",
    "nota_credito": "NOTA DE CREDITO",
    "notadecredito": "NOTA DE CREDITO",
    "nota credito": "NOTA DE CREDITO",
    "credit_note": "NOTA DE CREDITO",
    "credit_notes": "NOTA DE CREDITO",
    "creditnote": "NOTA DE CREDITO",
    "creditnotes": "NOTA DE CREDITO",
}

_GRAPHQL_ID_FIELDS = ("oid", "idSynerPos", "id")
_GRAPHQL_NUMBER_FIELDS = ("number", "serieNumero", "seriesNumber")
_GRAPHQL_DATE_FIELDS = ("date", "fecha", "fechaDocumento", "FechaDocumento")
_GRAPHQL_CREATED_FIELDS = ("createdDate",)
_GRAPHQL_TIPO_FIELDS = ("tipoDocumento", "documentType", "type", "TipoDocumento")


def _canonical_tipo(token: str) -> str | None:
    """Map a lower-cased token to its canonical tipo, or None."""
    cleaned = " ".join(token.split())
    candidates = [
        cleaned,
        " ".join(cleaned.replace("_", " ").replace("-", " ").split()),
        cleaned.replace(" ", "").replace("_", "").replace("-", ""),
    ]
    for candidate in candidates:
        hit = _TIPO_ALIASES.get(candidate)
        if hit is not None:
            return hit
    return None


def parse_tipos(value: Any) -> list[str]:
    """Parse user input into canonical tipos (FACTURA/BOLETA/NOTA DE CREDITO).

    Accepts a comma-separated string (case-insensitive) or a list/tuple.
    Aliases: factura, boleta, nc (plus invoice/receipt/credit_note variants);
    todos/all/* expands to every tipo. Order is preserved, duplicates drop.
    Raises ValueError on unknown or empty input.
    """
    if value is None:
        return list(CANONICAL_TIPOS)
    if isinstance(value, (list, tuple)):
        raw_parts: list[str] = []
        for item in value:
            raw_parts.extend(str(item).split(","))
    else:
        raw_parts = str(value).split(",")
    tipos: list[str] = []
    for raw in raw_parts:
        token = str(raw).strip().lower()
        if not token:
            continue
        if token in ("todos", "todo", "all", "*"):
            for canonical in CANONICAL_TIPOS:
                if canonical not in tipos:
                    tipos.append(canonical)
            continue
        canonical = _canonical_tipo(token)
        if canonical is None:
            raise ValueError(
                f"Tipo no soportado: {str(raw).strip()!r}. "
                "Use factura, boleta, nc."
            )
        if canonical not in tipos:
            tipos.append(canonical)
    if not tipos:
        raise ValueError("Sin tipos: use factura, boleta, nc (separados por coma).")
    return tipos


def _raw_str(value: Any) -> str:
    """Raw value as stripped string (no upper-casing, for display/CSV)."""
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _header_key_graphql(doc: dict[str, Any], tipo_default: str = "") -> tuple[str, ...]:
    """Header key for a GraphQL doc: (id_norm, tipo_norm, fecha_only)."""
    data = doc if isinstance(doc, dict) else {}
    raw_tipo = _first_present(data, _GRAPHQL_TIPO_FIELDS)
    tipo = (
        normalize_key(raw_tipo)
        if raw_tipo not in (None, "")
        else normalize_key(tipo_default)
    )
    return (
        _normalize_id(_first_present(data, _GRAPHQL_ID_FIELDS)),
        tipo,
        _normalize_date_only(_first_present(data, _GRAPHQL_DATE_FIELDS)),
    )


def _header_key_sql(row: dict[str, Any]) -> tuple[str, ...]:
    """Header key for a SQL row: (id_norm, tipo_norm, fecha_only)."""
    data = row if isinstance(row, dict) else {}
    return (
        _normalize_id(data.get("IDSynerPos")),
        normalize_key(data.get("TipoDocumento")),
        _normalize_date_only(data.get("FechaDocumento")),
    )


def _partition_sql_by_tipo(sql_rows: Any) -> dict[str, list[dict[str, Any]]]:
    """Group SQL rows by normalized TipoDocumento (encounter order)."""
    by_tipo: dict[str, list[dict[str, Any]]] = {}
    for row in sql_rows or []:
        if not isinstance(row, dict):
            continue
        by_tipo.setdefault(normalize_key(row.get("TipoDocumento")), []).append(row)
    return by_tipo


def _ordered_tipos(graphql_by_tipo: Any, sql_by_tipo: dict[str, Any]) -> list[str]:
    """Requested tipos first (their order), then any SQL-only tipos."""
    wanted = list((graphql_by_tipo or {}).keys())
    ordered = list(wanted)
    for tipo in sql_by_tipo:
        if tipo not in (graphql_by_tipo or {}):
            ordered.append(tipo)
    return ordered


def _compare_header_tipo(
    tipo: str,
    docs: list[dict[str, Any]],
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compare one tipo at header grain with Counter allocation.

    Deterministic: graphql docs allocate SQL counterparts in input order,
    so duplicate keys yield matched + missing instead of collapsing.

    SQL rows arrive at LINE grain (one row per SKU, PK includes Idx), so
    multi-line documents repeat the same header key. Rows are collapsed to
    one per header key first, making every count a DOCUMENT count.
    """
    tipo_norm = normalize_key(tipo)
    docs = list(docs or [])
    rows = list(rows or [])
    seen_headers: set[tuple[str, ...]] = set()
    deduped_rows: list[dict[str, Any]] = []
    for row in rows:
        key = _header_key_sql(row)
        if key in seen_headers:
            continue
        seen_headers.add(key)
        deduped_rows.append(row)
    rows = deduped_rows
    g_keys = [_header_key_graphql(doc, tipo_norm) for doc in docs]

    # Display-only: first createdDate seen per header key (SQL rows carry
    # none). The match key stays date-only; this never affects allocation.
    created_by_key: dict[tuple[str, ...], str] = {}
    for doc, key in zip(docs, g_keys):
        if key not in created_by_key:
            raw_created = _first_present(
                doc if isinstance(doc, dict) else {}, _GRAPHQL_CREATED_FIELDS
            )
            if raw_created not in (None, ""):
                created_by_key[key] = (
                    raw_created
                    if isinstance(raw_created, str)
                    else str(raw_created).strip()
                )

    sql_available: Counter = Counter(_header_key_sql(row) for row in rows)
    missing_rows: list[dict[str, str]] = []
    matched = 0
    for doc, key in zip(docs, g_keys):
        if sql_available.get(key, 0) > 0:
            sql_available[key] -= 1
            matched += 1
        else:
            data = doc if isinstance(doc, dict) else {}
            missing_rows.append(
                {
                    "tipo": tipo_norm,
                    "IDSynerPos": _raw_str(
                        _first_present(data, _GRAPHQL_ID_FIELDS)
                    ),
                    "SerieNumero": _raw_str(
                        _first_present(data, _GRAPHQL_NUMBER_FIELDS)
                    ),
                    "fecha": key[2],
                    "createdDate": created_by_key.get(key, ""),
                }
            )

    graphql_available: Counter = Counter(g_keys)
    extra_rows: list[dict[str, str]] = []
    for row in rows:
        key = _header_key_sql(row)
        if graphql_available.get(key, 0) > 0:
            graphql_available[key] -= 1
        else:
            data = row if isinstance(row, dict) else {}
            extra_rows.append(
                {
                    "tipo": normalize_key(data.get("TipoDocumento")) or tipo_norm,
                    "IDSynerPos": _raw_str(data.get("IDSynerPos")),
                    "SerieNumero": _raw_str(data.get("SerieNumero")),
                    "fecha": key[2],
                }
            )

    by_day: dict[str, dict[str, int]] = {}
    for key in g_keys:
        slot = by_day.setdefault(
            key[2] or "(sin fecha)", {"graphql": 0, "sql": 0, "missing": 0}
        )
        slot["graphql"] += 1
    for row in rows:
        fecha = _header_key_sql(row)[2] or "(sin fecha)"
        by_day.setdefault(fecha, {"graphql": 0, "sql": 0, "missing": 0})[
            "sql"
        ] += 1
    for missing in missing_rows:
        fecha = missing.get("fecha") or "(sin fecha)"
        by_day.setdefault(fecha, {"graphql": 0, "sql": 0, "missing": 0})[
            "missing"
        ] += 1

    counts = {
        "graphql": len(docs),
        "sql": len(rows),
        "matched": matched,
        "missing_in_sql": len(missing_rows),
        "extra_in_sql": len(extra_rows),
    }
    return {
        **counts,
        "counts": dict(counts),
        "missing_rows": missing_rows,
        "missing": missing_rows,
        "extra_rows": extra_rows,
        "extra": extra_rows,
        "by_day": by_day,
    }


def compare_headers(
    graphql_by_tipo: dict[str, list[dict[str, Any]]],
    sql_rows: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Compare GraphQL docs vs SQL rows at header grain, per tipo.

    Returns per_tipo[tipo] with int counts (graphql, sql, matched,
    missing_in_sql, extra_in_sql + counts alias), missing_rows/extra_rows
    lists of {tipo, IDSynerPos, SerieNumero, fecha} and a by_day breakdown.
    """
    graphql_by_tipo = graphql_by_tipo or {}
    sql_by_tipo = _partition_sql_by_tipo(sql_rows)
    per_tipo: dict[str, dict[str, Any]] = {}
    for tipo in _ordered_tipos(graphql_by_tipo, sql_by_tipo):
        docs = graphql_by_tipo.get(tipo) or []
        rows = sql_by_tipo.get(normalize_key(tipo), [])
        per_tipo[tipo] = _compare_header_tipo(tipo, docs, rows)
    return per_tipo


def _doc_skus(doc: dict[str, Any]) -> list[str]:
    """Normalized non-empty skus from a GraphQL doc (items/lines)."""
    data = doc if isinstance(doc, dict) else {}
    items = data.get("items", data.get("lines", []))
    if isinstance(items, dict):
        items = [items]
    if not isinstance(items, list):
        return []
    skus: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        sku = normalize_key(item.get("sku", item.get("Sku", "")))
        if sku:
            skus.append(sku)
    return skus


def _compare_line_tipo(
    tipo: str,
    docs: list[dict[str, Any]],
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Line-bag Counter comparison for one tipo, matched headers only."""
    tipo_norm = normalize_key(tipo)
    docs = list(docs or [])
    rows = list(rows or [])
    g_header: Counter = Counter(
        _header_key_graphql(doc, tipo_norm) for doc in docs
    )
    s_header: Counter = Counter(_header_key_sql(row) for row in rows)
    matched_headers = set(g_header) & set(s_header)

    g_counter: Counter = Counter()
    for doc in docs:
        key = _header_key_graphql(doc, tipo_norm)
        if key not in matched_headers:
            continue
        for sku in _doc_skus(doc):
            g_counter[(key[0], key[1], sku)] += 1
    s_counter: Counter = Counter()
    for row in rows:
        key = _header_key_sql(row)
        if key not in matched_headers:
            continue
        sku = normalize_key(row.get("Sku") if isinstance(row, dict) else "")
        if not sku:
            continue
        s_counter[(key[0], key[1], sku)] += 1

    matched_lines = sum(
        min(count, s_counter.get(key, 0)) for key, count in g_counter.items()
    )
    only_graphql = [
        {
            "IDSynerPos": key[0],
            "tipo": key[1],
            "sku": key[2],
            "graphql": count,
            "sql": s_counter.get(key, 0),
        }
        for key, count in sorted(g_counter.items())
        if count > s_counter.get(key, 0)
    ]
    only_sql = [
        {
            "IDSynerPos": key[0],
            "tipo": key[1],
            "sku": key[2],
            "graphql": g_counter.get(key, 0),
            "sql": count,
        }
        for key, count in sorted(s_counter.items())
        if count > g_counter.get(key, 0)
    ]
    counts = {
        "graphql_lines": sum(g_counter.values()),
        "sql_lines": sum(s_counter.values()),
        "matched_lines": matched_lines,
        "missing_in_sql": sum(
            diff["graphql"] - diff["sql"] for diff in only_graphql
        ),
        "extra_in_sql": sum(
            diff["sql"] - diff["graphql"] for diff in only_sql
        ),
    }
    return {
        **counts,
        "counts": dict(counts),
        "only_in_graphql": only_graphql,
        "only_in_sql": only_sql,
    }


def compare_line_detail(
    graphql_by_tipo: dict[str, list[dict[str, Any]]],
    sql_rows: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Counter bag of (id_norm, tipo_norm, sku_norm) per tipo.

    Only headers present on both sides contribute lines; Idx excluded.
    Returns per_tipo[tipo] with line counts + only_in_graphql/only_in_sql
    diff lists of {IDSynerPos, tipo, sku, graphql, sql}.
    """
    graphql_by_tipo = graphql_by_tipo or {}
    sql_by_tipo = _partition_sql_by_tipo(sql_rows)
    detail: dict[str, dict[str, Any]] = {}
    for tipo in _ordered_tipos(graphql_by_tipo, sql_by_tipo):
        docs = graphql_by_tipo.get(tipo) or []
        rows = sql_by_tipo.get(normalize_key(tipo), [])
        detail[tipo] = _compare_line_tipo(tipo, docs, rows)
    return detail


_ANSI_RESET = "\x1b[0m"
_ANSI_BOLD = "\x1b[1m"
_ANSI_RED = "\x1b[31m"
_ANSI_GREEN = "\x1b[32m"
_ANSI_YELLOW = "\x1b[33m"

# stdlib ANSI only (no colorama): Windows 10+ consoles handle ANSI natively
# and NO_COLOR / non-tty fallback covers legacy consoles and pipes.


def _colors_enabled() -> bool:
    """True when colors may be emitted (NO_COLOR empty + tty stdout)."""
    if os.environ.get("NO_COLOR"):
        return False
    try:
        return sys.stdout.isatty()
    except Exception:
        return False


def _paint(text: str, code: str) -> str:
    """Wrap text in an ANSI code, or return plain when colors are off."""
    if not _colors_enabled():
        return text
    return f"{code}{text}{_ANSI_RESET}"


def _resumen_periodo(per_tipo: dict[str, Any]) -> str:
    """Derive 'YYYY-MM-DD a YYYY-MM-DD' from by_day keys, '' if unknown."""
    fechas: list[str] = []
    for stats in (per_tipo or {}).values():
        if not isinstance(stats, dict):
            continue
        by_day = stats.get("by_day") or {}
        if not isinstance(by_day, dict):
            continue
        for fecha in by_day:
            if fecha and fecha != "(sin fecha)" and fecha not in fechas:
                fechas.append(str(fecha))
    if not fechas:
        return ""
    fechas.sort()
    if len(fechas) == 1:
        return fechas[0]
    return f"{fechas[0]} a {fechas[-1]}"


def print_summary(
    per_tipo: dict[str, dict[str, Any]] | None,
    muestra: int = 50,
    line_detail: dict[str, dict[str, Any]] | None = None,
) -> None:
    """Print the console resumen: per tipo + per day, missing list capped.

    No JSON is written. The missing list per tipo shows at most `muestra`
    rows (counts always cover everything; --export CSV carries all rows).
    Missing rows display `fecha=YYYY-MM-DD HH:MM (hace X)` when the GraphQL
    doc carried createdDate (display only; match keys and CSV stay date-only).
    Colors use stdlib ANSI only and are disabled when NO_COLOR is set
    (any non-empty value) or when stdout is not a tty (piped output).
    """
    per_tipo = per_tipo or {}
    try:
        cap = int(muestra)
    except (TypeError, ValueError):
        cap = 50
    if cap < 0:
        cap = 0
    tipos_label = ", ".join(str(tipo) for tipo in per_tipo.keys()) or "-"
    periodo = _resumen_periodo(per_tipo)
    print("=" * 60)
    print(
        _paint(
            "RESUMEN (grano cabecera: IDSynerPos + TipoDocumento + fecha)",
            _ANSI_BOLD,
        )
    )
    print(f"Tipos  : {tipos_label}")
    if periodo:
        print(f"Periodo: {periodo}")
    print("=" * 60)
    if not per_tipo:
        print("Sin tipos para resumir.")
        return
    total_g = total_s = total_m = total_miss = total_extra = 0
    for tipo, stats in per_tipo.items():
        stats = stats if isinstance(stats, dict) else {}
        graphql_n = _safe_int(stats.get("graphql"))
        sql_n = _safe_int(stats.get("sql"))
        matched_n = _safe_int(stats.get("matched"))
        missing_n = _safe_int(stats.get("missing_in_sql"))
        extra_n = _safe_int(stats.get("extra_in_sql"))
        total_g += graphql_n
        total_s += sql_n
        total_m += matched_n
        total_miss += missing_n
        total_extra += extra_n
        if missing_n > 0:
            marker, row_color = "[FALTA]", _ANSI_RED
        else:
            marker, row_color = "[OK]", _ANSI_GREEN
        print(
            _paint(
                f"{str(tipo):<15} "
                f"GraphQL={graphql_n:>7} SQL={sql_n:>7} "
                f"matched={matched_n:>7} faltantes={missing_n:>7} "
                f"extras={extra_n:>7} {marker}",
                row_color,
            )
        )
        by_day = stats.get("by_day") or {}
        if isinstance(by_day, dict):
            for fecha in sorted(by_day):
                day = by_day[fecha] if isinstance(by_day[fecha], dict) else {}
                print(
                    f"  {fecha} GraphQL={_safe_int(day.get('graphql'))} "
                    f"SQL={_safe_int(day.get('sql'))} "
                    f"faltantes={_safe_int(day.get('missing'))}"
                )
        rows = stats.get("missing_rows", stats.get("missing", [])) or []
        rows = [row for row in rows if isinstance(row, dict)]
        if rows and cap > 0:
            print(_paint(f"  Faltantes {tipo} ({len(rows)}):", _ANSI_YELLOW))
            display_now = datetime.now().astimezone()
            for pos, row in enumerate(rows[:cap], start=1):
                try:
                    fecha_display = _format_fecha_display(
                        row.get("fecha", ""),
                        row.get("createdDate", ""),
                        display_now,
                    )
                except Exception:
                    fecha_display = row.get("fecha", "")
                print(
                    f"    {pos:>3}. IDSynerPos={row.get('IDSynerPos', '')} "
                    f"SerieNumero={row.get('SerieNumero', '')} "
                    f"fecha={fecha_display} [FALTA]"
                )
            if len(rows) > cap:
                print(f"    (mostrando {cap} de {len(rows)} faltantes)")
        elif not rows:
            print(_paint(f"  [OK] Sin faltantes {tipo}.", _ANSI_GREEN))
        detail = (
            line_detail.get(tipo) if isinstance(line_detail, dict) else None
        )
        if isinstance(detail, dict) and (
            detail.get("graphql_lines") or detail.get("sql_lines")
        ):
            print(
                f"  Lineas {tipo} (solo cabeceras coincidentes): "
                f"graphql={_safe_int(detail.get('graphql_lines'))} "
                f"sql={_safe_int(detail.get('sql_lines'))} "
                f"coincidentes={_safe_int(detail.get('matched_lines'))} "
                f"solo_graphql={_safe_int(detail.get('missing_in_sql'))} "
                f"solo_sql={_safe_int(detail.get('extra_in_sql'))}"
            )
            if cap > 0:
                only_g = detail.get("only_in_graphql") or []
                only_s = detail.get("only_in_sql") or []
                for diff in only_g[:cap]:
                    if isinstance(diff, dict):
                        print(
                            "    - solo GraphQL: "
                            f"IDSynerPos={diff.get('IDSynerPos', '')} "
                            f"sku={diff.get('sku', '')} "
                            f"(graphql={diff.get('graphql', 0)} "
                            f"sql={diff.get('sql', 0)})"
                        )
                for diff in only_s[:cap]:
                    if isinstance(diff, dict):
                        print(
                            "    - solo SQL: "
                            f"IDSynerPos={diff.get('IDSynerPos', '')} "
                            f"sku={diff.get('sku', '')} "
                            f"(graphql={diff.get('graphql', 0)} "
                            f"sql={diff.get('sql', 0)})"
                        )
                if len(only_g) + len(only_s) > 2 * cap:
                    print(f"    (listas de lineas capadas a {cap} por lado)")
    print("-" * 60)
    print(
        _paint(
            f"TOTAL   GraphQL={total_g:>7} SQL={total_s:>7} "
            f"matched={total_m:>7} faltantes={total_miss:>7} "
            f"extras={total_extra:>7}",
            _ANSI_BOLD,
        )
    )
    if total_miss > 0:
        print(
            _paint("RESULTADO: CON FALTANTES (exit 1)", _ANSI_RED + _ANSI_BOLD)
        )
    else:
        print(_paint("RESULTADO: LIMPIO (exit 0)", _ANSI_GREEN + _ANSI_BOLD))


def iter_missing_rows(
    per_tipo: dict[str, dict[str, Any]] | None,
    order: list[str] | tuple[str, ...] | None = None,
):
    """Yield every missing row as {tipo, IDSynerPos, SerieNumero, fecha}.

    Rows follow `order` first, then any remaining tipo in per_tipo order.
    Nothing is capped: use this for the CSV export, not for the console.
    """
    per_tipo = per_tipo or {}
    if order:
        wanted = list(order)
        sequence = [tipo for tipo in wanted if tipo in per_tipo]
        sequence += [tipo for tipo in per_tipo if tipo not in set(wanted)]
    else:
        sequence = list(per_tipo.keys())
    for tipo in sequence:
        stats = per_tipo.get(tipo) or {}
        if not isinstance(stats, dict):
            continue
        rows = stats.get("missing_rows", stats.get("missing", [])) or []
        for row in rows:
            if isinstance(row, dict):
                yield {column: row.get(column, "") for column in CSV_EXPORT_COLUMNS}


def write_missing_csv(
    per_tipo: dict[str, dict[str, Any]] | None,
    path: str | Path,
    order: list[str] | tuple[str, ...] | None = None,
) -> int:
    """Write ALL missing rows to CSV (stdlib csv only), return row count.

    Columns: tipo,IDSynerPos,SerieNumero,fecha. The header is always
    written (even with zero faltantes) and parent dirs are created.
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    rows = list(iter_missing_rows(per_tipo, order=order))
    with target.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(CSV_EXPORT_COLUMNS))
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)
