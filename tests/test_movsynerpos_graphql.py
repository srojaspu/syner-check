"""F4.1: ``payments.creditNote`` en los detalles de BOLETA/FACTURA."""

from __future__ import annotations

from app.graphql import (
    DETAIL_BY_SERIE_QUERIES,
    DETAIL_QUERIES,
    _filter_partial_errors,
)


def _payments_block(query: str) -> str:
    return next(
        line for line in query.splitlines() if line.startswith("payments{")
    )


def test_boleta_and_factura_detail_select_credit_note() -> None:
    for tipo in ("BOLETA", "FACTURA"):
        assert "creditNote" in _payments_block(DETAIL_QUERIES[tipo])
        assert "creditNote" in _payments_block(DETAIL_BY_SERIE_QUERIES[tipo])


def test_credit_note_detail_is_unchanged() -> None:
    assert (
        "creditNote"
        not in _payments_block(DETAIL_QUERIES["NOTA DE CREDITO"])
    )


def test_partial_graphql_errors_only_tag_affected_documents() -> None:
    result = {
        "errors": [
            {
                "message": "Exception while fetching data (/receipts[0]/items[0]/lote) : null",
                "path": ["receipts", 0, "items", 0, "lote"],
            },
            {
                "message": "Exception while fetching data (/receipts[2]/items[0]/lote) : null",
                "path": ["receipts", 2, "items", 0, "lote"],
            },
        ],
        "data": {
            "receipts": [
                {"oid": "14257.634569", "number": "BS32-00005040"},
                {"oid": "14257.634657", "number": "BS32-00005040"},
                {"oid": "14257.634601", "number": "BS32-00005040"},
            ]
        },
    }
    docs = _filter_partial_errors(result, "receipts")

    assert len(docs) == 3
    assert docs[0]["_graphql_errors"] == ["items/0/lote"]
    assert "_graphql_errors" not in docs[1]
    assert docs[2]["_graphql_errors"] == ["items/0/lote"]

