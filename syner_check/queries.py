"""Slim GraphQL queries: header grain by default, sku detail opt-in.

Header queries fetch only (oid, number, date) — enough for the header key
(norm_id, norm_tipo, fecha_only). Detail queries add items{sku} for the
line-bag Counter. No pagination vars exist server-side; counts may truncate.
"""

RECEIPTS_HEADERS_QUERY = """
query Receipts($startDate: String!, $endDate: String!) {
    receipts(startDate: $startDate, endDate: $endDate) {
        oid
        number
        date
        createdDate
    }
}
"""


INVOICES_HEADERS_QUERY = """
query Invoices($startDate: String!, $endDate: String!) {
    invoices(startDate: $startDate, endDate: $endDate) {
        oid
        number
        date
        createdDate
    }
}
"""


CREDIT_NOTES_HEADERS_QUERY = """
query CreditNotes($startDate: String!, $endDate: String!) {
    creditNotes(startDate: $startDate, endDate: $endDate) {
        oid
        number
        date
    }
}
"""


RECEIPTS_DETAIL_QUERY = """
query Receipts($startDate: String!, $endDate: String!) {
    receipts(startDate: $startDate, endDate: $endDate) {
        oid
        number
        date
        createdDate
        items {
            sku
        }
    }
}
"""


INVOICES_DETAIL_QUERY = """
query Invoices($startDate: String!, $endDate: String!) {
    invoices(startDate: $startDate, endDate: $endDate) {
        oid
        number
        date
        createdDate
        items {
            sku
        }
    }
}
"""


CREDIT_NOTES_DETAIL_QUERY = """
query CreditNotes($startDate: String!, $endDate: String!) {
    creditNotes(startDate: $startDate, endDate: $endDate) {
        oid
        number
        date
        items {
            sku
        }
    }
}
"""

# Backward-compatible aliases (slim detail grain: oid/number/date + sku).
RECEIPTS_QUERY = RECEIPTS_DETAIL_QUERY
INVOICES_QUERY = INVOICES_DETAIL_QUERY
CREDIT_NOTES_QUERY = CREDIT_NOTES_DETAIL_QUERY

# Canonical tipo literal -> (collection key, headers query, detail query).
QUERIES_BY_TIPO = {
    "BOLETA": ("receipts", RECEIPTS_HEADERS_QUERY, RECEIPTS_DETAIL_QUERY),
    "FACTURA": ("invoices", INVOICES_HEADERS_QUERY, INVOICES_DETAIL_QUERY),
    "NOTA DE CREDITO": (
        "credit_notes",
        CREDIT_NOTES_HEADERS_QUERY,
        CREDIT_NOTES_DETAIL_QUERY,
    ),
}
