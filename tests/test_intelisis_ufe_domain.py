"""Tests del dominio de Intelisis UFE (estados, generador, incidencias).

Sin BD y sin reloj real: la hora se inyecta como argumento.
"""

from datetime import date, datetime

from src.domain import intelisis_ufe as ufe


def _intento(**kwargs):
    base = {
        "log_id": 1,
        "estado": "OK",
        "etapa": "FINALIZADO",
        "documento": "120-00004210",
        "detalle": None,
        "error_mensaje": None,
        "fecha_inicio": "2026-10-20T10:00:00",
    }
    base.update(kwargs)
    return base


AHORA = datetime(2026, 10, 21, 18, 0, 0)


class TestIdentidad:
    def test_serie_usa_servicio_serie_si_existe(self):
        assert (
            ufe.serie_documento("F001", 120, "120", True) == "F001"
        )

    def test_serie_sucursal_1_toma_serie_pu(self):
        assert ufe.serie_documento("", 1, "710", True) == "710"

    def test_serie_sucursal_1_sin_serie_pu_usa_001(self):
        assert ufe.serie_documento("", 1, "", True) == "001"

    def test_serie_por_sucursal_con_generar_txt(self):
        # GenerarTxtPeru = 1 -> manda la sucursal.
        assert ufe.serie_documento("", 120, "710", True) == "120"

    def test_serie_por_serie_pu_con_generar_txt(self):
        # GenerarTxtPeru = 0 -> manda SeriePU, con padding a 4.
        assert ufe.serie_documento("", 120, "710", False) == "0710"

    def test_serie_por_sucursal_sin_serie_pu(self):
        assert ufe.serie_documento("", 141, "", True) == "141"

    def test_numero_toma_lo_que_sigue_al_guion(self):
        assert ufe.numero_documento("120-4210") == "00004210"

    def test_numero_sin_guion_usa_el_mov_id(self):
        assert ufe.numero_documento("142702") == "00142702"

    def test_numero_vacio(self):
        assert ufe.numero_documento("") == "00000000"

    def test_identidad_completa(self):
        serie, numero = ufe.identidad_documento("", 120, "", True, "120-4210")
        assert (serie, numero) == ("120", "00004210")


class TestIdentidadSunat:
    def test_prefijo_por_tipo(self):
        assert ufe.prefijo_documento("01") == "F"
        assert ufe.prefijo_documento("03") == "B"
        assert ufe.prefijo_documento("07", "E-Boleta 109-85534") == "B"
        assert ufe.prefijo_documento("07", "E-Factura 710 1-211848") == "F"
        # La nota hereda la letra del documento que acredita, tambien cuando
        # ese documento nacio en SynerPOS (SE-*).
        assert ufe.prefijo_documento("07", "SE-Boleta 104-00038365") == "B"
        assert ufe.prefijo_documento("07", "SE-Factura 1-211848") == "F"

    def test_serie_sunat_usa_la_regla_del_txt(self):
        # Sucursal 0 o 1: la serie del punto de venta.
        assert ufe.serie_sunat("", 1, "710") == "710"
        assert ufe.serie_sunat("", 1, "") == "001"
        # Resto: los ultimos 3 digitos de la sucursal.
        assert ufe.serie_sunat("", 202, "") == "202"
        assert ufe.serie_sunat("", 202, "710") == "202"
        # El servicio manda sobre todo.
        assert ufe.serie_sunat("F001", 202, "710") == "F001"

    def test_comprobante_sunat(self):
        assert (
            ufe.comprobante_sunat("03", "", "", 602, "", "602-142702")
            == "B602-00142702"
        )
        assert (
            ufe.comprobante_sunat("01", "", "", 202, "", "202-2576")
            == "F202-00002576"
        )
        assert (
            ufe.comprobante_sunat("07", "E-Boleta 109-85534", "", 109, "", "109-2689")
            == "B109-00002689"
        )
        # Nota de credito que acredita una venta de SynerPOS: la serie SUNAT
        # lleva la letra del documento acreditado, no "N".
        assert (
            ufe.comprobante_sunat(
                "07", "SE-Boleta 104-00038365", "", 104, "", "104-3282"
            )
            == "B104-00003282"
        )


