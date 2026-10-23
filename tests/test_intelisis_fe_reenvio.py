"""Modulo SQL de la cola del ERP (``dbo.FE_Reenvio``) sin SQL Server.

Verifica el contrato que comparte con el PHP: locks, guardas, idempotencia
del token y la forma del panel de cola.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime

import pytest

from syner_check import intelisis_fe_reenvio as cola
from src.domain.errors import NotFoundError, ReenvioNoPermitidoError

TOKEN = "b" * 32
SALE = {
    "IDVenta": 7,
    "Mov": "E-Boleta",
    "Estatus": "CONCLUIDO",
    "TipoDocumentoPU": "03",
}


def _norm(sql: str) -> str:
    return " ".join(str(sql).lower().split())


class _Cursor:
    def __init__(self, handler) -> None:
        self.handler = handler
        self.executed: list[tuple[str, tuple]] = []
        self.description = None
        self.rowcount = 0
        self._rows: list = []

    def execute(self, sql, *params) -> None:
        self.executed.append((_norm(sql), params))
        rows, description, rowcount = self.handler(sql, params)
        self._rows = rows
        # pyodbc entrega ``(nombre, tipo, ...)`` por columna; el modulo lee
        # ``columna[0]``, asi que el fake imita esa forma.
        self.description = (
            [(nombre, None, None, None, None, None, None) for nombre in description]
            if description is not None
            else None
        )
        self.rowcount = rowcount

    def fetchone(self):
        return self._rows.pop(0) if self._rows else None

    def fetchall(self):
        rows, self._rows = self._rows, []
        return rows


class _Connection:
    def __init__(self, cursor: _Cursor) -> None:
        self._cursor = cursor
        self.committed = 0
        self.rolled_back = 0
        self.closed = False

    def cursor(self) -> _Cursor:
        return self._cursor

    def commit(self) -> None:
        self.committed += 1

    def rollback(self) -> None:
        self.rolled_back += 1

    def close(self) -> None:
        self.closed = True


@contextmanager
def _fake_connection(connection: _Connection):
    yield connection


def _select(rows, columns):
    return list(rows), list(columns), 0


def _row(datos: dict | None, columnas: list[str]):
    """Un dict del fake convertido a la tupla que devolveria pyodbc."""
    if not datos:
        return []
    return [tuple(datos.get(columna) for columna in columnas)]


def _rows(lista: list[dict], columnas: list[str]):
    return [tuple(fila.get(columna) for columna in columnas) for fila in lista]


def _exec(rowcount: int = 0):
    return [], None, rowcount


def _install(monkeypatch, handler) -> tuple[_Cursor, _Connection]:
    cursor = _Cursor(handler)
    connection = _Connection(cursor)
    monkeypatch.setattr(
        cola, "_write_connection", lambda: _fake_connection(connection)
    )
    return cursor, connection


def _enqueue_handler(**overrides):
    """Handler base del enqueue; cada test cambia solo lo que le importa."""
    data = {
        "locks": {},
        "token_row": None,
        "sale": dict(SALE),
        "active": None,
        "insert_id": 42,
        "insert_error": None,
    }
    data.update(overrides)

    def handler(sql, params):
        s = _norm(sql)
        if "sp_getapplock" in s:
            resource = params[0]
            return _select([(data["locks"].get(resource, 0),)], ["resultado"])
        if "sp_releaseapplock" in s:
            return _exec()
        if "from dbo.fe_reenvio where token = ?" in s:
            columns = ["ID", "IDVenta", "Usuario"]
            return _select(_row(data["token_row"], columns), columns)
        if "from dbo.venta" in s:
            columns = ["IDVenta", "Mov", "Estatus", "TipoDocumentoPU"]
            return _select(_row(data["sale"], columns), columns)
        if "idventa = ? and estado in" in s:
            return _select(_row(data["active"], ["ID"]), ["ID"])
        if "insert into dbo.fe_reenvio" in s:
            if data["insert_error"] is not None:
                raise data["insert_error"]
            return _select([(data["insert_id"],)], ["ID"])
        raise AssertionError(f"SQL inesperado: {s}")

    return handler


def _locks(cursor: _Cursor) -> list[str]:
    return [
        params[0]
        for sql, params in cursor.executed
        if "sp_getapplock" in sql
    ]


def _releases(cursor: _Cursor) -> list[str]:
    return [
        params[0]
        for sql, params in cursor.executed
        if "sp_releaseapplock" in sql
    ]


def _encolar(**kwargs):
    argumentos = {
        "id_venta": 7,
        "usuario": "dev@example.com",
        "motivo": "sin traza",
        "token": TOKEN,
    }
    argumentos.update(kwargs)
    return cola.encolar(**argumentos)


class TestEncolar:
    def test_inserta_la_fila_con_tipo_y_procedimiento_del_servidor(
        self, monkeypatch
    ) -> None:
        cursor, connection = _install(
            monkeypatch, _enqueue_handler()
        )

        out = _encolar(correlation_id="C-1")

        assert out == {
            "id": 42,
            "duplicado": False,
            "tipo": "03",
            "procedimiento": "SPPUFE_UBL21",
        }
        assert connection.committed == 1
        assert connection.rolled_back == 0
        assert _locks(cursor) == [cola.QUEUE_LOCK, "RMAND2:FE:VENTA:7"]
        assert _releases(cursor) == ["RMAND2:FE:VENTA:7", cola.QUEUE_LOCK]
        insert = next(
            params
            for sql, params in cursor.executed
            if "insert into dbo.fe_reenvio" in sql
        )
        assert insert == (
            7,
            "03",
            "SPPUFE_UBL21",
            "dev@example.com",
            "sin traza",
            TOKEN,
        )

    def test_una_nota_usa_el_generador_de_nc_nd(self, monkeypatch) -> None:
        sale = {**SALE, "Mov": "E-Nota Credito", "TipoDocumentoPU": "07"}
        _install(monkeypatch, _enqueue_handler(sale=sale))

        out = _encolar()

        assert out["tipo"] == "07"
        assert out["procedimiento"] == "SPPUFE_UBL21_NCND"

    def test_sin_movtipo_el_nombre_del_mov_resuelve_el_tipo(
        self, monkeypatch
    ) -> None:
        sale = {**SALE, "Mov": "E-Factura", "TipoDocumentoPU": None}
        _install(monkeypatch, _enqueue_handler(sale=sale))

        out = _encolar()

        assert out["tipo"] == "01"

    def test_el_token_repetido_del_mismo_documento_es_idempotente(
        self, monkeypatch
    ) -> None:
        cursor, connection = _install(
            monkeypatch,
            _enqueue_handler(
                token_row={
                    "ID": 9,
                    "IDVenta": 7,
                    "Usuario": "dev@example.com",
                }
            ),
        )

        out = _encolar()

        assert out == {
            "id": 9,
            "duplicado": True,
            "tipo": "",
            "procedimiento": "",
        }
        assert connection.committed == 1
        assert not any("insert into" in sql for sql, _ in cursor.executed)
        # Solo se compro el lock de la cola; no se llego a la venta.
        assert _locks(cursor) == [cola.QUEUE_LOCK]
        assert _releases(cursor) == [cola.QUEUE_LOCK]

    def test_el_token_de_otro_documento_se_rechaza(self, monkeypatch) -> None:
        _, connection = _install(
            monkeypatch,
            _enqueue_handler(
                token_row={"ID": 9, "IDVenta": 8, "Usuario": "dev@example.com"}
            ),
        )

        with pytest.raises(ReenvioNoPermitidoError, match="Token ya utilizado"):
            _encolar()

        assert connection.rolled_back == 1

    def test_el_token_de_otro_usuario_se_rechaza(self, monkeypatch) -> None:
        _install(
            monkeypatch,
            _enqueue_handler(
                token_row={"ID": 9, "IDVenta": 7, "Usuario": "otro@example.com"}
            ),
        )

        with pytest.raises(ReenvioNoPermitidoError, match="Token ya utilizado"):
            _encolar()

    def test_si_la_cola_esta_ocupada_no_toca_nada(self, monkeypatch) -> None:
        cursor, connection = _install(
            monkeypatch,
            _enqueue_handler(locks={cola.QUEUE_LOCK: -1}),
        )

        with pytest.raises(ReenvioNoPermitidoError, match="otra solicitud"):
            _encolar()

        assert len(_locks(cursor)) == 1
        assert _releases(cursor) == []
        assert connection.committed == 0
        assert connection.rolled_back == 1

    def test_si_la_venta_esta_en_ejecucion_no_encola(self, monkeypatch) -> None:
        _install(
            monkeypatch,
            _enqueue_handler(locks={"RMAND2:FE:VENTA:7": -1}),
        )

        with pytest.raises(ReenvioNoPermitidoError, match="ejecucion"):
            _encolar()

    def test_una_venta_inexistente_se_rechaza(self, monkeypatch) -> None:
        _install(monkeypatch, _enqueue_handler(sale=None))

        with pytest.raises(ReenvioNoPermitidoError, match="no encontrada"):
            _encolar()

    def test_un_movimiento_no_electronico_se_rechaza(self, monkeypatch) -> None:
        _install(
            monkeypatch,
            _enqueue_handler(sale={**SALE, "Mov": "FACTURA CONVENCIONAL"}),
        )

        with pytest.raises(ReenvioNoPermitidoError, match="electronico"):
            _encolar()

    def test_una_venta_no_concluida_se_rechaza(self, monkeypatch) -> None:
        _install(
            monkeypatch,
            _enqueue_handler(sale={**SALE, "Estatus": "PENDIENTE"}),
        )

        with pytest.raises(ReenvioNoPermitidoError, match="CONCLUIDOS"):
            _encolar()

    def test_un_tipo_desconocido_no_inventa_generador(self, monkeypatch) -> None:
        _install(
            monkeypatch,
            _enqueue_handler(
                sale={
                    **SALE,
                    "Mov": "E-Otro",
                    "TipoDocumentoPU": None,
                }
            ),
        )

        with pytest.raises(ReenvioNoPermitidoError, match="tipo"):
            _encolar()

    def test_una_fila_activa_del_mismo_documento_se_rechaza(
        self, monkeypatch
    ) -> None:
        _install(monkeypatch, _enqueue_handler(active={"ID": 12}))

        with pytest.raises(ReenvioNoPermitidoError, match="#12"):
            _encolar()

    def test_el_choque_del_indice_unico_de_token_se_traduce(
        self, monkeypatch
    ) -> None:
        error = Exception(
            "23000",
            "[23000] Violation of UNIQUE KEY constraint 'UQ__FE_Reenv'. (2627)",
        )
        _install(monkeypatch, _enqueue_handler(insert_error=error))

        with pytest.raises(ReenvioNoPermitidoError, match="Token ya utilizado"):
            _encolar()


PANEL_COLUMNS = list(cola._COLUMNAS)


def _panel_handler(**overrides):
    data = {
        "libre": 0,
        "worker": {
            "ID": 1,
            "UltimoContacto": datetime(2026, 10, 23, 11, 52, 30),
            "Estado": "EN_ESPERA",
            "TrabajoID": None,
            "SPID": 163,
        },
        "pendientes": 2,
        "sin_confirmar": 1,
        "activos": [{"ID": 1, "Estado": "EN_COLA"}],
        "historial": [{"ID": 2, "Estado": "FINALIZADO_OK"}],
        "resumen": [{"Estado": "EN_COLA", "n": 2}],
    }
    data.update(overrides)

    def handler(sql, params):
        s = _norm(sql)
        if "applock_test" in s:
            return _select([(data["libre"],)], ["libre"])
        if "from dbo.fe_worker" in s:
            row = data["worker"]
            return _select(
                [tuple(row.values())] if row else [],
                list(row.keys()) if row else ["ID"],
            )
        if "count(*) as n from dbo.fe_reenvio where estado = ?" in s:
            if params[0] == "EN_COLA":
                return _select([(data["pendientes"],)], ["n"])
            return _select([(data["sin_confirmar"],)], ["n"])
        if "where estado in" in s:
            return _select(
                [tuple(row.get(c) for c in PANEL_COLUMNS) for row in data["activos"]],
                PANEL_COLUMNS,
            )
        if "where estado = ? order by id desc" in s:
            return _select(
                [
                    tuple(row.get(c) for c in PANEL_COLUMNS)
                    for row in data["historial"]
                ],
                PANEL_COLUMNS,
            )
        if "estado not in" in s:
            return _select(
                [
                    tuple(row.get(c) for c in PANEL_COLUMNS)
                    for row in data["historial"]
                ],
                PANEL_COLUMNS,
            )
        if "group by estado" in s:
            return _select(
                [(row["Estado"], row["n"]) for row in data["resumen"]],
                ["Estado", "n"],
            )
        raise AssertionError(f"SQL inesperado: {s}")

    return handler


class TestPanel:
    def test_devuelve_la_foto_de_la_cola(self, monkeypatch) -> None:
        cursor = _Cursor(_panel_handler())
        monkeypatch.setattr(cola, "_panel_connection", lambda: _fake_connection(
            _Connection(cursor)
        ))

        out = cola.panel(limit=5)

        assert out["ocupado"] is True
        assert out["pendientes"] == 2
        assert out["sin_confirmar"] == 1
        assert out["resumen"] == {"EN_COLA": 2}
        assert out["total"] == 2
        assert out["worker"]["Estado"] == "EN_ESPERA"
        assert out["worker"]["UltimoContacto"] == "2026-10-23T11:52:30"
        assert out["activos"][0]["Estado"] == "EN_COLA"
        assert out["historial"][0]["ID"] == 2

    def test_el_worker_libre_no_marca_ocupado(self, monkeypatch) -> None:
        cursor = _Cursor(_panel_handler(libre=1))
        monkeypatch.setattr(cola, "_panel_connection", lambda: _fake_connection(
            _Connection(cursor)
        ))

        assert cola.panel()["ocupado"] is False

    def test_sin_filtro_el_historial_excluye_los_activos(
        self, monkeypatch
    ) -> None:
        cursor = _Cursor(_panel_handler())
        monkeypatch.setattr(cola, "_panel_connection", lambda: _fake_connection(
            _Connection(cursor)
        ))

        cola.panel(limit=7)

        historial = [
            (sql, params)
            for sql, params in cursor.executed
            if "order by id desc" in sql
        ]
        assert len(historial) == 1
        assert "not in" in historial[0][0]
        assert historial[0][1] == (7, *cola.ESTADOS_ACTIVOS)

    def test_con_filtro_el_historial_usa_solo_ese_estado(
        self, monkeypatch
    ) -> None:
        cursor = _Cursor(_panel_handler())
        monkeypatch.setattr(cola, "_panel_connection", lambda: _fake_connection(
            _Connection(cursor)
        ))

        cola.panel(limit=3, estado="finalizado_revisar")

        historial = [
            (sql, params)
            for sql, params in cursor.executed
            if "order by id desc" in sql
        ]
        assert len(historial) == 1
        assert "not in" not in historial[0][0]
        assert historial[0][1] == (3, "FINALIZADO_REVISAR")

    def test_el_limite_se_acota(self, monkeypatch) -> None:
        cursor = _Cursor(_panel_handler())
        monkeypatch.setattr(cola, "_panel_connection", lambda: _fake_connection(
            _Connection(cursor)
        ))

        cola.panel(limit=9999)

        historial = [
            params
            for sql, params in cursor.executed
            if "order by id desc" in sql
        ]
        assert historial[0][0] == 200


def _resolve_handler(**overrides):
    data = {
        "locks": {},
        "job": {"ID": 5, "IDVenta": 8, "Tipo": "07"},
        "rowcount": 1,
    }
    data.update(overrides)

    def handler(sql, params):
        s = _norm(sql)
        if "sp_getapplock" in s:
            return _select([(data["locks"].get(params[0], 0),)], ["resultado"])
        if "sp_releaseapplock" in s:
            return _exec()
        if "with (updlock, rowlock)" in s:
            columns = ["ID", "IDVenta", "Tipo"]
            return _select(_row(data["job"], columns), columns)
        if "update dbo.fe_reenvio" in s:
            return _exec(data["rowcount"])
        raise AssertionError(f"SQL inesperado: {s}")

    return handler


class TestResolver:
    def test_cierra_el_caso_sin_reintentar_el_sp(self, monkeypatch) -> None:
        cursor, connection = _install(monkeypatch, _resolve_handler())

        out = cola.resolver(5, actor="dev@example.com", nota="revisado")

        assert out["queue_id"] == 5
        assert "Revision registrada" in out["mensaje"]
        assert connection.committed == 1
        assert _locks(cursor) == [
            cola.WORKER_LOCK,
            "SPPUFE_UBL21_NCND:ID:8",
        ]
        assert _releases(cursor) == [
            "SPPUFE_UBL21_NCND:ID:8",
            cola.WORKER_LOCK,
        ]
        update = next(
            params
            for sql, params in cursor.executed
            if "update dbo.fe_reenvio" in sql
        )
        assert update == (
            "REVISADO_MANUAL",
            "dev@example.com",
            "revisado",
            cola._MARCA_REVISION,
            5,
            "NO_CONFIRMADO",
        )

    def test_si_el_worker_sigue_activo_no_cierra(self, monkeypatch) -> None:
        _, connection = _install(
            monkeypatch, _resolve_handler(locks={cola.WORKER_LOCK: -1})
        )

        with pytest.raises(ReenvioNoPermitidoError, match="procesador"):
            cola.resolver(5, actor="dev@example.com", nota="revisado")

        assert connection.rolled_back == 1

    def test_si_no_esta_no_confirmado_es_404(self, monkeypatch) -> None:
        _install(monkeypatch, _resolve_handler(job=None))

        with pytest.raises(NotFoundError):
            cola.resolver(5, actor="dev@example.com", nota="revisado")

    def test_si_el_generador_sigue_activo_no_cierra(self, monkeypatch) -> None:
        _install(
            monkeypatch,
            _resolve_handler(
                locks={"SPPUFE_UBL21_NCND:ID:8": -1}
            ),
        )

        with pytest.raises(ReenvioNoPermitidoError, match="generador"):
            cola.resolver(5, actor="dev@example.com", nota="revisado")

    def test_si_la_fila_cambio_de_estado_no_cierra(self, monkeypatch) -> None:
        _install(monkeypatch, _resolve_handler(rowcount=0))

        with pytest.raises(ReenvioNoPermitidoError, match="pendiente"):
            cola.resolver(5, actor="dev@example.com", nota="revisado")
