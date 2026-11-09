"""Config del writer SUNAT: reutiliza DB_* (un solo login SynerPOS)."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from syner_check import config as cfg

DB_CONFIG = {
    "driver": "ODBC Driver 18 for SQL Server",
    "server": "172.0.2.162",
    "database": "PU_SynerPOS",
    "table": "MovSynerPos",
    "uid": "synercheck_writer",
    "trusted": False,
    "port": "",
    "instance": "",
    "timeout": 30,
    "encrypt": "yes",
    "trust_server_certificate": "no",
    "application_intent_read_only": True,
}


class SunatDbConfigTest(unittest.TestCase):
    def test_writer_reuses_db_connection_and_forces_write(self) -> None:
        with patch.object(cfg, "get_db_config", return_value=dict(DB_CONFIG)):
            result = cfg.get_sunat_db_config()

        self.assertEqual(result["table"], "dbo.SunatValidacion")
        self.assertFalse(result["application_intent_read_only"])
        self.assertEqual(result["uid"], "synercheck_writer")
        self.assertEqual(result["server"], "172.0.2.162")
        self.assertEqual(result["database"], "PU_SynerPOS")

    def test_legacy_sunat_db_vars_are_ignored(self) -> None:
        env = {
            "SUNAT_DB_HOST": "otro-host",
            "SUNAT_DB_NAME": "otra-base",
            "SUNAT_DB_USER": "otro-login",
            "SUNAT_DB_PASSWORD": "otra-password",
        }
        with patch.object(
            cfg, "get_db_config", return_value=dict(DB_CONFIG)
        ), patch.dict("os.environ", env, clear=True):
            result = cfg.get_sunat_db_config()

        self.assertEqual(result["server"], "172.0.2.162")
        self.assertEqual(result["uid"], "synercheck_writer")
        self.assertEqual(result["table"], "dbo.SunatValidacion")

    def test_password_is_the_db_password(self) -> None:
        with patch.object(cfg, "get_db_password", return_value="secret"):
            self.assertEqual(cfg.get_sunat_db_password(), "secret")


if __name__ == "__main__":
    unittest.main()
