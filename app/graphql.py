from __future__ import annotations
import threading
from concurrent.futures import ThreadPoolExecutor
from syner_check.graphql_client import GraphQLClient
from syner_check import auth as keycloak_auth
from syner_check.config import (
    get_graphql_company_id,
    get_graphql_url,
    resolve_graphql_token,
)

SUMMARY_QUERIES = {
"BOLETA": """query Receipts($startDate:String!,$endDate:String!){receipts(startDate:$startDate,endDate:$endDate){oid number date createdDate seller crossTotal netTotal contactName currency{isoCode isoNumber name symbol} contact{name idNumber email}}}""",
"FACTURA": """query Invoices($startDate:String!,$endDate:String!){invoices(startDate:$startDate,endDate:$endDate){oid number date createdDate seller crossTotal netTotal contact{name idNumber email} currency{isoCode isoNumber name symbol}}}""",
"NOTA DE CREDITO": """query CreditNotes($startDate:String!,$endDate:String!){creditNotes(startDate:$startDate,endDate:$endDate){oid number date crossTotal netTotal contactName seller docRef currency{isoCode isoNumber name symbol}}}"""
}

# Server-side number filtering via `serie` (integration manual §5-6).
# Only invoices and receipts support it; creditNotes must still be fetched
# by date range. Same light field set as SUMMARY_QUERIES.
SERIE_QUERIES = {
"BOLETA": """query Receipts($serie:String!){receipts(serie:$serie){oid number date createdDate seller crossTotal netTotal contactName currency{isoCode isoNumber name symbol} contact{name idNumber email}}}""",
"FACTURA": """query Invoices($serie:String!){invoices(serie:$serie){oid number date createdDate seller crossTotal netTotal contact{name idNumber email} currency{isoCode isoNumber name symbol}}}""",
}

DETAIL_QUERIES = {
"BOLETA": """query Receipts($startDate:String!,$endDate:String!){receipts(startDate:$startDate,endDate:$endDate){
seller crossTotal crossTotalDiscount netTotalDiscount createdDate nota contactName oid netTotal date number
taxes{amount base factor name}
contact{idNumber idTypeKey idTypeName name email}
currency{isoCode isoNumber name symbol}
payments{merchantId medio type name cardProvider authorization message panMask serviceProvider amount transactionId pointsAmount pointsPaymentTypeValue pointsPaymentTypeDesc pointsPaymentTypeKey exchangeRate currency{isoCode isoNumber name symbol}}
items{note netUnitPrice crossUnitPrice crossPrice uom sku quantity netPrice skuPu description oid idx taxes{amount base factor name} currency{isoCode isoNumber name symbol} lote{oid sku description} promotion{oid label netDiscount name crossDiscount netUnitDiscount crossUnitDiscount description}}
}}""",
"FACTURA": """query Invoices($startDate:String!,$endDate:String!){invoices(startDate:$startDate,endDate:$endDate){
seller netTotalDiscount createdDate netTotal date oid taxNumber crossTotalDiscount number crossTotal
contact{idNumber idTypeKey idTypeName name email}
items{quantity idx uom crossUnitPrice description crossPrice note sku skuPu netPrice netUnitPrice promotion{description oid netUnitDiscount crossDiscount name label crossUnitDiscount netDiscount} taxes{amount base factor name} lote{oid sku description} currency{isoCode isoNumber name symbol}}
payments{merchantId medio type name cardProvider authorization message panMask serviceProvider amount transactionId pointsAmount pointsPaymentTypeValue pointsPaymentTypeDesc pointsPaymentTypeKey exchangeRate currency{isoCode isoNumber name symbol}}
taxes{amount base factor name} currency{isoCode isoNumber name symbol}
}}""",
"NOTA DE CREDITO": """query CreditNotes($startDate:String!,$endDate:String!){creditNotes(startDate:$startDate,endDate:$endDate){
number netTotal date crossTotal contactName seller oid docRef
items{idx crossPrice crossUnitPrice description netUnitPrice quantity sap sku uom netPrice lote{oid sku description} taxes{amount base factor name} currency{isoCode isoNumber name symbol}}
currency{isoCode isoNumber name symbol} contact{idNumber idTypeKey idTypeName name email} taxes{amount base factor name}
payments{pointsAmount pointsPaymentTypeValue pointsPaymentTypeDesc pointsPaymentTypeKey name authorization panMask transactionId cardProvider type serviceProvider amount exchangeRate medio message merchantId currency{isoCode symbol name isoNumber}}
}}"""
}

def _reauth() -> str:
    try:
        return keycloak_auth.refresh()["access_token"]
    except RuntimeError:
        return keycloak_auth.get_token()["access_token"]


_client_instance: GraphQLClient | None = None
_client_lock = threading.Lock()


