"""Borrado seguro de un documento en dbo.MovSynerPos (sin red ni DB real)."""

from __future__ import annotations

import logging
from datetime import datetime

import pytest

from src.application.movsynerpos import delete_movsynerpos
from src.domain.errors import (
    MovSynerPosDeleteBlockedError,
    MovSynerPosPermissionError,
    MovSynerPosValidationError,
    NotFoundError,
    UpstreamError,
)
from src.domain.movsynerpos import (
    ESTADO_ELIMINADO,
    validate_delete_params,
)
from src.infrastructure.movsynerpos import MovSynerPosWriterAdapter

DB_CONFIG = {
    "driver": "ODBC Driver 18 for SQL Server",
    "server": "db.test",
    "database": "Pu_synerpos",
    "table": "MovSynerPos",
    "uid": "writer",
    "password": "x",
}

OID = "14257.639095"
TIPO = "BOLETA"
NUMBER = "BS05-00011252"
MOTIVO = "SynerCom duplico el comprobante con detalle erroneo"

ROWS = [
    {
        "SerieNumero": NUMBER,
        "FechaDocumento": datetime(2026, 11, 4),
        "Idx": 1,
        "Sku": "M380190000",
        "Cantidad": 1,
        "CrossTotal": "95.0000",
    },
    {
        "SerieNumero": NUMBER,
        "FechaDocumento": datetime(2026, 11, 4),
        "Idx": 2,
        "Sku": "C099600755",
        "Cantidad": 2,
        "CrossTotal": "190.0000",
    },
]


class FakeWriter:
    def __init__(self, rows=None, deleted=None, fail=None):
        self.rows = list(ROWS if rows is None else rows)
        self.deleted = len(self.rows) if deleted is None else deleted
        self.fail = fail
        self.delete_calls: list[tuple[str, str, str]] = []

    def document_lines(self, oid, tipo):
        return list(self.rows)

    def delete_document(self, oid, tipo, serie):
        self.delete_calls.append((oid, tipo, serie))
        if self.fail:
            raise self.fail
        return self.deleted


class FakeIntelisis:
    def __init__(self, estatus="SINAFECTAR", fail=None):
        self.estatus = estatus
        self.fail = fail
        self.calls: list[tuple[str, str]] = []

    def fetch_headers(self, start_iso, end_iso):
        self.calls.append((start_iso, end_iso))
        if self.fail:
            raise self.fail
        return [
            {
                "TransactionType": "boleta",
                "ReceiptNumber": NUMBER,
                "FechaEmision": "2026-11-04",
                "EstatusIntelisis": self.estatus,
            }
        ]


def delete(writer=None, intelisis=None, **overrides):
    values = {
        "oid": OID,
        "tipo": TIPO,
        "number": NUMBER,
        "motivo": MOTIVO,
        "forzar": False,
        "actor": "tester@example.test",
        "correlation_id": "corr-1",
    }
    values.update(overrides)
    return delete_movsynerpos(writer or FakeWriter(), intelisis, **values)


# --- Dominio --------------------------------------------------------------


def test_params_are_normalized() -> None:
    result = validate_delete_params(f" {OID} ", "boleta", f" {NUMBER} ", MOTIVO)
    self_assert = {
        "oid": OID,
        "tipo": TIPO,
        "number": NUMBER,
        "motivo": MOTIVO,
    }
    assert result == self_assert


@pytest.mark.parametrize("oid", ["", "   ", "-", None])
def test_oid_is_required(oid) -> None:
    with pytest.raises(MovSynerPosValidationError):
        validate_delete_params(oid, TIPO, NUMBER, MOTIVO)


def test_tipo_is_validated() -> None:
    with pytest.raises(MovSynerPosValidationError):
        validate_delete_params(OID, "GUIA", NUMBER, MOTIVO)


@pytest.mark.parametrize("number", ["", "-", None])
def test_number_is_required(number) -> None:
    with pytest.raises(MovSynerPosValidationError):
        validate_delete_params(OID, TIPO, number, MOTIVO)


def test_motivo_is_required_and_bounded() -> None:
    with pytest.raises(MovSynerPosValidationError):
        validate_delete_params(OID, TIPO, NUMBER, "  ")
    with pytest.raises(MovSynerPosValidationError):
        validate_delete_params(OID, TIPO, NUMBER, "cort")
    with pytest.raises(MovSynerPosValidationError):
        validate_delete_params(OID, TIPO, NUMBER, "x" * 256)


# --- Caso de uso ----------------------------------------------------------


def test_deletes_document_and_returns_counts() -> None:
    writer = FakeWriter()
    result = delete(writer, FakeIntelisis())

    assert result["estado"] == ESTADO_ELIMINADO
    assert result["lineas_eliminadas"] == 2
    assert result["oid"] == OID
    assert writer.delete_calls == [(OID, TIPO, NUMBER)]


def test_unknown_document_raises_not_found() -> None:
    with pytest.raises(NotFoundError):
        delete(FakeWriter(rows=[]), FakeIntelisis())


def test_serie_mismatch_does_not_delete() -> None:
    writer = FakeWriter()
    with pytest.raises(ValueError):
        delete(writer, FakeIntelisis(), number="BS05-00099999")
    assert writer.delete_calls == []


def test_concluded_in_intelisis_is_blocked() -> None:
    writer = FakeWriter()
    with pytest.raises(MovSynerPosDeleteBlockedError):
        delete(writer, FakeIntelisis(estatus="CONCLUIDO"))
    assert writer.delete_calls == []


def test_forzar_overrides_intelisis_block() -> None:
    writer = FakeWriter()
    result = delete(writer, FakeIntelisis(estatus="CONCLUIDO"), forzar=True)
    assert result["estado"] == ESTADO_ELIMINADO
    assert writer.delete_calls == [(OID, TIPO, NUMBER)]


