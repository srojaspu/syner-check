"""Casos de uso del reenvio UFE: encolar en FE_Reenvio, panel y resolucion."""

from __future__ import annotations

from datetime import datetime

import pytest

from src.application.intelisis_reenvio import (
    encolar_reenvio,
    listar_reenvios,
    resolver_reenvio,
)
from src.domain.errors import NotFoundError, ReenvioNoPermitidoError
from src.domain.intelisis_reenvio import token_fila

AHORA = datetime(2026, 10, 21, 18, 0, 0)
TOKEN = "a" * 32


def _fila(
    *,
    id_venta: int = 1,
    estatus: str = "CONCLUIDO",
    tipo: str = "03",
    referencia: str = "",
    log_id: int | None = None,
    estado: str | None = None,
    etapa: str | None = None,
    documento: str = "",
) -> dict:
    """Venta minima que necesita ``fila_documento``."""
    return {
        "IDVenta": id_venta,
        "Mov": "E-Boleta",
        "MovID": "602-142702",
        "FechaEmision": "2026-10-21",
        "Estatus": estatus,
        "Sucursal": 602,
        "Importe": 100.0,
        "Impuestos": 18.0,
        "Referencia": referencia,
        "Cliente": "1000000082",
        "ServicioSerie": "",
        "TipoDocumentoPU": tipo,
        "SeriePU": "",
        "GenerarTxtPeru": True,
        "LogID": log_id,
        "EstadoIntento": estado,
        "Etapa": etapa,
        "Documento": documento,
        "Detalle": None,
        "ErrorMensaje": None,
        "FechaInicio": "2026-10-21 12:41:07",
        "Intentos": 1,
        "OkRegistrados": 1,
    }


class _Reader:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = {int(row["IDVenta"]): row for row in rows}
        self.consultados: list[int] = []

    def fetch_row(self, id_venta: int) -> list[dict]:
        self.consultados.append(id_venta)
        row = self.rows.get(id_venta)
        return [row] if row else []


class _Queue:
    def __init__(
        self,
        *,
        vivos: set[int] | None = None,
        duplicados: set[int] | None = None,
    ) -> None:
        self.vivos = vivos or set()
        self.duplicados = duplicados or set()
        self.encolados: list[dict] = []
        self.resueltos: list[dict] = []
        self.filtro: tuple[int, str] | None = None
        self.mensaje = "Revision registrada."

    def encolar(self, *, id_venta, usuario, motivo, token, correlation_id=""):
        if id_venta in self.vivos:
            raise ReenvioNoPermitidoError(
                "El ID ERP ya tiene la solicitud #9 pendiente o sin confirmar."
            )
        if id_venta in self.duplicados:
            return {"id": 99, "duplicado": True}
        self.encolados.append(
            {
                "id_venta": id_venta,
                "usuario": usuario,
                "motivo": motivo,
                "token": token,
                "correlation_id": correlation_id,
            }
        )
        return {"id": len(self.encolados), "duplicado": False}

    def panel(self, *, limit=20, estado=""):
        self.filtro = (limit, estado)
        return {
            "ocupado": False,
            "worker": {"ID": 1, "Estado": "EN_ESPERA"},
            "pendientes": 1,
            "sin_confirmar": 0,
            "activos": [{"ID": 1}],
            "historial": [{"ID": 2}],
            "resumen": {"EN_COLA": 1},
            "total": 1,
        }

    def resolver(self, queue_id, *, actor, nota):
        self.resueltos.append(
            {"queue_id": queue_id, "actor": actor, "nota": nota}
        )
        return {"queue_id": queue_id, "mensaje": self.mensaje}


