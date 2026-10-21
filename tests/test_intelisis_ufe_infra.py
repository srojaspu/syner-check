"""Lector UFE: SQL parametrizado, universo correcto y normalizacion.

El lector es la copia de ``dbo.PUSP_ControlFac`` (D22): si el universo o el
rango de fechas cambian, estas pruebas lo detectan.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal

import pytest

from app import intelisis_db
from src.domain.errors import UpstreamError
from src.infrastructure.intelisis_ufe import IntelisisUfeReaderAdapter
from syner_check import db_client

_COLUMNAS = [
    ("IDVenta",),
    ("Mov",),
    ("MovID",),
    ("FechaEmision",),
    ("Estatus",),
    ("Sucursal",),
    ("Importe",),
    ("Impuestos",),
    ("Referencia",),
    ("Cliente",),
    ("ServicioSerie",),
    ("TipoDocumentoPU",),
    ("SeriePU",),
    ("GenerarTxtPeru",),
    ("SucursalNombre",),
    ("ClienteNombre",),
    ("ClienteRfc",),
    ("LogID",),
    ("EstadoIntento",),
    ("Etapa",),
    ("Documento",),
    ("Detalle",),
    ("ErrorMensaje",),
    ("FechaInicio",),
    ("FechaFin",),
    ("ArchivoOut",),
    ("Procedimiento",),
    ("DuracionMs",),
    ("AutocorridarolSalida",),
    ("Intentos",),
    ("OkRegistrados",),
]


class _Cursor:
    description = _COLUMNAS

    def __init__(self, rows: list[tuple]) -> None:
        self.rows = rows
        self.statements: list[str] = []
        self.params: list[tuple] = []

    def execute(self, sql, *params) -> None:
        self.statements.append(sql)
        self.params.append(params)

    def fetchall(self) -> list[tuple]:
        return self.rows


class _Connection:
    def __init__(self, rows: list[tuple]) -> None:
        self.cursor_obj = _Cursor(rows)

    def cursor(self) -> _Cursor:
        return self.cursor_obj


def _fila(**overrides) -> tuple:
    base = {
        "IDVenta": 7466462,
        "Mov": "E-Boleta",
        "MovID": "602-142702",
        "FechaEmision": date(2026, 10, 21),
        "Estatus": "CONCLUIDO",
        "Sucursal": 602,
        "Importe": Decimal("129.5000"),
        "Impuestos": Decimal("19.7542"),
        "Referencia": "",
        "Cliente": "1000000082",
        "ServicioSerie": "",
        "TipoDocumentoPU": "03",
        "SeriePU": "",
        "GenerarTxtPeru": True,
        "SucursalNombre": "Tienda Central",
        "ClienteNombre": "GULIANA ANTONELA PACIN GURIERRES",
        "ClienteRfc": "20101031773",
        "LogID": 22223,
        "EstadoIntento": "OK",
        "Etapa": "FINALIZADO",
        "Documento": "602-00142702",
        "Detalle": None,
        "ErrorMensaje": None,
        "FechaInicio": datetime(2026, 10, 21, 12, 41, 7),
        "FechaFin": datetime(2026, 10, 21, 12, 41, 9),
        "ArchivoOut": "BO-B602-00142702.txt",
        "Procedimiento": "SPPUFE_UBL21",
        "DuracionMs": 2100,
        "AutocorridarolSalida": "abc123",
        "Intentos": 2,
        "OkRegistrados": 2,
    }
    base.update(overrides)
    return tuple(base[column[0]] for column in _COLUMNAS)


def _install(monkeypatch, rows: list[tuple]) -> _Connection:
    connection = _Connection(rows)

    @contextmanager
    def pooled(_config, _password):
        yield connection

    monkeypatch.setattr("syner_check.config.get_intelisis_config", lambda: {})
    monkeypatch.setattr("syner_check.config.get_intelisis_password", lambda: "x")
    monkeypatch.setattr("syner_check.db_pool.pooled_connection", pooled)
    return connection


def test_query_usa_el_universo_por_datos(monkeypatch) -> None:
    connection = _install(monkeypatch, [])

    assert db_client.fetch_intelisis_ufe_rows("2026-10-01", "2026-10-21") == []

    sql = connection.cursor_obj.statements[-1]
    assert "X.Clave IN ('VTAS.F', 'VTAS.FC', 'VTAS.B', 'VTAS.FB'" in sql
    assert "EXISTS" in sql
    assert "V.Empresa = 'PU'" in sql
    assert "day(" not in sql.lower()
    # El nombre del procedimiento nunca se ejecuta desde la app.
    assert "PUSP_ControlFac" not in sql


def test_query_parametriza_las_fechas(monkeypatch) -> None:
    connection = _install(monkeypatch, [])

    db_client.fetch_intelisis_ufe_rows("2026-10-01", "2026-10-21")

    assert connection.cursor_obj.params[-1] == ("2026-10-01", "2026-10-21")


def test_normaliza_la_fila(monkeypatch) -> None:
    _install(monkeypatch, [_fila()])

    rows = db_client.fetch_intelisis_ufe_rows("2026-10-21", "2026-10-21")

    row = rows[0]
    assert row["IDVenta"] == 7466462
    assert row["FechaEmision"] == "2026-10-21"
    assert row["FechaInicio"] == "2026-10-21 12:41:07"
    assert row["Importe"] == pytest.approx(129.5)
    assert row["Impuestos"] == pytest.approx(19.7542)
    assert row["GenerarTxtPeru"] is True
    assert row["HashSalida"] == "abc123"
    assert row["Intentos"] == 2
    assert row["OkRegistrados"] == 2
    assert row["ClienteNombre"].startswith("GULIANA")


def test_sin_bitacora_deja_los_contadores_en_cero(monkeypatch) -> None:
    _install(
        monkeypatch,
        [_fila(LogID=None, EstadoIntento=None, Etapa=None, Documento=None,
               FechaInicio=None, Intentos=None, OkRegistrados=None)],
    )

    row = db_client.fetch_intelisis_ufe_rows("2026-10-21", "2026-10-21")[0]

    assert row["LogID"] is None
    assert row["Documento"] == ""
    assert row["Intentos"] == 0
    assert row["OkRegistrados"] == 0


def test_el_adaptador_traduce_errores(monkeypatch) -> None:
    def _boom(_start: str, _end: str):
        raise RuntimeError("no se pudo leer")

    monkeypatch.setattr(intelisis_db, "fetch_intelisis_ufe_rows", _boom)

    with pytest.raises(UpstreamError):
        intelisis_db.fetch_ufe_rows("2026-10-21", "2026-10-21")


def test_el_adaptador_no_pierde_la_fila(monkeypatch) -> None:
    fila = {"IDVenta": 1, "Mov": "E-Boleta"}
    monkeypatch.setattr(
        intelisis_db, "fetch_intelisis_ufe_rows", lambda _s, _e: [fila]
    )

    adapter = IntelisisUfeReaderAdapter()

    assert adapter.fetch_rows("2026-10-21", "2026-10-21") == [fila]
