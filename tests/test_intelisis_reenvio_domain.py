"""Reglas del reenvio manual al generador UFE (dominio puro).

La cola es ``dbo.FE_Reenvio`` del ERP: aqui se prueba el vocabulario y las
guardas, sin base de datos.
"""

from __future__ import annotations

import pytest

from src.domain import intelisis_ufe as ufe
from src.domain.errors import ReenvioNoPermitidoError
from src.domain.intelisis_reenvio import (
    EJECUTANDO,
    EN_COLA,
    ESTADOS,
    ESTADOS_ACTIVOS,
    ESTADOS_FINALES,
    FINALIZADO_OK,
    FINALIZADO_REVISAR,
    NO_CONFIRMADO,
    NO_EJECUTADO,
    PROCEDIMIENTOS,
    PROC_NCND,
    PROC_UBL21,
    REVISADO_MANUAL,
    TIPOS,
    nuevo_token,
    procedimiento_para,
    puede_resolver,
    tipo_comprobante,
    token_fila,
    validar_encolado,
    validar_motivo,
    validar_nota,
    validar_peticion,
    validar_token,
)


class TestTipoYProcedimiento:
    def test_el_tipo_se_normaliza_al_codigo_char_2(self) -> None:
        assert tipo_comprobante("1") == "01"
        assert tipo_comprobante(" 07 ") == "07"
        assert tipo_comprobante(3) == "03"

    def test_un_tipo_fuera_de_la_lista_cerrada_no_pasa(self) -> None:
        for invalido in ("", "05", "09", "FA", None, "010"):
            with pytest.raises(ReenvioNoPermitidoError):
                tipo_comprobante(invalido)

    def test_factura_y_boleta_van_al_generador_general(self) -> None:
        assert procedimiento_para("01") == PROC_UBL21
        assert procedimiento_para("03") == PROC_UBL21

    def test_notas_van_al_generador_de_nc_nd(self) -> None:
        assert procedimiento_para("07") == PROC_NCND
        assert procedimiento_para("8") == PROC_NCND

    def test_un_tipo_desconocido_no_inventa_generador(self) -> None:
        with pytest.raises(ReenvioNoPermitidoError):
            procedimiento_para("XX")

    def test_la_lista_blanca_es_solo_la_del_worker(self) -> None:
        assert set(PROCEDIMIENTOS) == {PROC_UBL21, PROC_NCND}
        assert set(TIPOS) == {"01", "03", "07", "08"}


class TestValidarEncolado:
    def test_un_concluido_sin_registro_devuelve_su_tipo(self) -> None:
        assert (
            validar_encolado(
                estatus_erp="CONCLUIDO",
                estado_generacion=ufe.ESTADO_SIN_REGISTRO,
                tipo_documento_pu="03",
            )
            == "03"
        )

    def test_todos_los_estados_sin_documento_valido_se_aceptan(self) -> None:
        for estado in (
            ufe.ESTADO_SIN_REGISTRO,
            ufe.ESTADO_ERROR_VALIDACION,
            ufe.ESTADO_OMITIDO_VALIDACION,
            ufe.ESTADO_SIN_BLOQUE,
            ufe.ESTADO_FUERA_DE_BITACORA,
        ):
            validar_encolado(
                estatus_erp="CONCLUIDO",
                estado_generacion=estado,
                tipo_documento_pu="01",
            )

    def test_solo_el_concluido_es_reenviable(self) -> None:
        for estatus in ("PENDIENTE", "SINAFECTAR", "CANCELADO", ""):
            with pytest.raises(ReenvioNoPermitidoError, match="concluido"):
                validar_encolado(
                    estatus_erp=estatus,
                    estado_generacion=ufe.ESTADO_SIN_REGISTRO,
                    tipo_documento_pu="01",
                )

    def test_el_estatus_se_compara_sin_espacios_ni_minusculas(self) -> None:
        validar_encolado(
            estatus_erp=" concluido ",
            estado_generacion=ufe.ESTADO_SIN_REGISTRO,
            tipo_documento_pu="01",
        )

    def test_el_generador_en_curso_bloquea(self) -> None:
        with pytest.raises(ReenvioNoPermitidoError, match="trabajando"):
            validar_encolado(
                estatus_erp="CONCLUIDO",
                estado_generacion=ufe.ESTADO_EN_PROCESO,
                tipo_documento_pu="01",
                forzar=True,
            )

    def test_un_documento_ya_generado_exige_forzar(self) -> None:
        with pytest.raises(ReenvioNoPermitidoError, match="forzar"):
            validar_encolado(
                estatus_erp="CONCLUIDO",
                estado_generacion=ufe.ESTADO_GENERADO,
                tipo_documento_pu="01",
            )
        validar_encolado(
            estatus_erp="CONCLUIDO",
            estado_generacion=ufe.ESTADO_GENERADO,
            tipo_documento_pu="01",
            forzar=True,
        )

    def test_la_nc_sobre_un_documento_de_synerpos_no_aplica(self) -> None:
        with pytest.raises(ReenvioNoPermitidoError, match="SynerPOS"):
            validar_encolado(
                estatus_erp="CONCLUIDO",
                estado_generacion=ufe.ESTADO_SIN_REGISTRO,
                tipo_documento_pu="07",
                exento_generador=True,
                forzar=True,
            )

    def test_un_estado_desconocido_no_se_reenvia(self) -> None:
        with pytest.raises(ReenvioNoPermitidoError):
            validar_encolado(
                estatus_erp="CONCLUIDO",
                estado_generacion="generando_magia",
                tipo_documento_pu="01",
                forzar=True,
            )

    def test_un_tipo_invalido_no_llega_a_la_cola(self) -> None:
        with pytest.raises(ReenvioNoPermitidoError):
            validar_encolado(
                estatus_erp="CONCLUIDO",
                estado_generacion=ufe.ESTADO_SIN_REGISTRO,
                tipo_documento_pu="",
            )