class TestEncolar:
    def test_encola_un_comprobante_sin_registro(self) -> None:
        queue = _Queue()

        out = encolar_reenvio(
            _Reader([_fila()]),
            queue,
            ids=["1"],
            usuario="dev@example.com",
            motivo="sin traza",
            correlation_id="C-1",
            token=TOKEN,
            now=AHORA,
        )

        assert out["total"] == 1
        assert out["encolados"] == 1
        assert out["duplicados"] == 0
        assert out["rechazados"] == 0
        item = out["detalle"][0]
        assert item["estado"] == "encolado"
        assert item["queue_id"] == 1
        assert item["documento"] == "602-00142702"
        assert item["tipo"] == "03"
        assert item["procedimiento"] == "SPPUFE_UBL21"
        encolado = queue.encolados[0]
        assert encolado["id_venta"] == 1
        assert encolado["usuario"] == "dev@example.com"
        assert encolado["motivo"] == "sin traza"
        assert encolado["correlation_id"] == "C-1"
        assert encolado["token"] == token_fila(TOKEN, 1)

    def test_una_nota_usa_el_generador_de_nc_nd(self) -> None:
        queue = _Queue()

        out = encolar_reenvio(
            _Reader([_fila(tipo="07")]),
            queue,
            ids=[1],
            usuario="dev@example.com",
            motivo="nota mal emitida",
            now=AHORA,
        )

        assert out["detalle"][0]["tipo"] == "07"
        assert out["detalle"][0]["procedimiento"] == "SPPUFE_UBL21_NCND"

    def test_un_pendiente_se_rechaza_sin_tocar_la_cola(self) -> None:
        queue = _Queue()

        out = encolar_reenvio(
            _Reader([_fila(estatus="PENDIENTE")]),
            queue,
            ids=[1],
            usuario="dev@example.com",
            motivo="sin traza",
            now=AHORA,
        )

        assert out["encolados"] == 0
        assert out["detalle"][0]["estado"] == "rechazado"
        assert "concluido" in out["detalle"][0]["motivo"]
        assert queue.encolados == []

    def test_un_documento_en_proceso_se_rechaza(self) -> None:
        out = encolar_reenvio(
            _Reader([_fila(log_id=9, estado="PROCESANDO", etapa="PROCESANDO")]),
            _Queue(),
            ids=[1],
            usuario="dev@example.com",
            motivo="sin traza",
            now=AHORA,
        )

        assert out["encolados"] == 0
        assert "trabajando" in out["detalle"][0]["motivo"]

    def test_ya_generado_solo_con_forzar(self) -> None:
        reader = _Reader(
            [_fila(log_id=9, estado="OK", etapa="FINALIZADO", documento="602-00142702")]
        )
        queue = _Queue()

        rechazado = encolar_reenvio(
            reader,
            queue,
            ids=[1],
            usuario="dev@example.com",
            motivo="reemitir",
            now=AHORA,
        )
        forzado = encolar_reenvio(
            reader,
            queue,
            ids=[1],
            usuario="dev@example.com",
            motivo="reemitir",
            forzar=True,
            now=AHORA,
        )

        assert rechazado["encolados"] == 0
        assert "forzar" in rechazado["detalle"][0]["motivo"]
        assert forzado["encolados"] == 1

    def test_la_nc_sobre_se_no_pasa_por_el_generador(self) -> None:
        out = encolar_reenvio(
            _Reader([_fila(tipo="07", referencia="SE-Boleta 104-00038062")]),
            _Queue(),
            ids=[1],
            usuario="dev@example.com",
            motivo="reemitir",
            forzar=True,
            now=AHORA,
        )

        assert out["encolados"] == 0
        assert "SynerPOS" in out["detalle"][0]["motivo"]

    def test_un_documento_inexistente_se_rechaza(self) -> None:
        out = encolar_reenvio(
            _Reader([]),
            _Queue(),
            ids=[404],
            usuario="dev@example.com",
            motivo="sin traza",
            now=AHORA,
        )

        assert out["detalle"][0]["motivo"] == "Comprobante no encontrado."

    def test_si_la_cola_tiene_una_solicitud_activa_se_avisa(self) -> None:
        out = encolar_reenvio(
            _Reader([_fila()]),
            _Queue(vivos={1}),
            ids=[1],
            usuario="dev@example.com",
            motivo="sin traza",
            now=AHORA,
        )

        assert out["encolados"] == 0
        assert "#9" in out["detalle"][0]["motivo"]

    def test_un_reintento_con_el_mismo_token_no_duplica(self) -> None:
        queue = _Queue(duplicados={1})

        out = encolar_reenvio(
            _Reader([_fila()]),
            queue,
            ids=[1],
            usuario="dev@example.com",
            motivo="sin traza",
            token=TOKEN,
            now=AHORA,
        )

        assert out["encolados"] == 0
        assert out["duplicados"] == 1
        assert out["rechazados"] == 0
        assert out["encolados"] + out["duplicados"] + out["rechazados"] == out["total"]
        assert out["detalle"][0]["estado"] == "ya_registrado"
        assert out["detalle"][0]["queue_id"] == 99
        assert queue.encolados == []

    def test_el_token_es_determinista_entre_reintentos(self) -> None:
        queue = _Queue()
        reader = _Reader([_fila()])

        encolar_reenvio(
            reader, queue, ids=[1], usuario="dev@example.com",
            motivo="sin traza", token=TOKEN, now=AHORA,
        )
        encolar_reenvio(
            reader, queue, ids=[1], usuario="dev@example.com",
            motivo="sin traza", token=TOKEN, now=AHORA,
        )

        assert queue.encolados[0]["token"] == queue.encolados[1]["token"]

    def test_sin_token_la_solicitud_genera_uno(self) -> None:
        queue = _Queue()

        encolar_reenvio(
            _Reader([_fila()]),
            queue,
            ids=[1],
            usuario="dev@example.com",
            motivo="sin traza",
            token="",
            now=AHORA,
        )

        assert len(queue.encolados[0]["token"]) == 32

    def test_un_token_invalido_es_error_de_solicitud(self) -> None:
        with pytest.raises(ValueError, match="Token"):
            encolar_reenvio(
                _Reader([_fila()]),
                _Queue(),
                ids=[1],
                usuario="dev@example.com",
                motivo="sin traza",
                token="no-es-un-token",
                now=AHORA,
            )

    def test_un_lote_no_es_atomico(self) -> None:
        reader = _Reader(
            [_fila(id_venta=1), _fila(id_venta=2, estatus="PENDIENTE")]
        )

        out = encolar_reenvio(
            reader,
            _Queue(),
            ids=[1, 2],
            usuario="dev@example.com",
            motivo="sin traza",
            now=AHORA,
        )

        assert out["total"] == 2
        assert out["encolados"] == 1
        assert out["rechazados"] == 1
        assert [item["estado"] for item in out["detalle"]] == [
            "encolado",
            "rechazado",
        ]

    def test_exige_usuario(self) -> None:
        with pytest.raises(ValueError, match="usuario"):
            encolar_reenvio(
                _Reader([_fila()]),
                _Queue(),
                ids=[1],
                usuario="  ",
                motivo="sin traza",
                now=AHORA,
            )

    def test_exige_motivo(self) -> None:
        with pytest.raises(ValueError, match="motivo"):
            encolar_reenvio(
                _Reader([_fila()]),
                _Queue(),
                ids=[1],
                usuario="dev@example.com",
                motivo="   ",
                now=AHORA,
            )

    def test_respeta_el_tope_de_lote(self) -> None:
        with pytest.raises(ValueError, match="maximo"):
            encolar_reenvio(
                _Reader([_fila()]),
                _Queue(),
                ids=[1, 2],
                usuario="dev@example.com",
                motivo="sin traza",
                max_batch=1,
                now=AHORA,
            )


