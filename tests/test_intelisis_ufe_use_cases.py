"""Caso de uso de Intelisis UFE: filas, KPIs, filtros y estado SUNAT."""

from __future__ import annotations

from datetime import datetime

import pytest

from src.application.intelisis_ufe_filas import CAMPOS_LISTA, MAX_FILAS_LISTADO
from src.application.intelisis_ufe import (
    MAX_SIN_DOCUMENTO,
    RangoInvalidoError,
    detalle_ufe,
    listar_sin_documento,
    listar_ufe,
    validar_ufe,
    validar_rango,
)
from src.domain.errors import NotFoundError

AHORA = datetime(2026, 10, 21, 18, 0, 0)


class _Reader:
    def __init__(
        self,
        rows: list[dict],
        *,
        erp: list[dict] | None = None,
        sin_documento: list[dict] | None = None,
    ) -> None:
        self.rows = rows
        self.calls: list[tuple[str, str]] = []
        self.erp = erp
        self.sin_documento = sin_documento or []
        self.sin_documento_calls: list[tuple[str, str]] = []

    def fetch_rows(self, start_iso: str, end_iso: str) -> list[dict]:
        self.calls.append((start_iso, end_iso))
        return self.rows

    def fetch_resumen_erp(self, _start_iso: str, _end_iso: str) -> list[dict]:
        if self.erp is not None:
            return self.erp
        # Por defecto el agregado coincide con las filas: los estados sin
        # documento solo aparecen cuando la prueba los declara.
        conteo: dict[str, int] = {}
        for row in self.rows:
            clave = str(row.get("Estatus") or "").strip().upper()
            conteo[clave] = conteo.get(clave, 0) + 1
        return [{"Estatus": clave, "n": total} for clave, total in conteo.items()]

    def fetch_sin_documento(
        self, start_iso: str, end_iso: str
    ) -> list[dict]:
        self.sin_documento_calls.append((start_iso, end_iso))
        return self.sin_documento

    def fetch_row(self, id_venta: int) -> list[dict]:
        return [row for row in self.rows if row["IDVenta"] == id_venta]

    def fetch_attempts(self, id_venta: int) -> list[dict]:
        return [
            {
                "LogID": 22224,
                "Estado": "OK",
                "Etapa": "FINALIZADO",
                "Documento": "602-00142702",
                "Detalle": "",
                "ErrorMensaje": "",
                "FechaInicio": "2026-10-21 12:41:07",
                "FechaFin": "2026-10-21 12:41:09",
                "ArchivoOut": "BO-602-00142702.txt",
                "Procedimiento": "SPPUFE_UBL21",
                "DuracionMs": 2100,
                "HashSalida": "abc123",
                "TipoMovimiento": "BO",
            }
        ]


