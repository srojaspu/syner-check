"""pyodbc adapter for dbo.SerieSucursal in PU_SynerPOS.

Table name is derived dynamically from ``syner_check.config.get_serie_sucursal_table()``
(default 'SerieSucursal', customizable via SERIE_SUCURSAL_TABLE_NAME for QA).
All statements use parameterized positional arguments and transactional rollbacks.
"""

from __future__ import annotations

import logging
from typing import Any

from src.domain.errors import (
    SerieSucursalDuplicateError,
    UpstreamError,
)

logger = logging.getLogger("syner_check.series_sucursales")


def _is_duplicate_key_error(exc: Exception) -> bool:
    """True when SQL Server rejected an INSERT/UPDATE due to a unique/PK violation."""
    text = str(exc).lower()
    return (
        "2627" in text  # Violation of PRIMARY KEY constraint
        or "2601" in text  # Cannot insert duplicate key row in object with unique index
        or "duplicate key" in text
        or "primary key constraint" in text
        or "unique constraint" in text
    )


def _row_to_dict(row: Any) -> dict[str, Any]:
    return {
        "sucursal": int(row[0]),
        "nombre": str(row[1] or "").strip(),
        "prefijo": str(row[2] or "").strip(),
        "seriesynerpos": (
            str(row[3]).strip().upper()
            if row[3] is not None and str(row[3]).strip()
            else None
        ),
    }


