from concurrent.futures import ThreadPoolExecutor

from . import auth as _auth
from .comparison import (
    compare_headers,
    compare_line_detail,
    print_summary,
)
from .config import get_graphql_url, resolve_graphql_token
from .db_client import fetch_sql_documents
from .graphql_client import GraphQLClient
from .queries import QUERIES_BY_TIPO


def _fetch_docs(client, query, variables):
    """Fetch one collection without printing (caller reports in order)."""
    payload = client.execute(query, variables)
    data = payload.get("data", {})
    for key in ("invoices", "creditNotes", "receipts", "credit_notes"):
        if isinstance(data.get(key), list):
            return data[key]
    return []


def extract(
    start_date: str,
    end_date: str,
    tipos: list[str] | tuple[str, ...] | None = None,
    detalle_lineas: bool = False,
    muestra: int = 50,
):
    """Fetch requested tipos from GraphQL + SQL, print console-only resumen.

    No JSON is written. Header grain answers which documents are missing;
    line-bag detail runs only when requested and only for matched headers.
    """
    graphql_url = get_graphql_url()
    if not graphql_url:
        raise RuntimeError("No se configuró GRAPHQL_URL.")
    token, _ = resolve_graphql_token()
    if not token:
        raise RuntimeError("No se pudo obtener el token GraphQL.")

    wanted = list(tipos) if tipos else ["FACTURA", "BOLETA", "NOTA DE CREDITO"]

    def _reauth() -> str:
        try:
            return _auth.refresh()["access_token"]
        except RuntimeError:
            return _auth.get_token()["access_token"]

    client = GraphQLClient(
        url=graphql_url, token=token, on_unauthorized=_reauth
    )
    variables = {"startDate": start_date, "endDate": end_date}

    print("=" * 60)
    print("SYNER-CHECK: faltantes en DB")
    print("=" * 60)
    print(f"Endpoint : {graphql_url}")
    print("Token: obtenido via Keycloak (auto)")
    print(f"Desde    : {start_date}")
    print(f"Hasta    : {end_date}")
    print(f"Tipos    : {', '.join(wanted)}")
    print()

    graphql_by_tipo: dict[str, list] = {}
    queries: dict[str, str] = {}
    for tipo in wanted:
        entry = QUERIES_BY_TIPO.get(tipo)
        if entry is None:
            raise ValueError(f"Tipo no soportado: {tipo!r}.")
        _, headers_query, detail_query = entry
        queries[tipo] = detail_query if detalle_lineas else headers_query

    # Concurrent fetch; console reporting stays in `wanted` order.
    max_workers = min(3, len(wanted)) if wanted else 1
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            tipo: pool.submit(_fetch_docs, client, queries[tipo], variables)
            for tipo in wanted
        }
        for tipo in wanted:
            docs = futures[tipo].result()
            print(f"Consultando {tipo}...")
            print(f"      Registros obtenidos: {len(docs)}")
            graphql_by_tipo[tipo] = docs

    # get_db_config() raises naming the missing env var (never its value).
    sql_rows = fetch_sql_documents(start_date, end_date, tipos=wanted)
    print(f"Registros SQL obtenidos: {len(sql_rows)}")

    per_tipo = compare_headers(graphql_by_tipo, sql_rows)
    line_detail = None
    if detalle_lineas:
        line_detail = compare_line_detail(graphql_by_tipo, sql_rows)

    print_summary(
        per_tipo,
        muestra=muestra,
        line_detail=line_detail,
    )
    return {"per_tipo": per_tipo, "line_detail": line_detail}
