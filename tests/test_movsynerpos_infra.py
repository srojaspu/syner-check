"""F2: config (kill switch, tabla configurada) y adaptador pyodbc."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from src.domain.errors import UpstreamError
from src.infrastructure.movsynerpos import (
    MovSynerPosWriterAdapter,
    classify_db_error,
    db_error_detail,
    db_error_parts,
)
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
}


class FakeCursor:
    def __init__(self, rows=()):
        self.rows = list(rows)
        self.executed: list[tuple[str, tuple]] = []

    def execute(self, sql, *params):
        self.executed.append((sql, params))

    def fetchall(self):
        return list(self.rows)

    def fetchone(self):
        return self.rows[0] if self.rows else None


class ScriptedCursor(FakeCursor):
    """Cursor mínimo que responde al catálogo que consulta ``_diagnose``."""

    def __init__(self, *, error, missing=(), exists=True, can_insert=True):
        super().__init__()
        self.error = error
        self.missing = list(missing)
        self.exists = exists
        self.can_insert = can_insert
        self._result: list[tuple] = []

    def execute(self, sql, *params):
        self.executed.append((sql, params))
        if sql.lstrip().upper().startswith("INSERT"):
            raise self.error
        if "OBJECT_ID" in sql:
            self._result = [(1 if self.exists else None,)]
        elif "INFORMATION_SCHEMA.COLUMNS" in sql:
            # _diagnose resta los presentes del contrato esperado.
            expected = [*COLUMNAS, "fechaRegistro"]
            present = [c for c in expected if c not in self.missing]
            self._result = [(column,) for column in present]
        elif "HAS_PERMS_BY_NAME" in sql:
            self._result = [(1 if self.can_insert else 0,)]
        else:
            self._result = []
        return self

    def fetchall(self):
        return list(self._result)

    def fetchone(self):
        return self._result[0] if self._result else None


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

    def test_config_is_the_same_db_config(self) -> None:
        with patch.object(cfg, "get_db_config", return_value=dict(DB_CONFIG)):
            result = cfg.get_movsynerpos_config()
        self.assertEqual(result, DB_CONFIG)
        self.assertEqual(result["table"], "MovSynerPos")

    def test_config_uses_configured_table(self) -> None:
        with patch.object(
            cfg,
            "get_db_config",
            return_value={**DB_CONFIG, "table": "MovSynerPosQA"},
        ):
            result = cfg.get_movsynerpos_config()
        self.assertEqual(result["table"], "MovSynerPosQA")

    def test_connections_have_no_application_intent(self) -> None:
        from syner_check.db_client import build_connection_string

        with patch.object(cfg, "get_db_config", return_value=dict(DB_CONFIG)):
            writer = build_connection_string(cfg.get_movsynerpos_config(), "x")
            reader = build_connection_string(cfg.get_db_config(), "x")

        self.assertNotIn("ApplicationIntent", writer)
        self.assertNotIn("ApplicationIntent", reader)
        self.assertEqual(writer, reader)

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

    def test_writer_uses_the_same_db_login_and_password(self) -> None:
        """Un solo login SynerPOS: DB_USER es el de lectura y escritura."""
        with patch.object(
            cfg, "get_db_config", return_value=dict(DB_CONFIG)
        ), patch.object(cfg, "get_db_password", return_value="secret"):
            config = cfg.get_movsynerpos_config()
            self.assertEqual(config["uid"], DB_CONFIG["uid"])
            self.assertEqual(config["host"], DB_CONFIG["host"])
            self.assertEqual(config["database"], DB_CONFIG["database"])
            self.assertEqual(config["table"], DB_CONFIG["table"])
            self.assertEqual(cfg.get_movsynerpos_login(), DB_CONFIG["uid"])
            self.assertEqual(cfg.get_db_password(), "secret")

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

    def test_insert_failure_logs_sqlstate_category_and_diagnosis(self) -> None:
        """El log debe explicar el fallo, no solo ``error_class``.

        Regresión 2026-11-09: un ProgrammingError en producción se logueaba
        sin SQLSTATE ni mensaje del servidor, así que no se sabía si faltaba
        una columna, la tabla o el permiso INSERT.
        """
        programming_error = type("ProgrammingError", (Exception,), {})
        detail = (
            "[42S22] [Microsoft][ODBC Driver 18 for SQL Server][SQL Server]"
            "Invalid column name 'nota'. (207) (SQLExecDirectW)"
        )
        error = programming_error("42S22", detail)
        connection = FakeConnection()
        connection.cursor_obj.execute = lambda *args, **kwargs: (_ for _ in ()).throw(error)
        adapter = MovSynerPosWriterAdapter(config=dict(DB_CONFIG), password="x")

        with patch("syner_check.db_client.connect", return_value=connection):
            with self.assertLogs("syner_check.movsynerpos", level="WARNING") as logs:
                with self.assertRaises(UpstreamError) as excinfo:
                    adapter.insert_lines(object(), [{"Idx": 1}])

        text = "\n".join(logs.output)
        assert "MovSynerPos insert failed" in text
        assert "category=invalid_column" in text
        assert "sqlstate=42S22" in text
        assert "Invalid column name 'nota'" in text
        assert "diagnosis=" in text
        assert "columna requerida" in (excinfo.exception.public_message or "")
        self.assertTrue(connection.rolled_back)
        self.assertFalse(connection.committed)

    def test_diagnosis_names_missing_columns_and_permission(self) -> None:
        programming_error = type("ProgrammingError", (Exception,), {})
        error = programming_error(
            "42S22", "[42S22] Invalid column name 'nota'. (207)"
        )
        cursor = ScriptedCursor(error=error, missing=["nota"], can_insert=False)
        connection = FakeConnection()
        connection.cursor_obj = cursor
        adapter = MovSynerPosWriterAdapter(config=dict(DB_CONFIG), password="x")

        with patch("syner_check.db_client.connect", return_value=connection):
            with self.assertLogs("syner_check.movsynerpos", level="WARNING") as logs:
                with self.assertRaises(UpstreamError) as excinfo:
                    adapter.insert_lines(object(), [{"Idx": 1}])

        text = "\n".join(logs.output)
        assert "'missing_columns': ['nota']" in text
        assert "'can_insert': 0" in text
        assert "'exists': True" in text
        public = excinfo.exception.public_message or ""
        assert "nota" in public
        assert "columnas requeridas" in public

    def test_settings_use_the_db_password(self) -> None:
        with patch.object(
            cfg, "get_movsynerpos_config", return_value=dict(DB_CONFIG)
        ), patch.object(cfg, "get_db_password", return_value="secret"):
            config, password = MovSynerPosWriterAdapter()._settings()

        self.assertEqual(config["uid"], "reader")
        self.assertEqual(password, "secret")

    def test_diagnose_wrapper_is_read_only_and_closes_the_connection(self) -> None:
        cursor = ScriptedCursor(error=Exception("no se usa"))
        connection = FakeConnection()
        connection.cursor_obj = cursor
        adapter = MovSynerPosWriterAdapter(config=dict(DB_CONFIG), password="x")

        with patch("syner_check.db_client.connect", return_value=connection):
            report = adapter.diagnose()

        self.assertTrue(connection.closed)
        self.assertEqual(report["target"], "dbo.MovSynerPos")
        self.assertTrue(report["exists"])
        self.assertEqual(report["missing_columns"], [])
        statements = [sql.lstrip().upper() for sql, _ in cursor.executed]
        self.assertTrue(statements)
        self.assertFalse(
            any(
                statement.startswith(("INSERT", "UPDATE", "DELETE"))
                for statement in statements
            )
        )

    def test_error_helpers_accept_both_pyodbc_arg_orders(self) -> None:
        server_error = Exception("42S22", "[42S22] Invalid column name 'x'.")
        client_error = Exception(
            "Invalid parameter type.  param-index=1 param-type=dict", "HY105"
        )

        self.assertEqual(
            db_error_parts(server_error), ("42S22", "[42S22] Invalid column name 'x'.")
        )
        self.assertEqual(
            db_error_parts(client_error)[0], "HY105"
        )
        self.assertIn("sqlstate=42S22", db_error_detail(server_error))

    def test_classify_db_error_maps_actionable_categories(self) -> None:
        cases = {
            "42S22 Invalid column name 'nota'": "invalid_column",
            "42S02 Invalid object name 'dbo.MovSynerPos'": "invalid_object",
            "42000 The INSERT permission was denied on the object": "permission",
            "22001 String or binary data would be truncated": "truncation",
            "23000 Cannot insert the value NULL into column 'Sku'": "constraint",
            "HY105 Invalid parameter type. param-index=1 param-type=dict": "parameter",
            "HYT00 Query timeout expired": "transient",
            "algo raro": "unknown",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(classify_db_error(Exception(text)), expected)