class _Validator:
    def __init__(self, estado: str = "ACEPTADO") -> None:
        self.estado = estado
        self.payloads: list[dict] = []

    def validate_single(self, documento: dict, usuario: str = "", origen: str = ""):
        self.payloads.append(dict(documento))
        return {
            "consulta_id": "C-1",
            "correlation_id": "X-1",
            "resultado": {
                "estado": self.estado,
                "codigo_sunat": "0",
                "observaciones": [],
            },
        }


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

    def upsert(self, row: dict) -> None:
        self.cache[
            (row["Ruc"], row["Tipo"], row["Serie"], row["Numero"])
        ] = row


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
    store = _Store({("20101031773", "03", "B602", "142702"): {
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
    store = _Store({("20101031773", "03", "B602", "142702"): {
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
            _fila(id_venta=1, mov_id="602-142702"),
            _fila(id_venta=2, mov_id="602-142702"),
        ]
    )

    out = listar_ufe(reader, start_iso="2026-10-21", end_iso="2026-10-21", now=AHORA)

    for fila in out["rows"]:
        assert "CRUCE AMBIGUO" in fila["incidencias"]
        assert fila["resultado"] == "REVISAR"
    assert out["kpis"]["con_incidencia"] == 2


class TestListadoServidor:
    """El listado viaja liviano y filtrado en el servidor."""

    def test_las_filas_solo_traen_los_campos_de_la_tabla(self) -> None:
        reader = _Reader([_fila(id_venta=1)])

        out = listar_ufe(reader, start_iso="2026-10-21", end_iso="2026-10-21", now=AHORA)

        fila = out["rows"][0]
        assert set(fila) == set(CAMPOS_LISTA)
        # SUNAT se arma desde el listado: sin el tipo no se puede validar.
        assert fila["tipo_sunat"] == "BOLETA"
        # Lo que solo necesita el detalle no viaja en el listado.
        assert "ruc" not in fila
        assert "hash" not in fila

    def test_filtra_por_generador(self) -> None:
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
            generador="SIN OK",
        )

        assert out["filtrados"] == 1
        assert out["rows"][0]["id_venta"] == 2

    def test_filtra_por_estado_sunat(self) -> None:
        reader = _Reader([_fila(id_venta=1)])

        out = listar_ufe(
            reader,
            start_iso="2026-10-21",
            end_iso="2026-10-21",
            now=AHORA,
            sunat="SUNAT SIN CONSULTA",
        )

        assert out["filtrados"] == 1

    def test_filtra_por_estatus_erp(self) -> None:
        reader = _Reader(
            [
                _fila(id_venta=1, estatus="CONCLUIDO"),
                _fila(id_venta=2, estatus="PENDIENTE"),
            ]
        )

        out = listar_ufe(
            reader,
            start_iso="2026-10-21",
            end_iso="2026-10-21",
            now=AHORA,
            estatus="CONCLUIDO",
        )

        assert [fila["id_venta"] for fila in out["rows"]] == [1]

    def test_los_kpis_desglosan_los_tres_ejes(self) -> None:
        reader = _Reader(
            [
                _fila(id_venta=1, estatus="CONCLUIDO"),
                _fila(id_venta=2, estatus="PENDIENTE"),
            ]
        )

        out = listar_ufe(
            reader,
            start_iso="2026-10-21",
            end_iso="2026-10-21",
            now=AHORA,
        )

        kpis = out["kpis"]

        def conteo(clave: str) -> dict[str, int]:
            return {item["key"]: item["count"] for item in kpis[clave]}

        # La tarjeta siempre muestra los cuatro estados del ERP, aunque el
        # periodo no tenga ventas en alguno: si faltara una clave, la UI
        # tendria que inventar el cero.
        assert conteo("por_estatus") == {
            "CONCLUIDO": 1,
            "PENDIENTE": 1,
            "SINAFECTAR": 0,
            "CANCELADO": 0,
        }
        assert conteo("por_estado_generacion") == {"generado": 2}
        assert conteo("por_estado_sunat") == {"SUNAT SIN CONSULTA": 2}

    def test_el_total_ventas_es_el_del_erp_no_el_del_listado(self) -> None:
        """SINAFECTAR y CANCELADO no traen documento, pero son parte del eje."""
        reader = _Reader(
            [
                _fila(id_venta=1, estatus="CONCLUIDO"),
                _fila(id_venta=2, estatus="PENDIENTE"),
            ],
            erp=[
                {"Estatus": "CONCLUIDO", "n": 409},
                {"Estatus": "PENDIENTE", "n": 8},
                {"Estatus": "SINAFECTAR", "n": 16},
                {"Estatus": "CANCELADO", "n": 0},
            ],
        )

        out = listar_ufe(
            reader, start_iso="2026-10-21", end_iso="2026-10-21", now=AHORA
        )

        kpis = out["kpis"]
        assert kpis["total_ventas"] == 433
        assert kpis["por_estatus"] == [
            {"key": "CONCLUIDO", "count": 409},
            {"key": "PENDIENTE", "count": 8},
            {"key": "SINAFECTAR", "count": 16},
            {"key": "CANCELADO", "count": 0},
        ]

    def test_por_estatus_listado_solo_los_documentados(self) -> None:
        """El filtro de la grilla no ofrece estados que nunca devuelve."""
        reader = _Reader(
            [
                _fila(id_venta=1, estatus="CONCLUIDO"),
                _fila(id_venta=2, estatus="PENDIENTE"),
            ],
            erp=[{"Estatus": "SINAFECTAR", "n": 16}],
        )

        out = listar_ufe(
            reader, start_iso="2026-10-21", end_iso="2026-10-21", now=AHORA
        )

        assert out["kpis"]["por_estatus_listado"] == [
            {"key": "CONCLUIDO", "count": 1},
            {"key": "PENDIENTE", "count": 1},
        ]

    def test_filtra_por_lista_de_tipos(self) -> None:
        reader = _Reader(
            [
                _fila(id_venta=1, mov_id="602-142702", tipo_documento_pu="03"),
                _fila(id_venta=2, mov_id="602-142703", tipo_documento_pu="01"),
            ]
        )

        out = listar_ufe(
            reader,
            start_iso="2026-10-21",
            end_iso="2026-10-21",
            now=AHORA,
            tipos=["BO"],
        )

        assert out["filtrados"] == 1
        assert out["rows"][0]["tipo"] == "BO"

    def test_recorta_el_listado_y_lo_avisa(self) -> None:
        filas = [
            _fila(id_venta=index, mov_id=f"602-{142702 + index}")
            for index in range(1, 12)
        ]
        reader = _Reader(filas)

        out = listar_ufe(
            reader,
            start_iso="2026-10-21",
            end_iso="2026-10-21",
            now=AHORA,
        )

        assert out["truncado"] is False
        assert out["max_filas"] == MAX_FILAS_LISTADO

    def test_la_cobertura_por_dia_agrupa(self) -> None:
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

        out = listar_ufe(reader, start_iso="2026-10-21", end_iso="2026-10-21", now=AHORA)

        por_dia = out["kpis"]["por_dia"]
        assert len(por_dia) == 1
        assert por_dia[0]["documentos"] == 2
        assert por_dia[0]["con_incidencia"] == 1

    def test_pendiente_sin_bitacora_no_es_sin_traza(self) -> None:
        """D19: una PENDIENTE todavia no debia pasar por el generador."""
        reader = _Reader(
            [
                _fila(
                    id_venta=1,
                    estatus="PENDIENTE",
                    log_id=None,
                    estado_intento=None,
                    etapa=None,
                    documento="",
                )
            ]
        )

        out = listar_ufe(
            reader, start_iso="2026-10-21", end_iso="2026-10-21", now=AHORA
        )

        kpis = out["kpis"]
        fila = out["rows"][0]
        assert fila["estado_generacion"] == "sin_registro"
        assert "SIN TRAZA" not in fila["incidencias"]
        assert fila["resultado"] == "CONFORME"
        assert kpis["sin_traza"] == 0
        assert kpis["pendientes_conclusion"] == 1
        assert kpis["por_dia"][0]["sin_traza"] == 0

    def test_concluido_sin_bitacora_si_es_sin_traza(self) -> None:
        """D19: una CONCLUIDA sin registro es un fallo real del generador."""
        reader = _Reader(
            [
                _fila(
                    id_venta=1,
                    estatus="CONCLUIDO",
                    log_id=None,
                    estado_intento=None,
                    etapa=None,
                    documento="",
                )
            ]
        )

        out = listar_ufe(
            reader, start_iso="2026-10-21", end_iso="2026-10-21", now=AHORA
        )

        kpis = out["kpis"]
        fila = out["rows"][0]
        assert "SIN TRAZA" in fila["incidencias"]
        assert fila["resultado"] == "REVISAR"
        assert kpis["sin_traza"] == 1
        assert kpis["pendientes_conclusion"] == 0
        assert kpis["por_dia"][0]["sin_traza"] == 1

    def test_sunat_consultables_cuenta_los_que_tienen_tipo(self) -> None:
        reader = _Reader(
            [
                _fila(id_venta=1, tipo_documento_pu="03"),
                _fila(id_venta=2, mov_id="602-142703", tipo_documento_pu=""),
            ]
        )

        out = listar_ufe(
            reader, start_iso="2026-10-21", end_iso="2026-10-21", now=AHORA
        )

        assert out["kpis"]["total"] == 2
        assert out["kpis"]["sunat_consultables"] == 1


class TestVentasSinDocumento:
    """Dialogo "Ventas sin documentar": SINAFECTAR, fuera de la grilla."""

    def test_mapea_las_dos_situaciones_reales(self) -> None:
        reader = _Reader(
            [],
            sin_documento=[
                {
                    "IDVenta": 10,
                    "Mov": "VTAS.F",
                    "MovID": "175-13",
                    "FechaEmision": "2026-10-20",
                    "Estatus": "SINAFECTAR",
                    "Sucursal": 175,
                    "SucursalNombre": "Tienda Norte",
                    "ClienteNombre": "CLIENTE UNO",
                    "Importe": 100.0,
                    "Impuestos": 18.0,
                    "Documento": "",
                    "DocumentoInvalido": "",
                },
                {
                    "IDVenta": 11,
                    "Mov": "VTAS.F",
                    "MovID": "175-14",
                    "FechaEmision": "2026-10-20",
                    "Estatus": "SINAFECTAR",
                    "Sucursal": 175,
                    "SucursalNombre": "Tienda Norte",
                    "ClienteNombre": "CLIENTE DOS",
                    "Importe": 50.0,
                    "Impuestos": 9.0,
                    "Documento": "",
                    "DocumentoInvalido": "175-00000000",
                },
            ],
        )

        out = listar_sin_documento(
            reader, start_iso="2026-10-20", end_iso="2026-10-20"
        )

        assert out["total"] == 2
        assert out["truncado"] is False
        assert out["max_filas"] == MAX_SIN_DOCUMENTO
        primera, segunda = out["rows"]
        assert primera["situacion"] == "sin_documento"
        assert primera["documento"] is None
        assert primera["total"] == 118.0
        # Un numero con ocho ceros no es un comprobante: se informa aparte.
        assert segunda["situacion"] == "documento_invalido"
        assert segunda["documento_invalido"] == "175-00000000"
        assert segunda["documento"] is None

    def test_valida_el_rango_y_no_consulta_si_es_invalido(self) -> None:
        reader = _Reader([], sin_documento=[])

        with pytest.raises(RangoInvalidoError):
            listar_sin_documento(
                reader, start_iso="2026-09-01", end_iso="2026-10-20"
            )

        assert reader.sin_documento_calls == []

    def test_pide_el_periodo_al_lector(self) -> None:
        reader = _Reader([], sin_documento=[])

        listar_sin_documento(
            reader, start_iso="2026-10-20", end_iso="2026-10-21"
        )

        assert reader.sin_documento_calls == [
            ("2026-10-20", "2026-10-21")
        ]


def test_una_factura_y_su_nota_no_son_cruce() -> None:
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


class TestDetalle:
    def test_devuelve_la_venta_y_los_intentos(self) -> None:
        reader = _Reader([_fila(id_venta=1)])

        out = detalle_ufe(
            reader,
            id_venta=1,
            sunat_store=_Store(),
            sunat_ruc="20101031773",
            now=AHORA,
        )

        assert out["id_venta"] == 1
        assert out["venta"]["documento"] == "602-00142702"
        assert out["venta"]["estado_generacion"] == "generado"
        assert out["estado_sunat"] == "SUNAT SIN CONSULTA"
        assert len(out["intentos"]) == 1
        intento = out["intentos"][0]
        assert intento["estado"] == "OK"
        assert intento["etapa"] == "FINALIZADO"
        assert intento["log_id"] == 22224

    def test_comprobante_inexistente(self) -> None:
        reader = _Reader([_fila(id_venta=1)])

        with pytest.raises(NotFoundError):
            detalle_ufe(reader, id_venta=999, now=AHORA)


class TestValidar:
    def test_consulta_sunat_con_la_identidad_del_documento(self) -> None:
        reader = _Reader([_fila(id_venta=1)])
        validator = _Validator()
        store = _Store()

        out = validar_ufe(
            reader,
            validator,
            store,
            id_venta=1,
            sunat_ruc="20101031773",
            usuario="dev@example.com",
            now=AHORA,
        )

        assert out["estado"] == "ACEPTADO"
        payload = validator.payloads[0]
        assert payload["ruc"] == "20101031773"
        assert payload["tipo"] == "03"
        assert payload["serie"] == "B602"
        assert payload["numero"] == "00142702"
        assert payload["fecha_emision"] == "2026-10-21"
        assert payload["importe"] == 118.0
        assert payload["forzar_consulta"] is True
        # El cache guarda el numero sin ceros (como el lote y las consultas).
        assert ("20101031773", "03", "B602", "142702") in store.cache

    def test_nota_de_debito_no_admite_consulta(self) -> None:
        reader = _Reader([_fila(id_venta=1, tipo_documento_pu="08")])

        with pytest.raises(ValueError):
            validar_ufe(
                reader,
                _Validator(),
                _Store(),
                id_venta=1,
                sunat_ruc="20101031773",
                now=AHORA,
            )

    def test_sin_ruc_no_hay_validacion(self) -> None:
        reader = _Reader([_fila(id_venta=1)])

        with pytest.raises(ValueError):
            validar_ufe(
                reader,
                _Validator(),
                _Store(),
                id_venta=1,
                sunat_ruc="",
                now=AHORA,
            )

