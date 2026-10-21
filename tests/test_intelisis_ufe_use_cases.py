"""Caso de uso de Intelisis UFE: filas, KPIs, filtros y estado SUNAT."""

from __future__ import annotations

from datetime import datetime

import pytest

from src.application.intelisis_ufe import (
    RangoInvalidoError,
    listar_ufe,
    validar_rango,
)

AHORA = datetime(2026, 10, 21, 18, 0, 0)


class _Reader:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.calls: list[tuple[str, str]] = []

    def fetch_rows(self, start_iso: str, end_iso: str) -> list[dict]:
        self.calls.append((start_iso, end_iso))
        return self.rows


class _Store:
    def __init__(self, cache: dict | None = None) -> None:
        self.cache = cache or {}
        self.keys: list[tuple] = []
        self.series: list[str] = []

    def fetch_many(self, keys):
        self.keys = list(keys)
        return {key: self.cache[key] for key in keys if key in self.cache}

    def fetch_by_series(self, ruc: str, series):
        self.series = list(series)
        return {
            key: value
            for key, value in self.cache.items()
            if key[0] == ruc and key[2] in self.series
        }


def _fila(
    *,
    id_venta: int = 1,
    mov: str = "E-Boleta",
    mov_id: str = "602-142702",
    estatus: str = "CONCLUIDO",
    sucursal: int = 602,
    tipo_documento_pu: str = "03",
    serie_pu: str = "",
    generar_txt: bool = True,
    referencia: str = "",
    log_id: int | None = 22223,
    estado_intento: str = "OK",
    etapa: str = "FINALIZADO",
    documento: str | None = None,
    intentos: int = 1,
    ok_registrados: int = 1,
) -> dict:
    if documento is None:
        # El documento oficial coincide con la identidad que calcula el
        # dominio (serie de la sucursal + correlativo del MovID).
        documento = f"602-{mov_id.split('-')[-1]:0>8}"
    return {
        "IDVenta": id_venta,
        "Mov": mov,
        "MovID": mov_id,
        "FechaEmision": "2026-10-21",
        "Estatus": estatus,
        "Sucursal": sucursal,
        "Importe": 100.0,
        "Impuestos": 18.0,
        "Referencia": referencia,
        "Cliente": "1000000082",
        "ServicioSerie": "",
        "TipoDocumentoPU": tipo_documento_pu,
        "SeriePU": serie_pu,
        "GenerarTxtPeru": generar_txt,
        "SucursalNombre": "Tienda Central",
        "ClienteNombre": "CLIENTE DE PRUEBA",
        "ClienteRfc": "20101031773",
        "LogID": log_id,
        "EstadoIntento": estado_intento,
        "Etapa": etapa,
        "Documento": documento,
        "Detalle": None,
        "ErrorMensaje": None,
        "FechaInicio": "2026-10-21 12:41:07",
        "FechaFin": "",
        "ArchivoOut": "BO-602-00142702.txt",
        "Procedimiento": "SPPUFE_UBL21",
        "DuracionMs": 2100,
        "HashSalida": "",
        "Intentos": intentos,
        "OkRegistrados": ok_registrados,
    }


def test_rango_maximo_de_31_dias() -> None:
    validar_rango("2026-10-01", "2026-10-31")
    with pytest.raises(RangoInvalidoError):
        validar_rango("2026-10-01", "2026-11-05")
    with pytest.raises(RangoInvalidoError):
        validar_rango("2026-10-10", "2026-10-01")


def test_documento_oficial_viene_de_la_bitacora() -> None:
    reader = _Reader([_fila()])

    out = listar_ufe(reader, start_iso="2026-10-21", end_iso="2026-10-21", now=AHORA)

    fila = out["rows"][0]
    assert fila["documento"] == "602-00142702"
    assert fila["documento_estimado"] is False


def test_documento_sin_bitacora_va_estimado() -> None:
    reader = _Reader(
        [_fila(log_id=None, estado_intento=None, etapa=None, documento="")]
    )

    out = listar_ufe(reader, start_iso="2026-10-21", end_iso="2026-10-21", now=AHORA)

    fila = out["rows"][0]
    assert fila["documento_estimado"] is True
    assert fila["documento"] == "602-00142702"


def test_kpis_del_periodo() -> None:
    reader = _Reader(
        [
            _fila(id_venta=1, mov_id="602-142702"),
            _fila(id_venta=2, mov_id="602-142703"),
            _fila(
                id_venta=3,
                mov_id="602-142704",
                estado_intento="OMITIDO_VALIDACION",
                etapa="VALIDACION_DOCUMENTO",
                documento="",
            ),
        ]
    )

    out = listar_ufe(reader, start_iso="2026-10-21", end_iso="2026-10-21", now=AHORA)

    kpis = out["kpis"]
    assert kpis["total"] == 3
    assert kpis["conformes"] == 2
    assert kpis["con_incidencia"] == 1
    assert kpis["por_generador"] == [
        {"key": "OK REGISTRADO", "count": 2},
        {"key": "SIN OK", "count": 1},
    ]
    assert kpis["por_incidencia"] == [
        {"key": "GENERADOR SIN OK", "count": 1}
    ]