class TestValidarPeticion:
    def test_normaliza_los_ids_en_el_orden_recibido(self) -> None:
        assert validar_peticion(["3", 1, "2"], max_batch=10) == [3, 1, 2]

    def test_una_lista_vacia_no_es_una_solicitud(self) -> None:
        with pytest.raises(ValueError, match="al menos un comprobante"):
            validar_peticion([], max_batch=10)

    def test_rechaza_identificadores_invalidos(self) -> None:
        for invalido in ("abc", None, 0, -5, 1.5j):
            with pytest.raises(ValueError, match="invalido"):
                validar_peticion([invalido], max_batch=10)

    def test_rechaza_repetidos(self) -> None:
        with pytest.raises(ValueError, match="repite"):
            validar_peticion([7, "7"], max_batch=10)

    def test_respeta_el_tope_del_lote(self) -> None:
        with pytest.raises(ValueError, match="maximo de 3"):
            validar_peticion([1, 2, 3, 4], max_batch=3)
        assert validar_peticion([1, 2, 3], max_batch=3) == [1, 2, 3]

    def test_el_tope_nunca_baja_de_uno(self) -> None:
        with pytest.raises(ValueError):
            validar_peticion([1, 2], max_batch=0)
        assert validar_peticion([1], max_batch=0) == [1]


class TestTextos:
    def test_el_motivo_es_obligatorio(self) -> None:
        for vacio in ("", "   ", None):
            with pytest.raises(ValueError, match="obligatorio"):
                validar_motivo(vacio)

    def test_el_motivo_se_recorta_y_respeta_los_500(self) -> None:
        assert validar_motivo("  error de serie  ") == "error de serie"
        assert len(validar_motivo("x" * 500)) == 500
        with pytest.raises(ValueError, match="500"):
            validar_motivo("x" * 501)

    def test_el_motivo_no_admite_caracteres_de_control(self) -> None:
        with pytest.raises(ValueError, match="no permitidos"):
            validar_motivo("sin\ntraza")

    def test_la_resolucion_manual_exige_nota(self) -> None:
        with pytest.raises(ValueError, match="obligatorio"):
            validar_nota("   ")
        assert validar_nota("  revisado en bitacora  ") == "revisado en bitacora"
        with pytest.raises(ValueError, match="500"):
            validar_nota("y" * 501)


class TestToken:
    def test_acepta_32_hex_y_normaliza_a_minusculas(self) -> None:
        assert validar_token("A" * 32) == "a" * 32

    def test_rechaza_tokens_que_no_son_32_hex(self) -> None:
        for invalido in ("", "abc", "g" * 32, "a" * 31, "a" * 33, None):
            with pytest.raises(ValueError, match="Token"):
                validar_token(invalido)

    def test_el_token_de_fila_es_unico_y_determinista(self) -> None:
        lote = nuevo_token()
        primero = token_fila(lote, 10)
        assert len(primero) == 32
        assert primero == token_fila(lote, 10)
        assert primero != token_fila(lote, 11)
        assert primero != token_fila(nuevo_token(), 10)

    def test_un_token_de_lote_invalido_no_deriva_filas(self) -> None:
        with pytest.raises(ValueError, match="Token"):
            token_fila("no-es-hex", 1)


class TestEstados:
    def test_solo_el_no_confirmado_se_resuelve_a_mano(self) -> None:
        assert puede_resolver(NO_CONFIRMADO) is True
        assert puede_resolver(" no_confirmado ") is True
        for estado in (
            EN_COLA,
            EJECUTANDO,
            FINALIZADO_OK,
            FINALIZADO_REVISAR,
            NO_EJECUTADO,
            REVISADO_MANUAL,
            "",
        ):
            assert puede_resolver(estado) is False

    def test_los_estados_son_los_de_la_restriccion_check(self) -> None:
        assert set(ESTADOS) == {
            "EN_COLA",
            "EJECUTANDO",
            "FINALIZADO_OK",
            "FINALIZADO_REVISAR",
            "NO_EJECUTADO",
            "NO_CONFIRMADO",
            "REVISADO_MANUAL",
        }

    def test_activos_y_finales_no_se_solapan_y_cubren_todo(self) -> None:
        assert set(ESTADOS_ACTIVOS).isdisjoint(ESTADOS_FINALES)
        assert set(ESTADOS_ACTIVOS) | set(ESTADOS_FINALES) == set(ESTADOS)