def _client() -> GraphQLClient:
    """Lazily build and reuse ONE GraphQL client per process.

    The client owns a ``requests.Session`` (HTTP connection pool / keep-alive)
    and resolves the Keycloak token once. Rebuilding it per query was the main
    per-request cost: every ``_execute`` opened a fresh TCP+TLS connection and
    re-resolved the token, which also let the three parallel ``summary`` calls
    race on the token cache. The URL is still read fresh so a changed
    ``GRAPHQL_URL`` rebuilds the client.
    """
    global _client_instance
    graphql_url = get_graphql_url()
    if not graphql_url:
        raise RuntimeError("GRAPHQL_URL no está configurado.")
    if _client_instance is None or _client_instance.url != graphql_url:
        with _client_lock:
            if _client_instance is None or _client_instance.url != graphql_url:
                token = resolve_graphql_token()[0]
                _client_instance = GraphQLClient(
                    graphql_url,
                    token=token,
                    on_unauthorized=_reauth,
                    company_id=get_graphql_company_id(),
                )
    return _client_instance

def _execute(tipo, query, start_date, end_date):
    data = _client().execute(
        query, {"startDate": start_date, "endDate": end_date}
    ).get("data", {})
    key = {
        "BOLETA": "receipts",
        "FACTURA": "invoices",
        "NOTA DE CREDITO": "creditNotes",
    }[tipo]
    return data.get(key, []) if isinstance(data.get(key), list) else []


def summary(start_date, end_date, tipos):
    with ThreadPoolExecutor(max_workers=max(1, min(3, len(tipos)))) as pool:
        fs = {
            t: pool.submit(_execute, t, SUMMARY_QUERIES[t], start_date, end_date)
            for t in tipos
        }
        return {t: fs[t].result() for t in tipos}


def search_by_serie(tipo, number):
    """Fetch light docs by number using the server-side `serie` filter.

    Sends ``<number>%`` so the server prefix-matches; returns the raw list and
    lets the caller filter for the exact number. Only FACTURA and BOLETA
    support `serie` (integration manual §5-6).
    """
    data = _client().execute(
        SERIE_QUERIES[tipo], {"serie": f"{number.strip()}%"}
    ).get("data", {})
    key = {"BOLETA": "receipts", "FACTURA": "invoices"}[tipo]
    docs = data.get(key, [])
    return docs if isinstance(docs, list) else []


# Full detail selections filtered server-side by `serie` (manual §5-6).
# Same fields as DETAIL_QUERIES; only FACTURA/BOLETA support `serie`.
# Used by the detail drawer so it fetches ONE voucher instead of a full day.
DETAIL_BY_SERIE_QUERIES = {
"BOLETA": """query Receipts($serie:String!){receipts(serie:$serie){
seller crossTotal crossTotalDiscount netTotalDiscount createdDate nota contactName oid netTotal date number
taxes{amount base factor name}
contact{idNumber idTypeKey idTypeName name email}
currency{isoCode isoNumber name symbol}
payments{merchantId medio type name cardProvider authorization message panMask serviceProvider amount transactionId pointsAmount pointsPaymentTypeValue pointsPaymentTypeDesc pointsPaymentTypeKey exchangeRate currency{isoCode isoNumber name symbol}}
items{note netUnitPrice crossUnitPrice crossPrice uom sku quantity netPrice skuPu description oid idx taxes{amount base factor name} currency{isoCode isoNumber name symbol} lote{oid sku description} promotion{oid label netDiscount name crossDiscount netUnitDiscount crossUnitDiscount description}}
}}""",
"FACTURA": """query Invoices($serie:String!){invoices(serie:$serie){
seller netTotalDiscount createdDate netTotal date oid taxNumber crossTotalDiscount number crossTotal
contact{idNumber idTypeKey idTypeName name email}
items{quantity idx uom crossUnitPrice description crossPrice note sku skuPu netPrice netUnitPrice promotion{description oid netUnitDiscount crossDiscount name label crossUnitDiscount netDiscount} taxes{amount base factor name} lote{oid sku description} currency{isoCode isoNumber name symbol}}
payments{merchantId medio type name cardProvider authorization message panMask serviceProvider amount transactionId pointsAmount pointsPaymentTypeValue pointsPaymentTypeDesc pointsPaymentTypeKey exchangeRate currency{isoCode isoNumber name symbol}}
taxes{amount base factor name} currency{isoCode isoNumber name symbol}
}}"""
}


def detail_by_serie(tipo, number):
    """Fetch full detail docs by number using the server-side `serie` filter.

    Sends ``<number>%`` so the server returns only prefix-matching vouchers
    (normally one). Callers filter for the exact oid/number. Only FACTURA and
    BOLETA support `serie`.
    """
    data = _client().execute(
        DETAIL_BY_SERIE_QUERIES[tipo], {"serie": f"{number.strip()}%"}
    ).get("data", {})
    key = {"BOLETA": "receipts", "FACTURA": "invoices"}[tipo]
    docs = data.get(key, [])
    return docs if isinstance(docs, list) else []


def detail(tipo, start_date, end_date, number=None):
    docs = _execute(tipo, DETAIL_QUERIES[tipo], start_date, end_date)
    if number:
        target = number.strip().upper()
        docs = [
            d
            for d in docs
            if str(d.get("number", "")).strip().upper() == target
        ]
    return docs
