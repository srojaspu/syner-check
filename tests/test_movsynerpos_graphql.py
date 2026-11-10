"""F4.1: ``payments.creditNote`` en los detalles de BOLETA/FACTURA."""

from __future__ import annotations

import pytest

from app.graphql import (
    DETAIL_BY_SERIE_QUERIES,
    DETAIL_QUERIES,
    _filter_partial_errors,
    _strip_optional_fields,
)
from syner_check.graphql_client import GraphQLQueryError


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


class _SupportedSchema:
    """Cliente falso: la instancia sí define ``Payment.creditNote``."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    def execute(self, query, variables=None):
        self.queries.append(query)
        return {"data": {"receipts": [{"oid": "14257.53162"}]}}


class _SchemaWithoutCreditNote:
    """Cliente falso: la instancia no define ``Payment.creditNote``."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    def execute(self, query, variables=None):
        self.queries.append(query)
        if "creditNote" in query:
            raise GraphQLQueryError(
                "GraphQL devolvió un error en la consulta.",
                [
                    {
                        "message": (
                            "Validation error "
                            "(FieldUndefined@[receipts/payments/creditNote]) : "
                            "Field 'creditNote' in type 'Payment' is undefined"
                        )
                    }
                ],
            )
        return {"data": {"receipts": [{"oid": "14257.53162"}]}}


def test_supported_schema_sends_the_query_unchanged_with_one_call(monkeypatch):
    """Producción: no hay reintento ni se altera el query."""
    from app import graphql as g

    fake = _SupportedSchema()
    monkeypatch.setattr(g, "_client", lambda: fake)
    monkeypatch.setattr(g, "_unsupported_options", set())

    docs = g.detail_by_serie("BOLETA", "B004-00000696")

    assert docs == [{"oid": "14257.53162"}]
    assert fake.queries == [DETAIL_BY_SERIE_QUERIES["BOLETA"]]
    assert "creditNote" in fake.queries[0]


def test_detail_degrades_when_optional_field_is_missing(monkeypatch):
    from app import graphql as g

    fake = _SchemaWithoutCreditNote()
    monkeypatch.setattr(g, "_client", lambda: fake)
    monkeypatch.setattr(g, "_unsupported_options", set())

    docs = g.detail_by_serie("BOLETA", "B004-00000696")

    assert docs == [{"oid": "14257.53162"}]
    assert "creditNote" in fake.queries[0]
    assert "creditNote" not in fake.queries[1]


def test_optional_field_discovery_is_cached(monkeypatch):
    from app import graphql as g

    fake = _SchemaWithoutCreditNote()
    monkeypatch.setattr(g, "_client", lambda: fake)
    monkeypatch.setattr(g, "_unsupported_options", set())

    g.detail_by_serie("BOLETA", "B004-00000696")
    g.detail_by_serie("BOLETA", "B004-00000697")

    # La primera llamada reintenta; la segunda ya sale sin el campo.
    assert len(fake.queries) == 3
    assert "creditNote" not in fake.queries[2]


def test_unknown_field_is_not_silently_swallowed(monkeypatch):
    from app import graphql as g

    class BrokenClient:
        def execute(self, query, variables=None):
            raise GraphQLQueryError(
                "GraphQL devolvió un error en la consulta.",
                [
                    {
                        "message": (
                            "Validation error (FieldUndefined@[receipts/items/x]) : "
                            "Field 'x' in type 'Item' is undefined"
                        )
                    }
                ],
            )

    monkeypatch.setattr(g, "_client", lambda: BrokenClient())
    monkeypatch.setattr(g, "_unsupported_options", set())

    with pytest.raises(GraphQLQueryError):
        g.detail_by_serie("BOLETA", "B004-00000696")


def test_standard_graphql_unknown_field_message_is_also_supported(monkeypatch):
    from app import graphql as g

    class StandardClient:
        def execute(self, query, variables=None):
            if "creditNote" in query:
                raise GraphQLQueryError(
                    "GraphQL devolvió un error en la consulta.",
                    [
                        {
                            "message": (
                                "Cannot query field 'creditNote' on type "
                                "'Payment'."
                            )
                        }
                    ],
                )
            return {"data": {"receipts": [{"oid": "14257.53162"}]}}

    monkeypatch.setattr(g, "_client", lambda: StandardClient())
    monkeypatch.setattr(g, "_unsupported_options", set())

    assert g.detail_by_serie("BOLETA", "B004-00000696") == [
        {"oid": "14257.53162"}
    ]


def test_strip_optional_field_does_not_touch_credit_notes_root():
    query = "query X{creditNotes{number} receipts{payments{creditNote amount}}}"
    stripped = _strip_optional_fields(query, {"creditNote"})

    assert "creditNotes{" in stripped
    assert "creditNote amount" not in stripped
    assert "payments{amount}" in stripped