class TestListar:
    def test_normaliza_el_filtro_y_acota_el_limite(self) -> None:
        queue = _Queue()

        out = listar_reenvios(queue, limit=9999, estado=" en_cola ")

        assert queue.filtro == (200, "EN_COLA")
        assert out["pendientes"] == 1
        assert out["resumen"] == {"EN_COLA": 1}

    def test_un_estado_desconocido_es_invalido(self) -> None:
        with pytest.raises(ValueError, match="Estado"):
            listar_reenvios(_Queue(), estado="MAGIA")

    def test_el_panel_trae_el_heartbeat_del_worker(self) -> None:
        out = listar_reenvios(_Queue(), limit=5)

        assert out["worker"]["Estado"] == "EN_ESPERA"
        assert out["activos"] and out["historial"]


class TestResolver:
    def test_cierra_el_caso_con_nota(self) -> None:
        queue = _Queue()

        out = resolver_reenvio(
            queue, queue_id=5, actor="dev@example.com", nota=" revisado "
        )

        assert out["queue_id"] == 5
        assert out["estado"] == "REVISADO_MANUAL"
        assert out["mensaje"] == "Revision registrada."
        assert queue.resueltos[0]["nota"] == "revisado"

    def test_sin_nota_no_hay_resolucion(self) -> None:
        with pytest.raises(ValueError, match="nota"):
            resolver_reenvio(_Queue(), queue_id=5, actor="dev@example.com", nota="")

    def test_sin_actor_no_hay_resolucion(self) -> None:
        with pytest.raises(ValueError, match="usuario"):
            resolver_reenvio(_Queue(), queue_id=5, actor="", nota="ok")

    def test_un_id_invalido_es_error_de_solicitud(self) -> None:
        with pytest.raises(ValueError, match="Identificador"):
            resolver_reenvio(_Queue(), queue_id=0, actor="dev", nota="ok")

    def test_si_no_estaba_no_confirmado_es_404(self) -> None:
        class _QueueSinPendiente(_Queue):
            def resolver(self, queue_id, *, actor, nota):
                raise NotFoundError("no esta")

        with pytest.raises(NotFoundError):
            resolver_reenvio(
                _QueueSinPendiente(), queue_id=5, actor="dev@example.com", nota="ok"
            )
