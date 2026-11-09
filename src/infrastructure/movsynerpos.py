"""Adaptador pyodbc para la tabla SynerPOS configurada en ``TABLE_NAME``
(SELECT + INSERT + DELETE). En producción es ``dbo.MovSynerPos``; para probar
sin tocar producción basta ``TABLE_NAME=MovSynerPosQA`` (misma base).

Fuente de la conexión: ``get_movsynerpos_config()`` (deriva de DB_*; un solo
login y una sola conexión para lectura y escritura). La escritura usa su
propia conexión, no la del pool de lectura, porque comparte la misma config
pero el cursor y la transacción son distintos.

Seguridad:
- Nombres de tabla validados/entrecomillados (``quote_table_name``).
- Nombres de columna salen de la allowlist ``COLUMNAS`` del dominio.
- Valores siempre parametrizados.
- ``DELETE`` solo por identidad + serie, en transacción y con rollback.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Sequence

from src.domain.errors import MovSynerPosPermissionError, UpstreamError
from src.domain.movsynerpos import COLUMNAS

logger = logging.getLogger("syner_check.movsynerpos")

_SQLSTATE_RE = re.compile(r"^[0-9A-Z]{5}$")
# Errores que suelen ser de esquema/permiso/tipo: tras el fallo vale la pena
# consultar el catálogo para dejar en el log la causa exacta (columna que
# falta, permiso INSERT, tabla inexistente). Un error de conexión no se
# diagnostica así: sería otro timeout encima del fallo original.
_DIAGNOSABLE_ERRORS = {"ProgrammingError", "IntegrityError", "DataError"}


def db_error_parts(exc: Exception) -> tuple[str, str]:
    """``(sqlstate, message)`` de un error de pyodbc, sin asumir el formato.

    pyodbc usa ``(sqlstate, message)`` para errores del servidor y
    ``(message, sqlstate)`` para errores del cliente (p. ej. HY105 al bindear
    un tipo no soportado). Se aceptan ambos órdenes.
    """
    args = getattr(exc, "args", ()) or ()
    if len(args) >= 2:
        first = str(args[0]).strip()
        second = str(args[1]).strip()
        if _SQLSTATE_RE.match(first):
            return first, second
        if _SQLSTATE_RE.match(second):
            return second, first
    return "", str(exc)


def db_error_detail(exc: Exception, *, limit: int = 400) -> str:
    """Detalle de una línea para el log (nunca para la respuesta al usuario)."""
    sqlstate, message = db_error_parts(exc)
    message = " ".join(message.split())
    if len(message) > limit:
        message = message[:limit] + "…"
    return f"sqlstate={sqlstate or '-'} detail={message}"


def classify_db_error(exc: Exception) -> str:
    """Categoría accionable de un error de escritura/lectura SQL.

    Los valores son estables y se usan como ``code`` del ``UpstreamError`` y
    en el log. No dependen de pyodbc: solo del texto que expone el driver.
    """
    text = " ".join(str(exc).lower().split())
    if (
        "permission was denied" in text
        or "permission denied" in text
        or "not have permission" in text
        or "has no permission" in text
    ):
        return "permission"
    if "invalid column name" in text:
        return "invalid_column"
    if "invalid object name" in text or "could not find" in text:
        return "invalid_object"
    if "truncat" in text or "string or binary data" in text:
        return "truncation"
    if (
        "cannot insert the value null" in text
        or "conflicted with the" in text
        or "duplicate key" in text
        or "violation of primary key" in text
    ):
        return "constraint"
    if "invalid parameter type" in text or "parameter markers" in text:
        return "parameter"
    if "timeout" in text or "deadlock" in text:
        return "transient"
    return "unknown"


def _public_write_message(
    category: str,
    table: str,
    sqlstate: str,
    diagnosis: dict[str, Any],
    *,
    operation: str = "INSERT",
) -> str:
    """Mensaje accionable para el operador (sin SQL, stack ni valores)."""
    if category == "permission":
        return (
            f"El login de escritura no tiene permiso {operation} sobre {table}. "
            f"Solicita al DBA el GRANT {operation} para el usuario de la "
            "aplicación."
        )
    if category == "invalid_object" or diagnosis.get("exists") is False:
        return (
            f"La tabla configurada {table} no existe en la base de datos. "
            "Revisa TABLE_NAME y DB_NAME del proceso."
        )
    missing = [
        str(column)
        for column in (diagnosis.get("missing_columns") or [])
        if column
    ]
    if category == "invalid_column" or missing:
        if not missing:
            return (
                f"La tabla {table} no tiene una columna requerida por el "
                "writer. Revisa TABLE_NAME y DB_NAME del proceso."
            )
        detail = ", ".join(missing[:6])
        if len(missing) > 6:
            detail += ", …"
        return (
            f"La tabla {table} no tiene las columnas requeridas: {detail}. "
            "Revisa TABLE_NAME y DB_NAME del proceso."
        )
    if category == "truncation":
        return (
            f"Un valor del documento excede la longitud de su columna en "
            f"{table}. Revisa el campo señalado en el log."
        )
    if category == "constraint":
        return (
            f"El documento viola una restricción de {table} "
            "(valor obligatorio vacío o línea duplicada)."
        )
    if category == "parameter":
        return (
            "SynerCom devolvió un dato con un tipo no soportado por el writer "
            "de SynerPOS (revisa el campo señalado en el log)."
        )
    if category == "transient":
        return "SynerPOS no respondió a tiempo; reintenta el envío."
    suffix = f" (SQLSTATE {sqlstate})" if sqlstate else ""
    return (
        f"SynerPOS rechazó el {operation} en {table}{suffix}. "
        "Revisa el log del reenvío para el detalle."
    )

_INSERT_COLUMNS = ", ".join(
    [*(f"[{column}]" for column in COLUMNAS), "[fechaRegistro]"]
)
# ``fechaRegistro`` no la manda el POS: la escribe su propio INSERT
# (querys.storeDocumentoDeVenta) con GETDATE(), en el mismo statement y sin
# default en la columna. Aquí se replica igual, para que las filas del reenvío
# manual sean indistinguibles de las que ya hay en producción.
# Verificado 2026-10-21 contra el SQL real de producción: mismas 38 columnas,
# con @name -> [promotion] y @date -> [createdDate].
_INSERT_PLACEHOLDERS = ", ".join(
    [*( "?" for _ in COLUMNAS), "GETDATE()"]
)


def _is_permission_denied(exc: Exception) -> bool:
    """True when SQL Server rejected the statement for missing permission.

    pyodbc exposes the server message in ``str(exc)``; there is no dedicated
    SQLSTATE for "denied" beyond 42000. ``classify_db_error`` keeps the match
    narrow so a real data error is never reported as a permissions problem.
    """
    return classify_db_error(exc) == "permission"


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
        from syner_check.db_client import qualified_table_name

        config, _password = self._settings()
        return qualified_table_name(str(config["table"]))

    def _connect(self):
        from syner_check.db_client import connect

        config, password = self._settings()
        return connect(config, password)

    def diagnose(self) -> dict[str, Any]:
        """Diagnóstico read-only del destino configurado (tabla/columnas/permiso).

        Pensado para ejecutarse **desde el host de la app** (contenedor,
        Dokploy) cuando un INSERT falla con un error de esquema o permisos.
        No escribe nada y nunca devuelve credenciales.
        """
        connection = self._connect()
        try:
            return self._diagnose(connection)
        finally:
            connection.close()

    def _diagnose(self, connection: Any) -> dict[str, Any]:
        """Catálogo mínimo del destino, best-effort, tras un fallo de escritura.

        Responde la pregunta que el log viejo no respondía: ¿la tabla existe?,
        ¿faltan columnas del contrato del writer?, ¿el login tiene INSERT?
        Nunca lanza: un fallo del diagnóstico no debe tapar el error original.
        """
        table = self._table()
        parts = [part.strip().strip("[]") for part in table.split(".")]
        database = parts[-3] if len(parts) >= 3 else ""
        schema = parts[-2] if len(parts) >= 2 else "dbo"
        name = parts[-1]
        qualified = ".".join(part for part in (database, schema, name) if part)
        result: dict[str, Any] = {
            "target": qualified,
            "exists": None,
            "can_insert": None,
        }
        try:
            cursor = connection.cursor()
            cursor.execute("SELECT OBJECT_ID(?)", qualified)
            result["exists"] = cursor.fetchone()[0] is not None

            # INFORMATION_SCHEMA resuelve solo la base actual; si TABLE_NAME
            # trae base explícita, se omite la lista de columnas en vez de
            # reportar falsos faltantes.
            if not database:
                cursor.execute(
                    "SELECT [COLUMN_NAME] FROM INFORMATION_SCHEMA.COLUMNS "
                    "WHERE [TABLE_SCHEMA] = ? AND [TABLE_NAME] = ?",
                    schema,
                    name,
                )
                # SQL Server compara nombres según la collation de la base
                # (CI en PU_SynerPOS: ``vuelto`` == ``Vuelto``). Comparar en
                # Python con casefold evita reportar falsos faltantes por la
                # diferencia de mayúsculas entre QA y producción.
                present = {str(row[0]).casefold() for row in cursor.fetchall()}
                expected = [*COLUMNAS, "fechaRegistro"]
                result["missing_columns"] = [
                    column
                    for column in expected
                    if column.casefold() not in present
                ]

            cursor.execute(
                "SELECT HAS_PERMS_BY_NAME(?, 'OBJECT', 'INSERT')", qualified
            )
            result["can_insert"] = cursor.fetchone()[0]

            # Login efectivo (sin contraseña): el DBA lo necesita para el
            # GRANT si ``can_insert`` es 0. Best-effort: no cambia el veredicto.
            try:
                cursor.execute("SELECT SUSER_SNAME()")
                row = cursor.fetchone()
                result["login"] = str(row[0]) if row and row[0] else None
            except Exception:  # noqa: BLE001 - dato opcional
                pass
        except Exception as exc:  # noqa: BLE001 - diagnóstico best-effort
            result["error"] = type(exc).__name__
            result["error_detail"] = db_error_detail(exc, limit=200)
        return result

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
            category = classify_db_error(exc)
            logger.warning(
                "MovSynerPos read failed target=%s error_class=%s category=%s %s",
                table,
                type(exc).__name__,
                category,
                db_error_detail(exc),
            )
            raise UpstreamError(
                f"MovSynerPos read failed: {type(exc).__name__}.",
                code=category,
            ) from exc
        finally:
            connection.close()

    def serie_conflicts(
        self, tipo: str, serie: str, idxs: Sequence[int]
    ) -> dict[int, str]:
        """Líneas de otra oid con la misma serie/tipo/Idx (D4).

        Réplica de ``querys.getRegistro`` del POS (verificado 2026-10-21):

            SELECT SerieNumero FROM MovSynerPos
             WHERE SerieNumero = @SerieNumero AND idx = @Idx
               AND TipoDocumento = @TipoDoc

        Producción no filtra por ``IDSynerPos`` porque solo necesita saber si la
        línea ya existe. Aquí se agrega ``IDSynerPos`` para distinguir una línea
        insertada por este mismo documento (no es colisión) de la de otro oid.
        La tabla sale de ``TABLE_NAME``, nunca de un literal.
        """
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
            category = classify_db_error(exc)
            logger.warning(
                "MovSynerPos read failed target=%s error_class=%s category=%s %s",
                table,
                type(exc).__name__,
                category,
                db_error_detail(exc),
            )
            raise UpstreamError(
                f"MovSynerPos read failed: {type(exc).__name__}.",
                code=category,
            ) from exc
        finally:
            connection.close()

    def document_lines(self, oid: str, tipo: str) -> list[dict]:
        """Snapshot de las líneas del documento antes de borrar (ODD).

        Devuelve solo identidad y montos agregados: sirve para validar la
        serie y para auditar qué se eliminó, sin volcar PII.
        """
        table = self._table()
        query = (
            "SELECT [SerieNumero], [FechaDocumento], [Idx], [Sku], "
            "[Cantidad], [CrossTotal] "
            f"FROM {table} WHERE [IDSynerPos] = ? AND [TipoDocumento] = ? "
            "ORDER BY [Idx]"
        )
        connection = self._connect()
        try:
            cursor = connection.cursor()
            cursor.execute(query, oid, tipo)
            rows: list[dict] = []
            for row in cursor.fetchall():
                rows.append(
                    {
                        "SerieNumero": str(row[0] or "").strip(),
                        "FechaDocumento": row[1],
                        "Idx": row[2],
                        "Sku": str(row[3] or "").strip(),
                        "Cantidad": row[4],
                        "CrossTotal": row[5],
                    }
                )
            return rows
        except Exception as exc:  # noqa: BLE001 - se traduce al dominio
            category = classify_db_error(exc)
            logger.warning(
                "MovSynerPos read failed target=%s error_class=%s category=%s %s",
                table,
                type(exc).__name__,
                category,
                db_error_detail(exc),
            )
            raise UpstreamError(
                f"MovSynerPos read failed: {type(exc).__name__}.",
                code=category,
            ) from exc
        finally:
            connection.close()

    def delete_document(self, oid: str, tipo: str, serie: str) -> int:
        """Borra todas las líneas del documento en una transacción.

        El ``WHERE`` exige ``IDSynerPos + TipoDocumento + SerieNumero``: si la
        serie no coincide no se elimina nada (protección contra un oid
        copiado mal). Un error de permisos se distingue del resto para que la
        API responda 503 con una instrucción accionable al DBA.
        """
        table = self._table()
        query = (
            f"DELETE FROM {table} "
            "WHERE [IDSynerPos] = ? AND [TipoDocumento] = ? AND [SerieNumero] = ?"
        )
        connection = self._connect()
        deleted = 0
        try:
            connection.autocommit = False
            cursor = connection.cursor()
            cursor.execute(query, oid, tipo, serie)
            deleted = int(getattr(cursor, "rowcount", -1))
            connection.commit()
            logger.info(
                "MovSynerPos delete target=%s tipo=%s oid=%s serie=%s lineas=%d",
                table,
                tipo,
                oid,
                serie,
                deleted,
            )
            return max(0, deleted)
        except Exception as exc:  # noqa: BLE001 - rollback total del borrado
            try:
                connection.rollback()
            except Exception:  # noqa: BLE001 - rollback no debe tapar el error
                logger.warning("MovSynerPos delete rollback failed")
            category = classify_db_error(exc)
            logger.warning(
                "MovSynerPos delete failed target=%s tipo=%s oid=%s serie=%s "
                "error_class=%s category=%s %s",
                table,
                tipo,
                oid,
                serie,
                type(exc).__name__,
                category,
                db_error_detail(exc),
            )
            if _is_permission_denied(exc):
                raise MovSynerPosPermissionError(
                    "El login de escritura no tiene permiso DELETE sobre la "
                    "tabla configurada.",
                    code=category,
                    public_message=(
                        f"El login de escritura no tiene permiso DELETE sobre "
                        f"{table}. Solicita al DBA el GRANT DELETE."
                    ),
                ) from exc
            raise UpstreamError(
                f"MovSynerPos delete failed: {type(exc).__name__}.",
                code=category,
                public_message=_public_write_message(
                    category, table, db_error_parts(exc)[0], {}, operation="DELETE"
                ),
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
            # Deja en el log a qué tabla se escribió: es la única forma de
            # auditar que un smoke de QA no terminó en producción.
            logger.info(
                "MovSynerPos insert target=%s tipo=%s oid=%s lineas=%d",
                table,
                getattr(documento, "tipo", ""),
                getattr(documento, "oid", ""),
                inserted,
            )
            return inserted
        except Exception as exc:  # noqa: BLE001 - rollback total del documento
            category = classify_db_error(exc)
            sqlstate, _ = db_error_parts(exc)
            can_diagnose = False
            try:
                connection.rollback()
                can_diagnose = type(exc).__name__ in _DIAGNOSABLE_ERRORS
            except Exception:  # noqa: BLE001 - rollback no debe tapar el error
                logger.warning("MovSynerPos rollback failed")
            diagnosis = self._diagnose(connection) if can_diagnose else {}
            logger.warning(
                "MovSynerPos insert failed target=%s tipo=%s oid=%s "
                "error_class=%s category=%s %s diagnosis=%s",
                table,
                getattr(documento, "tipo", ""),
                getattr(documento, "oid", ""),
                type(exc).__name__,
                category,
                db_error_detail(exc),
                diagnosis,
                exc_info=exc,
            )
            raise UpstreamError(
                f"MovSynerPos insert failed: {type(exc).__name__}.",
                code=category,
                public_message=_public_write_message(
                    category, table, sqlstate, diagnosis
                ),
            ) from exc
        finally:
            connection.close()
