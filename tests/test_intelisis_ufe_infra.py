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
from syner_check import intelisis_ufe_client
from syner_check.db_pool import FETCH_BATCH

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
    ("ImporteTotal",),
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
        "ImporteTotal": Decimal("149.25"),
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

    assert intelisis_ufe_client.fetch_intelisis_ufe_rows("2026-10-01", "2026-10-21") == []

    sql = connection.cursor_obj.statements[-1]
    assert "X.Clave IN ('VTAS.F', 'VTAS.FC', 'VTAS.B', 'VTAS.FB'" in sql
    assert "EXISTS" in sql
    assert "V.Empresa = 'PU'" in sql
    assert "day(" not in sql.lower()
    # El nombre del procedimiento nunca se ejecuta desde la app.
    assert "PUSP_ControlFac" not in sql


def test_query_parametriza_las_fechas(monkeypatch) -> None:
    connection = _install(monkeypatch, [])

    intelisis_ufe_client.fetch_intelisis_ufe_rows("2026-10-01", "2026-10-21")

    assert connection.cursor_obj.params[-1] == ("2026-10-01", "2026-10-21")


def test_normaliza_la_fila(monkeypatch) -> None:
    _install(monkeypatch, [_fila()])

    rows = intelisis_ufe_client.fetch_intelisis_ufe_rows("2026-10-21", "2026-10-21")

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
    assert row["ImporteTotal"] == pytest.approx(149.25)
    assert row["ClienteNombre"].startswith("GULIANA")


def test_sin_bitacora_deja_los_contadores_en_cero(monkeypatch) -> None:
    _install(
        monkeypatch,
        [_fila(LogID=None, EstadoIntento=None, Etapa=None, Documento=None,
               FechaInicio=None, Intentos=None, OkRegistrados=None,
               ImporteTotal=None)],
    )

    row = intelisis_ufe_client.fetch_intelisis_ufe_rows("2026-10-21", "2026-10-21")[0]

    assert row["LogID"] is None
    assert row["Documento"] == ""
    assert row["Intentos"] == 0
    assert row["OkRegistrados"] == 0


def test_lee_en_lotes_y_avisa_si_las_columnas_cambian(monkeypatch) -> None:
    connection = _install(monkeypatch, [_fila()])

    intelisis_ufe_client.fetch_intelisis_ufe_rows("2026-10-21", "2026-10-21")

    # Sin esto pyodbc pide una fila por viaje a la base (ver FETCH_BATCH).
    assert connection.cursor_obj.arraysize == FETCH_BATCH


def test_falla_claro_si_la_consulta_cambia_de_columnas(monkeypatch) -> None:
    connection = _install(monkeypatch, [_fila()])
    connection.cursor_obj.description = list(_COLUMNAS[:-1])

    with pytest.raises(RuntimeError, match="columnas"):
        intelisis_ufe_client.fetch_intelisis_ufe_rows("2026-10-21", "2026-10-21")


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


def test_lectura_de_un_comprobante_por_id(monkeypatch) -> None:
    connection = _install(monkeypatch, [_fila()])

    rows = intelisis_ufe_client.fetch_intelisis_ufe_row(7466462)

    assert len(rows) == 1
    assert rows[0]["IDVenta"] == 7466462
    sql = connection.cursor_obj.statements[-1]
    assert "V.ID = ?" in sql
    assert connection.cursor_obj.params[-1] == (7466462,)


def _intento_fila(**overrides) -> tuple:
    base = {
        "LogID": 22224,
        "IDVenta": 7466462,
        "FechaInicio": datetime(2026, 10, 21, 12, 41, 7),
        "FechaFin": datetime(2026, 10, 21, 12, 41, 9),
        "Estado": "OK",
        "Etapa": "FINALIZADO",
        "Detalle": None,
        "TipoDocumentoPU": "03",
        "TipoMovimiento": "BO",
        "Documento": "602-00142702",
        "ArchivoOut": "BO-602-00142702.txt",
        "Procedimiento": "SPPUFE_UBL21",
        "DuracionMs": 2100,
        "ErrorMensaje": None,
        "AutocorridarolSalida": "abc123",
        "Sucursal": 602,
    }
    base.update(overrides)
    return tuple(base[column[0]] for column in _INTENTO_COLUMNAS)


_INTENTO_COLUMNAS = [
    ("LogID",),
    ("IDVenta",),
    ("FechaInicio",),
    ("FechaFin",),
    ("Estado",),
    ("Etapa",),
    ("Detalle",),
    ("TipoDocumentoPU",),
    ("TipoMovimiento",),
    ("Documento",),
    ("ArchivoOut",),
    ("Procedimiento",),
    ("DuracionMs",),
    ("ErrorMensaje",),
    ("AutocorridarolSalida",),
    ("Sucursal",),
]


class _CursorIntentos(_Cursor):
    description = _INTENTO_COLUMNAS


class _ConnectionIntentos(_Connection):
    def __init__(self, rows: list[tuple]) -> None:
        self.cursor_obj = _CursorIntentos(rows)


