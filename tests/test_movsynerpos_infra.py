"""F2: config (kill switch, tabla configurada) y adaptador pyodbc."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from src.domain.errors import UpstreamError
from src.infrastructure.movsynerpos import MovSynerPosWriterAdapter
from src.domain.movsynerpos import COLUMNAS
from syner_check import config as cfg

DB_CONFIG = {
    "host": "db.test",
    "server": "db.test",
    "driver": "ODBC Driver 18 for SQL Server",
    "database": "Pu_synerpos",
    "table": "MovSynerPos",
    "user": "reader",
    "uid": "reader",
    "application_intent_read_only": True,
}


class FakeCursor:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.executed: list[tuple[str, tuple]] = []

    def execute(self, sql, *params):
        self.executed.append((sql, params))

    def fetchall(self):
        return list(self.rows)


class FakeConnection:
    def __init__(self, rows=()):
        self.cursor_obj = FakeCursor(rows)
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


class ConfigTest(unittest.TestCase):
    def test_kill_switch_defaults_to_false(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            self.assertFalse(cfg.movsynerpos_enabled())

    def test_kill_switch_accepts_true(self) -> None:
        with patch.dict("os.environ", {"MOVSYNERPOS_WRITE_ENABLED": "true"}):
            self.assertTrue(cfg.movsynerpos_enabled())

    def test_config_forces_write_connection(self) -> None:
        with patch.object(cfg, "get_db_config", return_value=dict(DB_CONFIG)):
            result = cfg.get_movsynerpos_config()
        self.assertEqual(result["table"], "MovSynerPos")
        self.assertFalse(result["application_intent_read_only"])

    def test_config_uses_configured_table(self) -> None:
        with patch.object(
            cfg,
            "get_db_config",
            return_value={**DB_CONFIG, "table": "MovSynerPosQA"},
        ):
            result = cfg.get_movsynerpos_config()
        self.assertEqual(result["table"], "MovSynerPosQA")

    def test_writer_connection_is_not_read_only(self) -> None:
        from syner_check.db_client import build_connection_string

        with patch.object(cfg, "get_db_config", return_value=dict(DB_CONFIG)):
            writer = build_connection_string(cfg.get_movsynerpos_config(), "x")
            reader = build_connection_string(cfg.get_db_config(), "x")

        self.assertNotIn("ApplicationIntent=ReadOnly", writer)
        self.assertIn("ApplicationIntent=ReadOnly", reader)

    def test_configured_requires_password(self) -> None:
        with patch.object(cfg, "get_db_config", return_value=dict(DB_CONFIG)), patch.object(
            cfg, "get_db_password", return_value=""
        ):
            self.assertFalse(cfg.is_movsynerpos_configured())
        with patch.object(cfg, "get_db_config", return_value=dict(DB_CONFIG)), patch.object(
            cfg, "get_db_password", return_value="secret"
        ):
            self.assertTrue(cfg.is_movsynerpos_configured())

    def test_configured_rejects_invalid_table(self) -> None:
        with patch.object(
            cfg, "get_db_config", return_value={**DB_CONFIG, "table": "bad;table"}
        ), patch.object(cfg, "get_db_password", return_value="secret"):
            self.assertFalse(cfg.is_movsynerpos_configured())

    def test_target_helper_shows_configured_table(self) -> None:
        with patch.object(
            cfg,
            "get_db_config",
            return_value={**DB_CONFIG, "table": "MovSynerPosQA"},
        ):
            self.assertEqual(
                cfg.get_movsynerpos_target(), "[dbo].[MovSynerPosQA]"
            )

    def test_target_helper_returns_none_for_invalid_table(self) -> None:
        with patch.object(
            cfg, "get_db_config", return_value={**DB_CONFIG, "table": "bad;table"}
        ):
            self.assertIsNone(cfg.get_movsynerpos_target())


class AdapterTest(unittest.TestCase):
    def build(self, rows=(), connection=None):
        adapter = MovSynerPosWriterAdapter(config=dict(DB_CONFIG), password="x")
        connection = connection or FakeConnection(rows)
        self.connect = patch(
            "syner_check.db_client.connect", return_value=connection
        )
        self.connect.start()
        self.addCleanup(self.connect.stop)
        return adapter, connection

    def test_existing_lines_maps_idx_to_serie(self) -> None:
        adapter, connection = self.build(
            rows=[("oid-1", "B004-1", 1), ("oid-1", "B004-1", 2)]
        )
        result = adapter.existing_lines("oid-1", "BOLETA")

        self.assertEqual(result, {1: "B004-1", 2: "B004-1"})
        sql, params = connection.cursor_obj.executed[0]
        self.assertIn("FROM [dbo].[MovSynerPos]", sql)
        self.assertIn("[IDSynerPos] = ?", sql)
        self.assertEqual(params, ("oid-1", "BOLETA"))
        self.assertTrue(connection.closed)

    def test_adapter_uses_configured_table(self) -> None:
        adapter = MovSynerPosWriterAdapter(
            config={**DB_CONFIG, "table": "dbo.MovSynerPosQA"}, password="x"
        )
        connection = FakeConnection()
        with patch("syner_check.db_client.connect", return_value=connection):
            adapter.existing_lines("oid-1", "BOLETA")

        sql, _params = connection.cursor_obj.executed[0]
        self.assertIn("FROM [dbo].[MovSynerPosQA]", sql)

    def test_adapter_qualifies_unqualified_table(self) -> None:
        adapter = MovSynerPosWriterAdapter(
            config={**DB_CONFIG, "table": "MovSynerPosQA"}, password="x"
        )
        connection = FakeConnection()
        with patch("syner_check.db_client.connect", return_value=connection):
            adapter.existing_lines("oid-1", "BOLETA")

        sql, _params = connection.cursor_obj.executed[0]
        self.assertIn("FROM [dbo].[MovSynerPosQA]", sql)

    def test_every_query_uses_the_configured_table(self) -> None:
        """Las 3 consultas del writer salen de TABLE_NAME, nunca de un literal.

        Es la garantía real de testabilidad: con TABLE_NAME apuntando a una
        tabla de prueba, ninguna sentencia (SELECT de líneas existentes,
        SELECT de colisión de serie e INSERT) puede nombrar la tabla de
        producción.
        """
        for configured in ("MovSynerPosQA", "dbo.MovSynerPosQA"):
            with self.subTest(table=configured):
                adapter = MovSynerPosWriterAdapter(
                    config={**DB_CONFIG, "table": configured}, password="x"
                )
                connection = FakeConnection()
                with patch(
                    "syner_check.db_client.connect", return_value=connection
                ):
                    adapter.existing_lines("oid-1", "BOLETA")
                    adapter.serie_conflicts("BOLETA", "B004-1", [1])
                    adapter.insert_lines(
                        object(), [{column: None for column in COLUMNAS}]
                    )

                statements = [sql for sql, _ in connection.cursor_obj.executed]
                self.assertEqual(len(statements), 3)
                self.assertTrue(statements[2].startswith("INSERT INTO"))
                for sql in statements:
                    self.assertIn("[dbo].[MovSynerPosQA]", sql)
                    self.assertNotIn("[dbo].[MovSynerPos]", sql)
                    self.assertNotIn("[MovSynerPos]", sql)

    def test_adapter_rejects_invalid_identifier(self) -> None:
        adapter = MovSynerPosWriterAdapter(
            config={**DB_CONFIG, "table": "MovSynerPos; DROP TABLE x--"},
            password="x",
        )
        with self.assertRaises(ValueError):
            adapter.existing_lines("oid-1", "BOLETA")

    def test_serie_conflicts_uses_parameters(self) -> None:
        adapter, connection = self.build(rows=[("other-oid", 3)])
        result = adapter.serie_conflicts("BOLETA", "B004-1", [3, 4])

        self.assertEqual(result, {3: "other-oid"})
        sql, params = connection.cursor_obj.executed[0]
        self.assertIn("[Idx] IN (?, ?)", sql)
        self.assertEqual(params, ("BOLETA", "B004-1", 3, 4))

    def test_serie_conflicts_without_idxs_does_not_query(self) -> None:
        adapter, connection = self.build()
        self.assertEqual(adapter.serie_conflicts("BOLETA", "B004-1", []), {})
        self.assertEqual(connection.cursor_obj.executed, [])

    def test_insert_lines_uses_all_columns_and_commits(self) -> None:
        adapter, connection = self.build()
        line = {column: None for column in COLUMNAS}
        count = adapter.insert_lines(object(), [line, dict(line)])

        self.assertEqual(count, 2)
        self.assertEqual(len(connection.cursor_obj.executed), 2)
        sql, params = connection.cursor_obj.executed[0]
        self.assertIn("INSERT INTO [dbo].[MovSynerPos]", sql)
        self.assertIn("[fechaRegistro]", sql)
        self.assertIn("GETDATE()", sql)
        self.assertEqual(len(params), len(COLUMNAS))
        self.assertFalse(connection.autocommit)
        self.assertTrue(connection.committed)
        self.assertFalse(connection.rolled_back)
        self.assertTrue(connection.closed)

    def test_insert_failure_rolls_back_and_raises_upstream(self) -> None:
        connection = FakeConnection()

        def explode(sql, *params):
            raise RuntimeError("boom")

        connection.cursor_obj.execute = explode
        adapter = MovSynerPosWriterAdapter(config=dict(DB_CONFIG), password="x")
        with patch(
            "syner_check.db_client.connect", return_value=connection
        ):
            with self.assertRaises(UpstreamError):
                adapter.insert_lines(object(), [{"Idx": 1}])

        self.assertTrue(connection.rolled_back)
        self.assertFalse(connection.committed)
        self.assertTrue(connection.closed)

    def test_empty_insert_is_a_noop(self) -> None:
        adapter = MovSynerPosWriterAdapter(config=dict(DB_CONFIG), password="x")
        self.assertEqual(adapter.insert_lines(object(), []), 0)
