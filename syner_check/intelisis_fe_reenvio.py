"""Cola de reenvios del ERP: ``dbo.FE_Reenvio`` en PUnidas.

No hay tabla propia ni worker propio: esta es la misma cola que atiende el
ERP (``C:\\Projects\\PHP\\rmand2``, ``bin/fe_worker.php``). Aqui solo se
replican las operaciones que el ERP ya expone:

* ``encolar``  -> ``feop_enqueue``: locks ``RMAND2:FE:QUEUE`` y
  ``RMAND2:FE:VENTA:<id>``, venta ``CONCLUIDO`` de ``E-*`` y sin otra fila
  activa del mismo documento.
* ``panel``    -> ``feop_queue``: heartbeat del worker, pendientes, casos sin
  confirmar, activos, historial y conteo por estado.
* ``resolver`` -> ``feop_resolve``: exige el mutex ``RMAND2:FE:WORKER`` y el
  lock del generador; cierra el caso sin reintentar el SP.

Los locks son de sesion y la conexion de escritura es dedicada (fuera del
pool): si algo falla, el lock muere con la conexion en vez de quedar pegado a
una conexion reciclada. Todo el SQL es parametrizado; los unicos
identificadores interpolados son constantes de este modulo.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterator

from src.domain.errors import NotFoundError, ReenvioNoPermitidoError
from src.domain.intelisis_reenvio import (
    EN_COLA,
    ESTADOS_ACTIVOS,
    NO_CONFIRMADO,
    REVISADO_MANUAL,
    procedimiento_para,
    tipo_comprobante,
)

logger = logging.getLogger("syner_check.intelisis_fe_reenvio")

QUEUE_TABLE = "dbo.FE_Reenvio"
WORKER_TABLE = "dbo.FE_Worker"

QUEUE_LOCK = "RMAND2:FE:QUEUE"
WORKER_LOCK = "RMAND2:FE:WORKER"

_COLUMNAS = (
    "ID",
    "IDVenta",
    "Tipo",
    "Procedimiento",
    "Usuario",
    "Motivo",
    "Estado",
    "Creado",
    "Inicio",
    "Fin",
    "SPID",
    "LogDesde",
    "LogHasta",
    "Retorno",
    "Detalle",
    "RevisadoPor",
    "Revision",
    "LoteID",
)
_COLUMNAS_SQL = ", ".join(f"[{columna}]" for columna in _COLUMNAS)

_ACTIVOS_PLACEHOLDERS = ", ".join("?" for _ in ESTADOS_ACTIVOS)

_MARCA_REVISION = (
    "Revision manual registrada. No se reejecuto automaticamente."
)

_SALE_SQL = """
    SELECT V.ID AS IDVenta, V.Mov, V.Estatus,
           (SELECT TOP 1 B.TipoDocumentoPU
              FROM dbo.MovTipo B WITH (NOLOCK)
             WHERE B.Modulo = 'VTAS' AND B.Mov = V.Mov) AS TipoDocumentoPU
      FROM dbo.Venta V WITH (UPDLOCK, ROWLOCK)
     WHERE V.ID = ? AND V.Empresa = 'PU'
"""

_ACTIVE_SQL = (
    "SELECT TOP 1 ID FROM dbo.FE_Reenvio "
    f"WHERE IDVenta = ? AND Estado IN ({_ACTIVOS_PLACEHOLDERS})"
)

_INSERT_SQL = """
    INSERT INTO dbo.FE_Reenvio
        (IDVenta, Tipo, Procedimiento, Usuario, Motivo, Token)
    OUTPUT INSERTED.ID
    VALUES (?, ?, ?, ?, ?, ?)