class SerieSucursalRepositoryAdapter:
    """Implementa ``SerieSucursalRepository`` contra SQL Server con pyodbc."""

    def __init__(self, config: dict | None = None, password: str | None = None):
        self._config = config
        self._password = password

    def _settings(self) -> tuple[dict, str]:
        if self._config is None or self._password is None:
            from syner_check.config import (
                get_db_password,
                get_serie_sucursal_config,
            )

            if self._config is None:
                self._config = get_serie_sucursal_config()
            if self._password is None:
                self._password = get_db_password()
        return self._config, self._password

    def _table(self) -> str:
        from syner_check.config import get_serie_sucursal_table
        from syner_check.db_client import qualified_table_name

        return qualified_table_name(get_serie_sucursal_table())

    def _connect(self):
        from syner_check.db_client import connect

        config, password = self._settings()
        return connect(config, password)

    def list_all(self) -> list[dict[str, Any]]:
        table = self._table()
        query = (
            f"SELECT [Sucursal], [Nombre], [Prefijo], [seriesynerpos] "
            f"FROM {table} ORDER BY [Sucursal]"
        )
        connection = self._connect()
        try:
            cursor = connection.cursor()
            cursor.execute(query)
            return [_row_to_dict(row) for row in cursor.fetchall()]
        except Exception as exc:
            logger.exception("SerieSucursal list_all failed on %s", table)
            raise UpstreamError(
                f"Error al listar sucursales: {type(exc).__name__}."
            ) from exc
        finally:
            connection.close()

    def get_by_sucursal(self, sucursal: int) -> dict[str, Any] | None:
        table = self._table()
        query = (
            f"SELECT [Sucursal], [Nombre], [Prefijo], [seriesynerpos] "
            f"FROM {table} WHERE [Sucursal] = ?"
        )
        connection = self._connect()
        try:
            cursor = connection.cursor()
            cursor.execute(query, int(sucursal))
            row = cursor.fetchone()
            return _row_to_dict(row) if row else None
        except Exception as exc:
            logger.exception(
                "SerieSucursal get_by_sucursal failed sucursal=%d on %s",
                sucursal,
                table,
            )
            raise UpstreamError(
                f"Error al consultar sucursal: {type(exc).__name__}."
            ) from exc
        finally:
            connection.close()

    def get_by_serie(self, serie: str) -> dict[str, Any] | None:
        table = self._table()
        query = (
            f"SELECT [Sucursal], [Nombre], [Prefijo], [seriesynerpos] "
            f"FROM {table} WHERE UPPER(LTRIM(RTRIM([seriesynerpos]))) = ?"
        )
        connection = self._connect()
        try:
            cursor = connection.cursor()
            cursor.execute(query, serie.strip().upper())
            row = cursor.fetchone()
            return _row_to_dict(row) if row else None
        except Exception as exc:
            logger.exception(
                "SerieSucursal get_by_serie failed serie=%s on %s",
                serie,
                table,
            )
            raise UpstreamError(
                f"Error al consultar serie: {type(exc).__name__}."
            ) from exc
        finally:
            connection.close()

    def create(self, item: dict[str, Any]) -> dict[str, Any]:
        table = self._table()
        query = (
            f"INSERT INTO {table} ([Sucursal], [Nombre], [Prefijo], [seriesynerpos]) "
            f"VALUES (?, ?, ?, ?)"
        )
        sucursal = int(item["sucursal"])
        nombre = str(item["nombre"])
        prefijo = str(item["prefijo"])
        seriesynerpos = item.get("seriesynerpos")
        seriesynerpos_val = (
            str(seriesynerpos).strip().upper() if seriesynerpos else None
        )

        connection = self._connect()
        try:
            connection.autocommit = False
            cursor = connection.cursor()
            cursor.execute(query, sucursal, nombre, prefijo, seriesynerpos_val)
            connection.commit()
            return {
                "sucursal": sucursal,
                "nombre": nombre,
                "prefijo": prefijo,
                "seriesynerpos": seriesynerpos_val,
            }
        except Exception as exc:
            try:
                connection.rollback()
            except Exception:
                pass
            if _is_duplicate_key_error(exc):
                raise SerieSucursalDuplicateError(
                    (
                        "Conflicto de clave duplicada en sucursal "
                        f"{sucursal} o serie {seriesynerpos_val}."
                    )
                ) from exc
            logger.exception(
                "SerieSucursal insert failed sucursal=%d on %s",
                sucursal,
                table,
            )
            raise UpstreamError(
                f"Error al crear sucursal: {type(exc).__name__}."
            ) from exc
        finally:
            connection.close()

    def update(self, sucursal: int, item: dict[str, Any]) -> dict[str, Any]:
        table = self._table()
        query = (
            f"UPDATE {table} SET [Nombre] = ?, [Prefijo] = ?, [seriesynerpos] = ? "
            f"WHERE [Sucursal] = ?"
        )
        sucursal_id = int(sucursal)
        nombre = str(item["nombre"])
        prefijo = str(item["prefijo"])
        seriesynerpos = item.get("seriesynerpos")
        seriesynerpos_val = (
            str(seriesynerpos).strip().upper() if seriesynerpos else None
        )

        connection = self._connect()
        try:
            connection.autocommit = False
            cursor = connection.cursor()
            cursor.execute(query, nombre, prefijo, seriesynerpos_val, sucursal_id)
            connection.commit()
            return {
                "sucursal": sucursal_id,
                "nombre": nombre,
                "prefijo": prefijo,
                "seriesynerpos": seriesynerpos_val,
            }
        except Exception as exc:
            try:
                connection.rollback()
            except Exception:
                pass
            if _is_duplicate_key_error(exc):
                raise SerieSucursalDuplicateError(
                    f"Conflicto de clave duplicada al actualizar sucursal {sucursal_id}."
                ) from exc
            logger.exception(
                "SerieSucursal update failed sucursal=%d on %s",
                sucursal_id,
                table,
            )
            raise UpstreamError(
                f"Error al actualizar sucursal: {type(exc).__name__}."
            ) from exc
        finally:
            connection.close()

    def delete(self, sucursal: int) -> bool:
        table = self._table()
        query = f"DELETE FROM {table} WHERE [Sucursal] = ?"
        sucursal_id = int(sucursal)

        connection = self._connect()
        try:
            connection.autocommit = False
            cursor = connection.cursor()
            cursor.execute(query, sucursal_id)
            affected = int(getattr(cursor, "rowcount", 0))
            connection.commit()
            return affected > 0
        except Exception as exc:
            try:
                connection.rollback()
            except Exception:
                pass
            logger.exception(
                "SerieSucursal delete failed sucursal=%d on %s",
                sucursal_id,
                table,
            )
            raise UpstreamError(
                f"Error al eliminar sucursal: {type(exc).__name__}."
            ) from exc
        finally:
            connection.close()
