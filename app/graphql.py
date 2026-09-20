from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
from syner_check.graphql_client import GraphQLClient
from syner_check import auth as keycloak_auth
from syner_check.config import get_graphql_url, resolve_graphql_token

SUMMARY_QUERIES = {
"BOLETA": """query Receipts($startDate:String!,$endDate:String!){receipts(startDate:$startDate,endDate:$endDate){oid number date createdDate seller crossTotal netTotal contactName}}""",
"FACTURA": """query Invoices($startDate:String!,$endDate:String!){invoices(startDate:$startDate,endDate:$endDate){oid number date createdDate seller crossTotal netTotal contact{name idNumber email}}}""",
"NOTA DE CREDITO": """query CreditNotes($startDate:String!,$endDate:String!){creditNotes(startDate:$startDate,endDate:$endDate){oid number date crossTotal netTotal contactName seller}}"""
}

DETAIL_QUERIES = {
"BOLETA": """query Receipts($startDate:String!,$endDate:String!){receipts(startDate:$startDate,endDate:$endDate){
seller crossTotal createdDate nota contactName oid netTotal date number
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

def _client():
    graphql_url = get_graphql_url()
    if not graphql_url:
        raise RuntimeError("GRAPHQL_URL no está configurado.")
    token = resolve_graphql_token()[0]
    def reauth():
        try:
            return keycloak_auth.refresh()["access_token"]
        except RuntimeError:
            return keycloak_auth.get_token()["access_token"]
    return GraphQLClient(graphql_url, token=token, on_unauthorized=reauth)

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
