"""Adaptador pyodbc para dbo.MovSynerPos / dbo.MovSynerPosQA (SELECT + INSERT).

Fuente de la conexión: ``get_movsynerpos_config()`` (deriva de DB_* y fuerza
``application_intent_read_only=False``). Nunca se reutiliza el pool de lectura:
una escritura no debe compartir sesión con una conexión marcada ReadOnly.

Seguridad:
- Nombres de tabla validados/entrecomillados (``quote_table_name``).
- Nombres de columna salen de la allowlist ``COLUMNAS`` del dominio.
- Valores siempre parametrizados.
- Sin ``UPDATE`` ni ``DELETE``.
"""

from __future__ import annotations

import logging
from typing import Any, Sequence

from src.domain.errors import UpstreamError
from src.domain.movsynerpos import COLUMNAS

logger = logging.getLogger("syner_check.movsynerpos")

_INSERT_COLUMNS = ", ".join(f"[{column}]" for column in COLUMNAS)
_INSERT_PLACEHOLDERS = ", ".join("?" for _ in COLUMNAS)


class MovSynerPosWriterAdapter:
    """INSERT transaccional por documento + pre-chequeo de líneas existentes."""

    def __init__(self, config: dict | None = None, password: str | None = None):
        self._config = config
        self._password = password

    def _settings(self) -> tuple[dict, str]:
        if self._config is None or self._password is None:
            from syner_check.config import get_db_password, get_movsynerpos_config

            if self._config is None:
                self._config = get_movsynerpos_config()
            if self._password is None:
                self._password = get_db_password()
        return self._config, self._password

    def _table(self) -> str:
        from syner_check.db_client import quote_table_name

        config, _password = self._settings()
        table = str(config["table"]).strip()
        if "." not in table:
            table = f"dbo.{table}"
        quoted = quote_table_name(table)
        if quoted.lower() not in (
            "[dbo].[movsynerpos]",
            "[dbo].[movsynerposqa]",
        ):
            raise ValueError(
                "MovSynerPos writer only accepts dbo.MovSynerPos or "
                "dbo.MovSynerPosQA."
            )
        return quoted

    def _connect(self):
        from syner_check.db_client import connect

        config, password = self._settings()
        return connect(config, password)

    def existing_lines(self, oid: str, tipo: str) -> dict[int, str]:
        table = self._table()
        query = (
            "SELECT [IDSynerPos], [SerieNumero], [Idx] "
            f"FROM {table} WHERE [IDSynerPos] = ? AND [TipoDocumento] = ?"
        )
        connection = self._connect()
        try:
            cursor = connection.cursor()
            cursor.execute(query, oid, tipo)
            lines: dict[int, str] = {}
            for row in cursor.fetchall():
                try:
                    idx = int(row[2])
                except (TypeError, ValueError):
                    continue
                lines[idx] = str(row[1] or "")
            return lines
        except Exception as exc:  # noqa: BLE001 - se traduce al dominio
            raise UpstreamError(
                f"MovSynerPos read failed: {type(exc).__name__}."
            ) from exc
        finally:
            connection.close()

    def serie_conflicts(
        self, tipo: str, serie: str, idxs: Sequence[int]
    ) -> dict[int, str]:
        """Líneas de otra oid con la misma serie/tipo/Idx (D4)."""
        targets = [int(idx) for idx in idxs]
        if not targets:
            return {}
        table = self._table()
        placeholders = ", ".join("?" for _ in targets)
        query = (
            "SELECT [IDSynerPos], [Idx] "
            f"FROM {table} WHERE [TipoDocumento] = ? AND [SerieNumero] = ? "
            f"AND [Idx] IN ({placeholders})"
        )
        connection = self._connect()
        try:
            cursor = connection.cursor()
            cursor.execute(query, tipo, serie, *targets)
            conflicts: dict[int, str] = {}
            for row in cursor.fetchall():
                try:
                    conflicts[int(row[1])] = str(row[0] or "")
                except (TypeError, ValueError):
                    continue
            return conflicts
        except Exception as exc:  # noqa: BLE001 - se traduce al dominio
            raise UpstreamError(
                f"MovSynerPos read failed: {type(exc).__name__}."
            ) from exc
        finally:
            connection.close()

    def insert_lines(self, documento: Any, lineas: Sequence[dict]) -> int:
        if not lineas:
            return 0
        table = self._table()
        query = f"INSERT INTO {table} ({_INSERT_COLUMNS}) VALUES ({_INSERT_PLACEHOLDERS})"
        connection = self._connect()
        inserted = 0
        try:
            connection.autocommit = False
            cursor = connection.cursor()
            for line in lineas:
                cursor.execute(query, *[line.get(column) for column in COLUMNAS])
                inserted += 1
            connection.commit()
            return inserted
        except Exception as exc:  # noqa: BLE001 - rollback total del documento
            try:
                connection.rollback()
            except Exception:  # noqa: BLE001 - rollback no debe tapar el error
                logger.warning("MovSynerPos rollback failed")
            logger.warning(
                "MovSynerPos insert failed tipo=%s oid=%s error_class=%s",
                getattr(documento, "tipo", ""),
                getattr(documento, "oid", ""),
                type(exc).__name__,
            )
            raise UpstreamError(
                f"MovSynerPos insert failed: {type(exc).__name__}."
            ) from exc
        finally:
            connection.close()