def test_filtro_por_resultado() -> None:
    reader = _Reader(
        [
            _fila(id_venta=1, mov_id="602-142702"),
            _fila(
                id_venta=2,
                mov_id="602-142703",
                estado_intento="OMITIDO_VALIDACION",
                etapa="VALIDACION_DOCUMENTO",
                documento="",
            ),
        ]
    )

    out = listar_ufe(
        reader,
        start_iso="2026-10-21",
        end_iso="2026-10-21",
        now=AHORA,
        resultado="REVISAR",
    )

    assert out["filtrados"] == 1
    assert out["rows"][0]["id_venta"] == 2
    # Los KPIs son del periodo, como en el PHP.
    assert out["kpis"]["total"] == 2


def test_filtro_por_busqueda_de_texto() -> None:
    reader = _Reader(
        [
            _fila(id_venta=1, mov_id="602-142702"),
            _fila(id_venta=2, mov_id="120-4210"),
        ]
    )

    out = listar_ufe(
        reader, start_iso="2026-10-21", end_iso="2026-10-21", now=AHORA, q="120-4210"
    )

    assert out["filtrados"] == 1
    assert out["rows"][0]["id_venta"] == 2


def test_filtro_por_sucursal() -> None:
    reader = _Reader(
        [
            _fila(id_venta=1, sucursal=602, mov_id="602-142702"),
            _fila(id_venta=2, sucursal=120, mov_id="120-4210"),
        ]
    )

    out = listar_ufe(
        reader,
        start_iso="2026-10-21",
        end_iso="2026-10-21",
        now=AHORA,
        sucursal=120,
    )

    assert out["filtrados"] == 1
    assert out["rows"][0]["sucursal"] == 120


def test_estado_sunat_desde_el_cache() -> None:
    reader = _Reader([_fila(id_venta=1)])
    store = _Store({("20101031773", "03", "602", "142702"): {
        "Estado": "ACEPTADO",
        "FechaConsulta": "2026-10-21 12:45:00",
    }})

    out = listar_ufe(
        reader,
        start_iso="2026-10-21",
        end_iso="2026-10-21",
        now=AHORA,
        sunat_store=store,
        sunat_ruc="20101031773",
    )

    fila = out["rows"][0]
    assert fila["estado_sunat"] == "ACEPTADO"
    assert fila["sunat"]["consultado"] == "2026-10-21 12:45:00"
    assert fila["resultado"] == "CONFORME"


def test_sunat_negativo_es_incidencia() -> None:
    reader = _Reader([_fila(id_venta=1)])
    store = _Store({("20101031773", "03", "602", "142702"): {
        "Estado": "NO_EXISTE",
        "FechaConsulta": "2026-10-21 12:45:00",
    }})

    out = listar_ufe(
        reader,
        start_iso="2026-10-21",
        end_iso="2026-10-21",
        now=AHORA,
        sunat_store=store,
        sunat_ruc="20101031773",
    )

    fila = out["rows"][0]
    assert fila["estado_sunat"] == "SUNAT NO ENCONTRADO"
    assert fila["resultado"] == "REVISAR"
    assert "SUNAT NO ENCONTRADO" in fila["incidencias"]


def test_sin_consulta_sunat_no_es_incidencia() -> None:
    reader = _Reader([_fila(id_venta=1)])

    out = listar_ufe(
        reader,
        start_iso="2026-10-21",
        end_iso="2026-10-21",
        now=AHORA,
        sunat_store=_Store(),
        sunat_ruc="20101031773",
    )

    fila = out["rows"][0]
    assert fila["estado_sunat"] == "SUNAT SIN CONSULTA"
    assert fila["resultado"] == "CONFORME"
    assert out["kpis"]["sin_cobertura_sunat"] == 1


def test_nc_sobre_se_queda_exenta() -> None:
    reader = _Reader(
        [
            _fila(
                id_venta=1,
                tipo_documento_pu="07",
                referencia="SE-Boleta 104-00038062",
                log_id=None,
                estado_intento=None,
                etapa=None,
                documento=None,
            )
        ]
    )

    out = listar_ufe(reader, start_iso="2026-10-21", end_iso="2026-10-21", now=AHORA)

    fila = out["rows"][0]
    assert fila["exento_generador"] is True
    assert fila["generador"] == "NO APLICA"
    assert fila["resultado"] == "CONFORME"
    assert out["kpis"]["no_aplica"] == 1


def test_cruce_ambiguo_se_marca_en_las_dos_ventas() -> None:
    reader = _Reader(
        [
            _fila(id_venta=1, documento="602-00142702"),
            _fila(id_venta=2, mov_id="602-999999", documento="602-00142702"),
        ]
    )

    out = listar_ufe(reader, start_iso="2026-10-21", end_iso="2026-10-21", now=AHORA)

    for fila in out["rows"]:
        assert "CRUCE AMBIGUO" in fila["incidencias"]
        assert fila["resultado"] == "REVISAR"
    assert out["kpis"]["con_incidencia"] == 2


def test_una_factura_y_su_nota_no_son_cruce() -> None:
    """Misma serie y correlativo, distinto tipo: son documentos distintos."""
    reader = _Reader(
        [
            _fila(id_venta=1, mov_id="175-13", documento="175-00000013"),
            _fila(
                id_venta=2,
                mov_id="175-13",
                documento="175-00000013",
                tipo_documento_pu="07",
            ),
        ]
    )

    out = listar_ufe(reader, start_iso="2026-10-21", end_iso="2026-10-21", now=AHORA)

    for fila in out["rows"]:
        assert "CRUCE AMBIGUO" not in fila["incidencias"]
        assert fila["resultado"] == "CONFORME"