class TestEstadoUltimoIntento:
    def test_ok_finalizado_es_generado(self):
        estado = ufe._estado_ultimo_intento(_intento())
        assert estado == ufe.ESTADO_GENERADO

    def test_omitido_validacion(self):
        estado = ufe._estado_ultimo_intento(
            _intento(estado="OMITIDO_VALIDACION", etapa="VALIDACION_DOCUMENTO")
        )
        assert estado == ufe.ESTADO_OMITIDO_VALIDACION

    def test_validacion_documento_es_error(self):
        estado = ufe._estado_ultimo_intento(
            _intento(estado="OK", etapa="VALIDACION_DOCUMENTO")
        )
        assert estado == ufe.ESTADO_ERROR_VALIDACION

    def test_sin_bloque_tipo(self):
        estado = ufe._estado_ultimo_intento(
            _intento(estado="SIN_BLOQUE_TIPO", etapa="TIPO_MOVIMIENTO")
        )
        assert estado == ufe.ESTADO_SIN_BLOQUE

    def test_procesando(self):
        estado = ufe._estado_ultimo_intento(
            _intento(estado="PROCESANDO", etapa="PROCESANDO")
        )
        assert estado == ufe.ESTADO_EN_PROCESO

    def test_sin_intento_es_sin_registro(self):
        assert ufe._estado_ultimo_intento(None) == ufe.ESTADO_SIN_REGISTRO


class TestClasificacion:
    def test_documento_generado_es_conforme(self):
        r = ufe.clasificar_generacion(
            ultimo=_intento(),
            estatus_erp="CONCLUIDO",
            fecha_emision=date(2026, 10, 20),
            ahora=AHORA,
        )
        assert r["estado_generacion"] == ufe.ESTADO_GENERADO
        assert r["generador"] == ufe.GENERADOR_OK
        assert r["incidencias"] == []
        assert r["resultado"] == ufe.RESULTADO_CONFORME

    def test_error_de_validacion_es_revisar(self):
        r = ufe.clasificar_generacion(
            ultimo=_intento(
                estado="OMITIDO_VALIDACION",
                etapa="VALIDACION_DOCUMENTO",
                detalle="Numero de documento invalido.",
            ),
            estatus_erp="CONCLUIDO",
            fecha_emision=date(2026, 10, 20),
            ahora=AHORA,
        )
        assert r["estado_generacion"] == ufe.ESTADO_OMITIDO_VALIDACION
        assert r["generador"] == ufe.GENERADOR_SIN_OK
        assert r["incidencias"] == [ufe.INCIDENCIA_GENERADOR_SIN_OK]
        assert r["resultado"] == ufe.RESULTADO_REVISAR
        assert r["detalle_incidencia"] == "Numero de documento invalido."

    def test_en_proceso_no_es_incidencia(self):
        r = ufe.clasificar_generacion(
            ultimo=_intento(estado="PROCESANDO", etapa="PROCESANDO"),
            estatus_erp="CONCLUIDO",
            fecha_emision=date(2026, 10, 20),
            ahora=AHORA,
        )
        assert r["estado_generacion"] == ufe.ESTADO_EN_PROCESO
        assert r["generador"] == ufe.GENERADOR_SIN_OK
        assert r["incidencias"] == []
        assert r["resultado"] == ufe.RESULTADO_CONFORME

    def test_sin_registro_concluido_es_incidencia(self):
        r = ufe.clasificar_generacion(
            ultimo=None,
            estatus_erp="CONCLUIDO",
            fecha_emision=date(2026, 10, 20),
            ahora=AHORA,
        )
        assert r["estado_generacion"] == ufe.ESTADO_SIN_REGISTRO
        assert r["generador"] == ufe.GENERADOR_SIN_TRAZA
        assert r["incidencias"] == [ufe.INCIDENCIA_SIN_TRAZA]
        assert r["resultado"] == ufe.RESULTADO_REVISAR

    def test_sin_registro_pendiente_no_es_incidencia(self):
        r = ufe.clasificar_generacion(
            ultimo=None,
            estatus_erp="PENDIENTE",
            fecha_emision=date(2026, 10, 20),
            ahora=AHORA,
        )
        assert r["incidencias"] == []
        assert r["resultado"] == ufe.RESULTADO_CONFORME

    def test_lote_del_dia_dentro_de_gracia_no_alarma(self):
        r = ufe.clasificar_generacion(
            ultimo=None,
            estatus_erp="CONCLUIDO",
            fecha_emision=date(2026, 10, 21),
            ahora=datetime(2026, 10, 21, 2, 0, 0),
        )
        assert r["incidencias"] == []
        assert r["en_espera"] is True
        assert r["resultado"] == ufe.RESULTADO_CONFORME

    def test_lote_del_dia_pasada_la_gracia_alarma(self):
        r = ufe.clasificar_generacion(
            ultimo=None,
            estatus_erp="CONCLUIDO",
            fecha_emision=date(2026, 10, 21),
            ahora=datetime(2026, 10, 21, 9, 0, 0),
        )
        assert r["incidencias"] == [ufe.INCIDENCIA_SIN_TRAZA]
        assert r["en_espera"] is False

    def test_documento_anterior_a_la_bitacora_no_es_fallo(self):
        r = ufe.clasificar_generacion(
            ultimo=None,
            estatus_erp="CONCLUIDO",
            fecha_emision=date(2026, 9, 20),
            ahora=AHORA,
        )
        assert r["estado_generacion"] == ufe.ESTADO_FUERA_DE_BITACORA
        assert r["incidencias"] == []
        assert r["fuera_de_bitacora"] is True

    def test_nc_sobre_se_es_exenta(self):
        r = ufe.clasificar_generacion(
            ultimo=None,
            estatus_erp="CONCLUIDO",
            fecha_emision=date(2026, 10, 20),
            ahora=AHORA,
            tipo_documento_pu="07",
            referencia="SE-Boleta 104-00038062",
        )
        assert r["exento_generador"] is True
        assert r["generador"] == ufe.GENERADOR_NO_APLICA
        assert r["incidencias"] == []
        assert r["resultado"] == ufe.RESULTADO_CONFORME

    def test_nc_sobre_boleta_intelisis_no_es_exenta(self):
        r = ufe.clasificar_generacion(
            ultimo=None,
            estatus_erp="CONCLUIDO",
            fecha_emision=date(2026, 10, 20),
            ahora=AHORA,
            tipo_documento_pu="07",
            referencia="E-Boleta 109-85534",
        )
        assert r["exento_generador"] is False
        assert r["incidencias"] == [ufe.INCIDENCIA_SIN_TRAZA]

    def test_boleta_que_referencia_se_no_es_exenta(self):
        r = ufe.clasificar_generacion(
            ultimo=None,
            estatus_erp="CONCLUIDO",
            fecha_emision=date(2026, 10, 20),
            ahora=AHORA,
            tipo_documento_pu="03",
            referencia="SE-Boleta 104-00038062",
        )
        assert r["exento_generador"] is False


