"""F4.1: ``payments.creditNote`` en los detalles de BOLETA/FACTURA."""

from __future__ import annotations

from app.graphql import DETAIL_BY_SERIE_QUERIES, DETAIL_QUERIES


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
