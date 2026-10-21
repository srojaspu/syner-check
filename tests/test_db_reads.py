"""Lecturas SQL del resumen: la tabla siempre sale de TABLE_NAME.

Si el lector ignorara ``TABLE_NAME``, un ``TABLE_NAME=MovSynerPosQA`` mostraría
filas de producción y la app dejaría de ser testeable contra una tabla espejo.
"""

from __future__ import annotations

from contextlib import contextmanager

import pytest

from app import db as app_db
from syner_check.db_client import qualified_table_name

_COLUMNS = [
    ("IDSynerPos",),
    ("TipoDocumento",),
    ("Sku",),
    ("FechaDocumento",),
    ("SerieNumero",),
]


class _Cursor:
    description = _COLUMNS

    def __init__(self) -> None:
        self.statements: list[str] = []

    def execute(self, sql, *_params) -> None:
        self.statements.append(sql)

    def fetchall(self) -> list[tuple]:
        return []


class _Connection:
    def __init__(self) -> None:
        self.cursor_obj = _Cursor()

    def cursor(self) -> _Cursor:
        return self.cursor_obj


def _install(monkeypatch, table: str) -> _Connection:
    connection = _Connection()

    @contextmanager
    def pooled(_config, _password):
        yield connection

    monkeypatch.setattr(app_db, "get_db_config", lambda: {"table": table})
    monkeypatch.setattr(app_db, "get_db_password", lambda: "x")
    monkeypatch.setattr(app_db, "pooled_connection", pooled)
    return connection


def test_fetch_documents_uses_configured_table(monkeypatch) -> None:
    connection = _install(monkeypatch, "MovSynerPosQA")

    assert app_db.fetch_documents("2026-10-01", "2026-10-01") == []

    sql = connection.cursor_obj.statements[-1]
    assert "[dbo].[MovSynerPosQA]" in sql
    assert "[MovSynerPos]" not in sql


def test_fetch_by_number_uses_configured_table(monkeypatch) -> None:
    connection = _install(monkeypatch, "dbo.MovSynerPosQA")

    assert app_db.fetch_by_number("B004-1") == []

    sql = connection.cursor_obj.statements[-1]
    assert "[dbo].[MovSynerPosQA]" in sql
    assert "[MovSynerPos]" not in sql


def test_qualified_table_name_defaults_to_dbo() -> None:
    assert qualified_table_name("MovSynerPosQA") == "[dbo].[MovSynerPosQA]"
    assert qualified_table_name("dbo.MovSynerPosQA") == "[dbo].[MovSynerPosQA]"
    assert qualified_table_name("qa.MovSynerPosQA") == "[qa].[MovSynerPosQA]"


def test_qualified_table_name_still_rejects_injection() -> None:
    with pytest.raises(ValueError):
        qualified_table_name("MovSynerPos; DROP TABLE x--")