class TestSunat:
    def test_sin_consulta(self):
        assert ufe.clasificar_sunat(None) == (ufe.SUNAT_SIN_CONSULTA, [])

    def test_aceptado_no_incidencia(self):
        assert ufe.clasificar_sunat("ACEPTADO") == (ufe.SUNAT_ACEPTADO, [])

    def test_no_existe_es_incidencia(self):
        estado, incidencias = ufe.clasificar_sunat("NO_EXISTE")
        assert estado == ufe.SUNAT_NO_ENCONTRADO
        assert incidencias == [ufe.SUNAT_NO_ENCONTRADO]

    def test_anulado_es_incidencia(self):
        estado, incidencias = ufe.clasificar_sunat("ANULADO")
        assert estado == ufe.SUNAT_NO_ACEPTADO
        assert incidencias == [ufe.SUNAT_NO_ACEPTADO]

    def test_no_autorizado_es_incidencia(self):
        estado, incidencias = ufe.clasificar_sunat("NO_AUTORIZADO")
        assert estado == ufe.SUNAT_NO_ACEPTADO
        assert incidencias == [ufe.SUNAT_NO_ACEPTADO]

    def test_combine_incidencias(self):
        incidencias, resultado = ufe.combine_incidencias(
            [ufe.INCIDENCIA_SIN_TRAZA], [ufe.SUNAT_NO_ENCONTRADO]
        )
        assert incidencias == [
            ufe.INCIDENCIA_SIN_TRAZA,
            ufe.SUNAT_NO_ENCONTRADO,
        ]
        assert resultado == ufe.RESULTADO_REVISAR

    def test_combine_sin_incidencias(self):
        incidencias, resultado = ufe.combine_incidencias([], [])
        assert incidencias == []
        assert resultado == ufe.RESULTADO_CONFORME


class TestResumenes:
    def test_identidades_duplicadas(self):
        assert ufe.identidades_duplicadas(["A-1", "B-2", "A-1"]) == {"A-1"}
        assert ufe.identidades_duplicadas(["A-1", "B-2"]) == set()
        assert ufe.identidades_duplicadas(["", "A-1"]) == set()

    def test_resumen_por_generador(self):
        rows = [
            {"generador": "OK REGISTRADO"},
            {"generador": "OK REGISTRADO"},
            {"generador": "SIN OK"},
            {"generador": "SIN TRAZA"},
        ]
        assert ufe.resumen_por_generador(rows) == [
            {"key": "OK REGISTRADO", "count": 2},
            {"key": "SIN OK", "count": 1},
            {"key": "SIN TRAZA", "count": 1},
        ]

    def test_resumen_por_incidencia_cuenta_documentos(self):
        rows = [
            {"incidencias": ["SIN TRAZA"]},
            {"incidencias": ["SIN TRAZA", "SUNAT NO ENCONTRADO"]},
            {"incidencias": []},
        ]
        assert ufe.resumen_por_incidencia(rows) == [
            {"key": "SIN TRAZA", "count": 2},
            {"key": "SUNAT NO ENCONTRADO", "count": 1},
        ]
