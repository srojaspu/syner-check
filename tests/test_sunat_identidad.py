"""Identidad SUNAT compartida por los dos flujos (SynerPOS e Intelisis UFE).

Estas reglas son el punto donde un desajuste se ve como "SUNAT sin
consultar" en pantalla, asi que tienen su propio archivo de tests.
"""

from __future__ import annotations

import pytest

from src.application.sunat_identidad import (
    norm_numero,
    sunat_cache_key,
    sunat_doc_payload,
    sunat_map_estado,
)


class TestNormNumero:
    def test_quita_los_ceros_a_la_izquierda(self):
        assert norm_numero("00000152") == "152"
        assert norm_numero("152") == "152"

    def test_un_solo_cero_no_es_vacio(self):
        assert norm_numero("000") == "0"

    def test_vacio(self):
        assert norm_numero("") == ""
        assert norm_numero(None) == ""


class TestCacheKey:
    def test_separa_serie_y_numero(self):
        assert sunat_cache_key(
            "20101031773", "BOLETA", "B710-00004539"
        ) == ("20101031773", "03", "B710", "4539")

    def test_normaliza_el_numero(self):
        assert sunat_cache_key("20101031773", "FACTURA", "F001-1") == (
            "20101031773",
            "01",
            "F001",
            "1",
        )

    def test_tipo_desconocido_no_tiene_clave(self):
        assert sunat_cache_key("20101031773", "NOTA DE DEBITO", "B1-1") is None

    def test_numero_no_numerico_no_tiene_clave(self):
        assert sunat_cache_key("20101031773", "BOLETA", "B01-ABC") is None

    def test_sin_guion_no_tiene_clave(self):
        assert sunat_cache_key("20101031773", "BOLETA", "B0100001") is None


class TestDocPayload:
    def test_conserva_los_ceros_del_numero_impreso(self):
        payload = sunat_doc_payload(
            "20101031773", "BOLETA", "B710-00004539", "2026-10-21", 356.3
        )
        assert payload == {
            "ruc": "20101031773",
            "tipo": "03",
            "serie": "B710",
            "numero": "00004539",
            "fecha_emision": "2026-10-21",
            "importe": 356.3,
        }

    def test_ruc_invalido(self):
        with pytest.raises(ValueError):
            sunat_doc_payload("123", "BOLETA", "B710-1", "2026-10-21", 10)

    def test_fecha_invalida(self):
        with pytest.raises(ValueError):
            sunat_doc_payload(
                "20101031773", "BOLETA", "B710-1", "no-es-fecha", 10
            )

    def test_importe_invalido(self):
        with pytest.raises(ValueError):
            sunat_doc_payload(
                "20101031773", "BOLETA", "B710-1", "2026-10-21", "mucho"
            )

    def test_importe_negativo(self):
        with pytest.raises(ValueError):
            sunat_doc_payload(
                "20101031773", "BOLETA", "B710-1", "2026-10-21", -5
            )


class TestMapEstado:
    def test_estados_conocidos(self):
        assert sunat_map_estado("aceptado") == "ACEPTADO"
        assert sunat_map_estado("NO_EXISTE") == "NO_EXISTE"

    def test_estado_desconocido(self):
        assert sunat_map_estado("raro") == "DESCONOCIDO"
        assert sunat_map_estado(None) == "DESCONOCIDO"