def test_intelisis_failure_does_not_block_delete() -> None:
    writer = FakeWriter()
    result = delete(
        writer, FakeIntelisis(fail=UpstreamError("intelisis down"))
    )
    assert result["estado"] == ESTADO_ELIMINADO
    assert writer.delete_calls == [(OID, TIPO, NUMBER)]


def test_delete_failure_propagates() -> None:
    writer = FakeWriter(fail=UpstreamError("delete failed"))
    with pytest.raises(UpstreamError):
        delete(writer, FakeIntelisis())


def test_deleted_zero_is_reported_as_not_found() -> None:
    writer = FakeWriter(deleted=0)
    with pytest.raises(NotFoundError):
        delete(writer, FakeIntelisis())


def test_logs_audit_snapshot_without_pii(caplog) -> None:
    caplog.set_level(logging.INFO, logger="syner_check.movsynerpos")
    delete(FakeWriter(), FakeIntelisis())

    messages = [record.getMessage() for record in caplog.records]
    done = next(message for message in messages if "delete done" in message)
    assert "corr-1" in done
    assert "tester@example.test" in done
    assert MOTIVO in done
    assert "M380190000" in done
    assert "lineas_eliminadas=2" in done


def test_log_does_not_allow_motivo_to_forge_lines(caplog) -> None:
    caplog.set_level(logging.INFO, logger="syner_check.movsynerpos")
    delete(
        FakeWriter(),
        FakeIntelisis(),
        motivo="duplicado\nMovSynerPos delete done actor=admin",
    )

    messages = [record.getMessage() for record in caplog.records]
    done = [message for message in messages if "delete done" in message]
    assert len(done) == 1
    assert "\n" not in done[0]


# --- Adaptador pyodbc -----------------------------------------------------


class FakeCursor:
    def __init__(self, rows=(), rowcount=0, error=None):
        self.rows = list(rows)
        self.rowcount = rowcount
        self.error = error
        self.executed: list[tuple[str, tuple]] = []

    def execute(self, sql, *params):
        self.executed.append((sql, params))
        if self.error:
            raise self.error

    def fetchall(self):
        return list(self.rows)


class FakeConnection:
    def __init__(self, cursor):
        self.cursor_obj = cursor
        self.autocommit = True
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


def build_adapter(monkeypatch, cursor):
    adapter = MovSynerPosWriterAdapter(config=dict(DB_CONFIG), password="x")
    connection = FakeConnection(cursor)
    monkeypatch.setattr(
        "syner_check.db_client.connect", lambda *args, **kwargs: connection
    )
    return adapter, connection


def test_document_lines_returns_snapshot(monkeypatch) -> None:
    cursor = FakeCursor(
        rows=[
            (NUMBER, datetime(2026, 11, 4), 1, "SKU-1", 1, "95.0000"),
            (NUMBER, datetime(2026, 11, 4), 2, "SKU-2", 2, "190.0000"),
        ]
    )
    adapter, connection = build_adapter(monkeypatch, cursor)

    rows = adapter.document_lines(OID, TIPO)

    assert [row["Idx"] for row in rows] == [1, 2]
    sql, params = cursor.executed[0]
    assert "FROM [dbo].[MovSynerPos]" in sql
    assert "[IDSynerPos] = ? AND [TipoDocumento] = ?" in sql
    assert params == (OID, TIPO)
    assert connection.closed


def test_delete_document_is_parameterized_and_committed(monkeypatch) -> None:
    cursor = FakeCursor(rowcount=2)
    adapter, connection = build_adapter(monkeypatch, cursor)

    deleted = adapter.delete_document(OID, TIPO, NUMBER)

    assert deleted == 2
    sql, params = cursor.executed[0]
    assert sql.startswith("DELETE FROM [dbo].[MovSynerPos]")
    assert (
        "[IDSynerPos] = ? AND [TipoDocumento] = ? AND [SerieNumero] = ?" in sql
    )
    assert params == (OID, TIPO, NUMBER)
    assert connection.autocommit is False
    assert connection.committed is True
    assert connection.rolled_back is False
    assert connection.closed


def test_delete_document_rolls_back_on_error(monkeypatch) -> None:
    cursor = FakeCursor(error=RuntimeError("boom"))
    adapter, connection = build_adapter(monkeypatch, cursor)

    with pytest.raises(UpstreamError):
        adapter.delete_document(OID, TIPO, NUMBER)

    assert connection.committed is False
    assert connection.rolled_back is True
    assert connection.closed


def test_delete_document_maps_permission_error(monkeypatch) -> None:
    cursor = FakeCursor(
        error=Exception(
            "[42000] [Microsoft][ODBC Driver 18 for SQL Server]"
            "The DELETE permission was denied on the object 'MovSynerPos'."
        )
    )
    adapter, connection = build_adapter(monkeypatch, cursor)

    with pytest.raises(MovSynerPosPermissionError):
        adapter.delete_document(OID, TIPO, NUMBER)

    assert connection.rolled_back is True


def test_delete_document_uses_configured_qa_table(monkeypatch) -> None:
    cursor = FakeCursor(rowcount=1)
    adapter = MovSynerPosWriterAdapter(
        config={**DB_CONFIG, "table": "MovSynerPosQA"}, password="x"
    )
    connection = FakeConnection(cursor)
    monkeypatch.setattr(
        "syner_check.db_client.connect", lambda *args, **kwargs: connection
    )

    adapter.delete_document(OID, TIPO, NUMBER)

    sql, _params = cursor.executed[0]
    assert "DELETE FROM [dbo].[MovSynerPosQA]" in sql
    assert "[dbo].[MovSynerPos]" not in sql