def test_lectura_de_los_intentos_de_un_comprobante(monkeypatch) -> None:
    connection = _ConnectionIntentos([_intento_fila()])

    @contextmanager
    def pooled(_config, _password):
        yield connection

    monkeypatch.setattr("syner_check.config.get_intelisis_config", lambda: {})
    monkeypatch.setattr("syner_check.config.get_intelisis_password", lambda: "x")
    monkeypatch.setattr("syner_check.db_pool.pooled_connection", pooled)

    intentos = intelisis_ufe_client.fetch_intelisis_ufe_attempts(7466462)

    assert len(intentos) == 1
    intento = intentos[0]
    assert intento["LogID"] == 22224
    assert intento["Estado"] == "OK"
    assert intento["Etapa"] == "FINALIZADO"
    assert intento["Documento"] == "602-00142702"
    assert intento["HashSalida"] == "abc123"
    assert intento["FechaInicio"] == "2026-10-21 12:41:07"
    sql = connection.cursor_obj.statements[-1]
    assert "FROM dbo.SPPUFE_EjecucionLog" in sql
    assert connection.cursor_obj.params[-1] == (7466462,)


_RESUMEN_COLUMNAS = [("Estatus",), ("n",)]
_SIN_DOCUMENTO_COLUMNAS = [
    ("IDVenta",),
    ("Mov",),
    ("MovID",),
    ("FechaEmision",),
    ("Estatus",),
    ("Sucursal",),
    ("SucursalNombre",),
    ("ClienteNombre",),
    ("Importe",),
    ("Impuestos",),
    ("Documento",),
    ("DocumentoInvalido",),
]


def test_resumen_erp_cuenta_los_cuatro_estados(monkeypatch) -> None:
    """El total de la tarjeta no puede salir del listado: le faltan dos."""
    connection = _install(
        monkeypatch,
        [
            ("CONCLUIDO", 409),
            ("PENDIENTE", 8),
            ("SINAFECTAR", 16),
            ("CANCELADO", Decimal("0")),
        ],
    )
    connection.cursor_obj.description = _RESUMEN_COLUMNAS

    filas = intelisis_ufe_client.fetch_intelisis_ufe_resumen_erp(
        "2026-10-20", "2026-10-20"
    )

    assert filas == [
        {"Estatus": "CONCLUIDO", "n": 409},
        {"Estatus": "PENDIENTE", "n": 8},
        {"Estatus": "SINAFECTAR", "n": 16},
        {"Estatus": "CANCELADO", "n": 0},
    ]
    sql = connection.cursor_obj.statements[-1]
    assert "GROUP BY V.Estatus" in sql
    assert "'SINAFECTAR', 'CANCELADO'" in sql
    assert "V.Empresa = 'PU'" in sql
    # Sin joins de bitacora: es el universo de ventas, no el de documentos.
    assert "SPPUFE_EjecucionLog" not in sql
    assert connection.cursor_obj.params[-1] == ("2026-10-20", "2026-10-20")


def test_sin_documento_separa_el_numero_invalido(monkeypatch) -> None:
    connection = _install(
        monkeypatch,
        [
            (
                900,
                "VTAS.F",
                "175-13",
                date(2026, 10, 20),
                "SINAFECTAR",
                175,
                "Tienda Norte",
                "CLIENTE UNO",
                Decimal("100.0000"),
                Decimal("18.0000"),
                None,
                None,
            ),
            (
                901,
                "VTAS.F",
                "175-14",
                date(2026, 10, 20),
                "SINAFECTAR",
                175,
                "Tienda Norte",
                "CLIENTE DOS",
                Decimal("50.0000"),
                Decimal("9.0000"),
                None,
                "175-00000000",
            ),
        ],
    )
    connection.cursor_obj.description = _SIN_DOCUMENTO_COLUMNAS

    filas = intelisis_ufe_client.fetch_intelisis_ufe_sin_documento(
        "2026-10-20", "2026-10-20"
    )

    assert filas[0]["IDVenta"] == 900
    assert filas[0]["FechaEmision"] == "2026-10-20"
    assert filas[0]["Documento"] == ""
    assert filas[0]["DocumentoInvalido"] == ""
    assert filas[0]["Importe"] == pytest.approx(100.0)
    assert filas[1]["DocumentoInvalido"] == "175-00000000"
    sql = connection.cursor_obj.statements[-1]
    assert "V.Estatus = 'SINAFECTAR'" in sql
    # El login de lectura no tiene SELECT sobre VentaD: no se consulta.
    assert "VentaD" not in sql
    # El documento valido y el invalido se piden por separado.
    assert "Documento NOT LIKE '%00000000'" in sql
    assert "Documento LIKE '%00000000'" in sql
    assert "PUSP_ControlFac" not in sql
    assert connection.cursor_obj.params[-1] == ("2026-10-20", "2026-10-20")


def test_el_adaptador_expone_las_dos_consultas_nuevas(monkeypatch) -> None:
    monkeypatch.setattr(
        intelisis_db,
        "fetch_ufe_resumen_erp",
        lambda _s, _e: [{"Estatus": "CONCLUIDO", "n": 1}],
    )
    monkeypatch.setattr(
        intelisis_db,
        "fetch_ufe_sin_documento",
        lambda _s, _e: [{"IDVenta": 1}],
    )

    adapter = IntelisisUfeReaderAdapter()

    assert adapter.fetch_resumen_erp("2026-10-20", "2026-10-20") == [
        {"Estatus": "CONCLUIDO", "n": 1}
    ]
    assert adapter.fetch_sin_documento("2026-10-20", "2026-10-20") == [
        {"IDVenta": 1}
    ]