"""


# --- Conexion --------------------------------------------------------------


@contextmanager
def _write_connection() -> Iterator[Any]:
    """Conexion dedicada a PUnidas con el login de escritura.

    Deliberadamente fuera del pool: los ``sp_getapplock`` de sesion quedan
    atados a esta conexion y se liberan al cerrarla, pase lo que pase.
    """
    from .config import get_intelisis_write_config, get_intelisis_write_password
    from .db_client import connect

    connection = connect(
        get_intelisis_write_config(), get_intelisis_write_password()
    )
    try:
        yield connection
    finally:
        try:
            connection.close()
        except Exception:  # noqa: BLE001 - cerrar nunca tapa el error real
            logger.debug("No se pudo cerrar la conexion de FE_Reenvio")


def _panel_connection() -> Any:
    """Lectura del panel por el pool (sin locks, sin transaccion)."""
    from .config import get_intelisis_write_config, get_intelisis_write_password
    from .db_pool import pooled_connection

    return pooled_connection(
        get_intelisis_write_config(), get_intelisis_write_password()
    )


# --- Helpers de SQL --------------------------------------------------------


def _lock(cursor: Any, resource: str, timeout_ms: int = 0) -> int:
    """``sp_getapplock`` exclusivo de sesion; devuelve el codigo del SP."""
    cursor.execute(
        "DECLARE @r int; "
        "EXEC @r = sys.sp_getapplock @Resource = ?, @LockMode = 'Exclusive', "
        "@LockOwner = 'Session', @LockTimeout = ?; "
        "SELECT @r AS resultado;",
        resource,
        int(timeout_ms),
    )
    row = cursor.fetchone()
    return int(row[0]) if row is not None else -999


def _require_lock(cursor: Any, resource: str, message: str) -> None:
    if _lock(cursor, resource) < 0:
        raise ReenvioNoPermitidoError(message)


def _release(cursor: Any, resource: str) -> None:
    cursor.execute(
        "EXEC sys.sp_releaseapplock @Resource = ?, @LockOwner = 'Session';",
        resource,
    )


def _jsonable(valor: Any) -> Any:
    if isinstance(valor, datetime):
        return valor.isoformat(sep="T", timespec="seconds")
    if isinstance(valor, date):
        return valor.isoformat()
    if isinstance(valor, Decimal):
        return float(valor)
    if isinstance(valor, bytes):
        return valor.decode("utf-8", "replace")
    return valor


def _fila(cursor: Any) -> dict[str, Any] | None:
    if not cursor.description:
        return None
    record = cursor.fetchone()
    if record is None:
        return None
    nombres = [columna[0] for columna in cursor.description]
    return {nombre: _jsonable(valor) for nombre, valor in zip(nombres, record)}


def _filas(cursor: Any) -> list[dict[str, Any]]:
    nombres = [columna[0] for columna in cursor.description or ()]
    return [
        {nombre: _jsonable(valor) for nombre, valor in zip(nombres, record)}
        for record in cursor.fetchall()
    ]


def _escalar(cursor: Any, sql: str, *params: Any) -> Any:
    cursor.execute(sql, *params)
    row = cursor.fetchone()
    return row[0] if row is not None else None


def _texto(valor: Any) -> str:
    return str(valor if valor is not None else "").strip()


def _tipo_desde_venta(sale: dict[str, Any], mov: str) -> str:
    """Tipo char(2) de la venta, con la misma tabla que ``fe_type`` del ERP."""
    tipo = _texto(sale.get("TipoDocumentoPU"))
    if tipo.isdigit() and len(tipo) == 1:
        tipo = tipo.zfill(2)
    if tipo in {"01", "03", "07", "08"}:
        return tipo
    if mov in {"0", "1", "3", "7", "8"}:
        return mov.zfill(2)
    if "NOTA" in mov and "CRED" in mov:
        return "07"
    if "NOTA" in mov and "DEB" in mov:
        return "08"
    if "FACTURA" in mov:
        return "01"
    if "BOLETA" in mov:
        return "03"
    return tipo_comprobante(tipo)  # lanza el error de dominio


def _tipo_de_venta(sale: dict[str, Any]) -> str:
    """Valida la venta y devuelve su tipo (paridad con ``feop_sale``)."""
    mov = _texto(sale.get("Mov")).upper()
    if not mov.startswith("E-"):
        raise ReenvioNoPermitidoError(
            "El movimiento no es un comprobante electronico admitido."
        )
    if _texto(sale.get("Estatus")).upper() != "CONCLUIDO":
        raise ReenvioNoPermitidoError(
            "Solo se reenvian comprobantes CONCLUIDOS."
        )
    return _tipo_desde_venta(sale, mov)


def _es_duplicado(exc: Exception) -> bool:
    """SQL Server 2601/2627: choque con el indice unico de ``Token``."""
    return any("2601" in str(arg) or "2627" in str(arg) for arg in exc.args)


# --- Encolar ---------------------------------------------------------------


def encolar(
    *,
    id_venta: int,
    usuario: str,
    motivo: str,
    token: str,
    correlation_id: str = "",
) -> dict[str, Any]:
    """Inserta una fila ``EN_COLA`` replicando ``feop_enqueue``.

    Returns:
        ``{"id", "duplicado", "tipo", "procedimiento"}``. ``duplicado`` es
        True cuando el token ya estaba registrado (reintento idempotente).

    Raises:
        ReenvioNoPermitidoError: guarda de negocio (cola ocupada, venta no
            concluida, token ya usado, otra fila activa del documento).
    """
    identificador = int(id_venta)
    actor = _texto(usuario)[:150]
    razon = _texto(motivo)[:500]
    locks: list[str] = []
    with _write_connection() as connection:
        cursor = connection.cursor()
        try:
            _require_lock(
                cursor,
                QUEUE_LOCK,
                "La cola esta recibiendo otra solicitud. Reintente.",
            )
            locks.append(QUEUE_LOCK)

            cursor.execute(
                "SELECT ID, IDVenta, Usuario FROM dbo.FE_Reenvio WHERE Token = ?",
                token,
            )
            same = _fila(cursor)
            if same:
                if (
                    int(same["IDVenta"]) != identificador
                    or _texto(same["Usuario"]) != actor
                ):
                    raise ReenvioNoPermitidoError("Token ya utilizado.")
                connection.commit()
                logger.info(
                    "FE_Reenvio token ya registrado job=%s correlation_id=%s",
                    same["ID"],
                    correlation_id,
                )
                return {
                    "id": int(same["ID"]),
                    "duplicado": True,
                    "tipo": "",
                    "procedimiento": "",
                }

            venta_lock = f"RMAND2:FE:VENTA:{identificador}"
            _require_lock(
                cursor,
                venta_lock,
                "El comprobante ya esta en ejecucion o edicion.",
            )
            locks.append(venta_lock)

            cursor.execute(_SALE_SQL, identificador)
            sale = _fila(cursor)
            if sale is None:
                raise ReenvioNoPermitidoError(
                    "Venta no encontrada en la empresa PU."
                )
            tipo = _tipo_de_venta(sale)
            procedimiento = procedimiento_para(tipo)

            cursor.execute(_ACTIVE_SQL, identificador, *ESTADOS_ACTIVOS)
            activo = _fila(cursor)
            if activo:
                raise ReenvioNoPermitidoError(
                    "El ID ERP ya tiene la solicitud "
                    f"#{int(activo['ID'])} pendiente o sin confirmar."
                )

            try:
                cursor.execute(
                    _INSERT_SQL,
                    identificador,
                    tipo,
                    procedimiento,
                    actor,
                    razon,
                    token,
                )
                inserted = cursor.fetchone()
            except Exception as exc:  # noqa: BLE001 - se clasifica y se propaga
                if _es_duplicado(exc):
                    raise ReenvioNoPermitidoError("Token ya utilizado.") from exc
                raise
            job = int(inserted[0])
            connection.commit()
        except BaseException:
            try:
                connection.rollback()
            except Exception:  # noqa: BLE001 - el error real es el que importa
                logger.debug("Rollback de FE_Reenvio fallo")
            raise
        finally:
            for resource in reversed(locks):
                try:
                    _release(cursor, resource)
                except Exception:  # noqa: BLE001 - la conexion se cierra igual
                    logger.debug("No se pudo liberar el lock %s", resource)

    logger.info(
        "FE_Reenvio enqueued job=%d id_venta=%d tipo=%s proc=%s actor=%s "
        "correlation_id=%s",
        job,
        identificador,
        tipo,
        procedimiento,
        actor,
        correlation_id,
    )
    return {
        "id": job,
        "duplicado": False,
        "tipo": tipo,
        "procedimiento": procedimiento,
    }


# --- Panel de cola ---------------------------------------------------------


def panel(*, limit: int = 20, estado: str = "") -> dict[str, Any]:
    """Foto de la cola, con la forma de ``feop_queue`` del ERP."""
    limite = max(1, min(int(limit), 200))
    filtro = _texto(estado).upper()

    with _panel_connection() as connection:
        cursor = connection.cursor()
        libre = _escalar(
            cursor,
            "SELECT APPLOCK_TEST('public', ?, 'Exclusive', 'Session') AS libre",
            WORKER_LOCK,
        )
        cursor.execute(
            "SELECT ID, UltimoContacto, Estado, TrabajoID, SPID "
            "FROM dbo.FE_Worker WHERE ID = 1"
        )
        worker = _fila(cursor)
        pendientes = _escalar(
            cursor,
            "SELECT COUNT(*) AS n FROM dbo.FE_Reenvio WHERE Estado = ?",
            EN_COLA,
        )
        sin_confirmar = _escalar(
            cursor,
            "SELECT COUNT(*) AS n FROM dbo.FE_Reenvio WHERE Estado = ?",
            NO_CONFIRMADO,
        )
        cursor.execute(
            f"SELECT TOP (100) {_COLUMNAS_SQL} FROM dbo.FE_Reenvio "
            f"WHERE Estado IN ({_ACTIVOS_PLACEHOLDERS}) ORDER BY ID",
            *ESTADOS_ACTIVOS,
        )
        activos = _filas(cursor)
        if filtro:
            cursor.execute(
                f"SELECT TOP (?) {_COLUMNAS_SQL} FROM dbo.FE_Reenvio "
                "WHERE Estado = ? ORDER BY ID DESC",
                limite,
                filtro,
            )
        else:
            cursor.execute(
                f"SELECT TOP (?) {_COLUMNAS_SQL} FROM dbo.FE_Reenvio "
                f"WHERE Estado NOT IN ({_ACTIVOS_PLACEHOLDERS}) ORDER BY ID DESC",
                limite,
                *ESTADOS_ACTIVOS,
            )
        historial = _filas(cursor)
        cursor.execute(
            "SELECT Estado, COUNT(*) AS n FROM dbo.FE_Reenvio GROUP BY Estado"
        )
        resumen = {
            _texto(row["Estado"]): int(row["n"])
            for row in _filas(cursor)
        }

    return {
        "ocupado": int(libre or 0) == 0,
        "worker": worker,
        "pendientes": int(pendientes or 0),
        "sin_confirmar": int(sin_confirmar or 0),
        "activos": activos,
        "historial": historial,
        "resumen": resumen,
        "total": sum(resumen.values()),
    }


# --- Resolver a mano -------------------------------------------------------


def resolver(queue_id: int, *, actor: str, nota: str) -> dict[str, Any]:
    """``NO_CONFIRMADO`` -> ``REVISADO_MANUAL`` (paridad ``feop_resolve``).

    Raises:
        NotFoundError: la fila no esta pendiente de confirmacion.
        ReenvioNoPermitidoError: el worker o el generador siguen activos.
    """
    identificador = int(queue_id)
    persona = _texto(actor)[:150]
    revision = _texto(nota)[:500]
    locks: list[str] = []
    with _write_connection() as connection:
        cursor = connection.cursor()
        try:
            _require_lock(
                cursor,
                WORKER_LOCK,
                "El procesador sigue activo. No se puede cerrar la revision.",
            )
            locks.append(WORKER_LOCK)

            cursor.execute(
                "SELECT ID, IDVenta, Tipo FROM dbo.FE_Reenvio WITH (UPDLOCK, ROWLOCK) "
                "WHERE ID = ? AND Estado = ?",
                identificador,
                NO_CONFIRMADO,
            )
            job = _fila(cursor)
            if job is None:
                raise NotFoundError(
                    "La solicitud no esta pendiente de confirmacion."
                )

            resource = (
                f"{procedimiento_para(job['Tipo'])}:ID:{int(job['IDVenta'])}"
            )
            _require_lock(
                cursor,
                resource,
                "El generador sigue utilizando este ID.",
            )
            locks.append(resource)

            cursor.execute(
                "UPDATE dbo.FE_Reenvio "
                "SET Estado = ?, Fin = GETDATE(), RevisadoPor = ?, "
                "Revision = ?, Detalle = ? "
                "WHERE ID = ? AND Estado = ?",
                REVISADO_MANUAL,
                persona,
                revision,
                _MARCA_REVISION,
                identificador,
                NO_CONFIRMADO,
            )
            if int(cursor.rowcount or 0) != 1:
                raise ReenvioNoPermitidoError(
                    "La solicitud ya no esta pendiente de confirmacion."
                )
            connection.commit()
        except BaseException:
            try:
                connection.rollback()
            except Exception:  # noqa: BLE001 - el error real es el que importa
                logger.debug("Rollback de FE_Reenvio fallo")
            raise
        finally:
            for resource in reversed(locks):
                try:
                    _release(cursor, resource)
                except Exception:  # noqa: BLE001 - la conexion se cierra igual
                    logger.debug("No se pudo liberar el lock %s", resource)

    logger.info(
        "FE_Reenvio resolved job=%d actor=%s", identificador, persona
    )
    return {
        "queue_id": identificador,
        "mensaje": (
            "Revision registrada. La cola continuara en la siguiente "
            "ejecucion del procesador."
        ),
    }


__all__ = [
    "QUEUE_LOCK",
    "QUEUE_TABLE",
    "WORKER_LOCK",
    "WORKER_TABLE",
    "encolar",
    "panel",
    "resolver",
]
