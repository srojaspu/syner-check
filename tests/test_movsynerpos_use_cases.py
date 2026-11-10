"""F3: caso de uso de reenvío manual a dbo.MovSynerPos (sin red ni DB)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.application.movsynerpos import (
    ESTADO_CONFLICTO,
    ESTADO_ERROR,
    ESTADO_INSERTADO,
    ESTADO_REPARADO,
    ESTADO_SIN_CAMBIOS,
    _error_message,
    send_movsynerpos,
)
from src.domain.errors import UpstreamError

FIXTURES = Path(__file__).parent / "fixtures" / "movsynerpos"


def load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


BOLETA = load("boleta.json")
FACTURA = load("factura.json")
NOTA = load("nota_credito.json")

PAYLOAD_BOLETA = {
    "tipo": "BOLETA",
    "oid": BOLETA["oid"],
    "number": BOLETA["number"],
    "date": BOLETA["date"],
}


class FakeGateway:
    def __init__(self, docs: list[dict]):
        self.docs = docs
        self.calls: list[tuple] = []

    def detail(self, tipo, start_iso, end_iso, number=None):
        self.calls.append(("detail", tipo, start_iso, end_iso, number))
        return [doc for doc in self.docs if doc.get("_tipo") == tipo]

    def detail_by_serie(self, tipo, number):
        self.calls.append(("detail_by_serie", tipo, number))
        return [doc for doc in self.docs if doc.get("_tipo") == tipo]


class FakeWriter:
    def __init__(self, existing=None, conflicts=None, fail=False, lines=None):
        self.existing = existing or {}
        self.conflicts = conflicts or {}
        self.fail = fail
        self.lines = lines or {}
        self.inserted: list[dict] = []
        self.conflict_calls: list[tuple] = []

    def existing_lines(self, oid, tipo):
        return dict(self.existing)

    def serie_conflicts(self, tipo, serie, idxs):
        self.conflict_calls.append((tipo, serie, list(idxs)))
        return {
            idx: owner for idx, owner in self.conflicts.items() if idx in set(idxs)
        }

    def document_lines(self, oid, tipo):
        return [dict(row) for row in self.lines.get(oid, [])]

    def insert_lines(self, documento, lineas):
        if self.fail:
            raise UpstreamError("insert failed")
        rows = [dict(line) for line in lineas]
        self.inserted.extend(rows)
        return len(rows)


def gateway_with(*docs: dict, tipo: str = "BOLETA") -> FakeGateway:
    return FakeGateway([{**doc, "_tipo": tipo} for doc in docs])


def test_new_document_is_inserted_with_all_lines() -> None:
    writer = FakeWriter()
    result = send_movsynerpos(
        gateway_with(BOLETA),
        writer,
        documentos=[PAYLOAD_BOLETA],
        correlation_id="corr-1",
    )

    assert result["total"] == 1
    assert result["insertados"] == 1
    assert result["detalle"][0]["estado"] == ESTADO_INSERTADO
    assert result["detalle"][0]["lineas_insertadas"] == 2
    assert result["detalle"][0]["lineas_faltantes"] == 2
    assert result["solicitud_id"] == "corr-1"
    assert len(writer.inserted) == 2
    assert writer.inserted[0]["CrossTotal"].__str__().startswith("120.5")


def test_duplicate_number_inserts_the_selected_oid() -> None:
    """B004-00000696: dos copias con oid distinto; se inserta la elegida."""
    older = {
        **BOLETA,
        "oid": "14257.10649",
        "number": "B004-00000696",
        "date": "2025-05-13",
    }
    newer = {
        **BOLETA,
        "oid": "14257.53162",
        "number": "B004-00000696",
        "date": "2026-09-17",
    }
    writer = FakeWriter()
    result = send_movsynerpos(
        gateway_with(older, newer),
        writer,
        documentos=[
            {
                "tipo": "BOLETA",
                "oid": "14257.10649",
                "number": "B004-00000696",
                "date": "2025-05-13",
            }
        ],
    )

    assert result["insertados"] == 1
    assert all(line["IDSynerPos"] == "14257.10649" for line in writer.inserted)
    assert all(line["SerieNumero"] == "B004-00000696" for line in writer.inserted)


def test_client_amounts_and_lines_are_ignored() -> None:
    """El backend re-consulta: nada de lo que mande el navegador se escribe."""
    writer = FakeWriter()
    payload = {**PAYLOAD_BOLETA, "crossTotal": 999999, "items": [{"idx": 9}]}
    send_movsynerpos(gateway_with(BOLETA), writer, documentos=[payload])

    assert len(writer.inserted) == 2
    assert str(writer.inserted[0]["CrossTotal"]) == "120.5000"
    assert writer.inserted[0]["NombreCliente"] == "CLIENTE PRUEBA"


def test_existing_complete_document_is_sin_cambios() -> None:
    writer = FakeWriter(
        existing={1: BOLETA["number"], 2: BOLETA["number"]}
    )
    result = send_movsynerpos(
        gateway_with(BOLETA), writer, documentos=[PAYLOAD_BOLETA]
    )

    assert result["sin_cambios"] == 1
    assert result["detalle"][0]["lineas_existentes"] == 2
    assert result["detalle"][0]["lineas_faltantes"] == 0
    assert writer.inserted == []
    assert writer.conflict_calls == []


def test_partial_without_reparar_does_not_insert() -> None:
    writer = FakeWriter(existing={1: BOLETA["number"]})
    result = send_movsynerpos(
        gateway_with(BOLETA), writer, documentos=[PAYLOAD_BOLETA]
    )

    assert result["detalle"][0]["estado"] == ESTADO_SIN_CAMBIOS
    assert result["detalle"][0]["lineas_faltantes"] == 1
    assert writer.inserted == []


def test_partial_with_reparar_inserts_only_missing_lines() -> None:
    writer = FakeWriter(existing={1: BOLETA["number"]})
    result = send_movsynerpos(
        gateway_with(BOLETA),
        writer,
        documentos=[PAYLOAD_BOLETA],
        reparar=True,
    )

    assert result["reparados"] == 1
    assert result["detalle"][0]["estado"] == ESTADO_REPARADO
    assert result["detalle"][0]["lineas_insertadas"] == 1
    assert [line["Idx"] for line in writer.inserted] == [2]
    assert writer.conflict_calls[0][2] == [2]


def test_existing_line_with_other_serie_is_conflict() -> None:
    writer = FakeWriter(existing={1: "OTRA-SERIE"})
    result = send_movsynerpos(
        gateway_with(BOLETA), writer, documentos=[PAYLOAD_BOLETA]
    )

    assert result["conflictos"] == 1
    assert result["detalle"][0]["estado"] == ESTADO_CONFLICTO
    assert writer.inserted == []


def test_line_owned_by_another_oid_is_conflict() -> None:
    writer = FakeWriter(conflicts={1: "otro-oid"})
    result = send_movsynerpos(
        gateway_with(BOLETA), writer, documentos=[PAYLOAD_BOLETA]
    )

    assert result["detalle"][0]["estado"] == ESTADO_CONFLICTO
    assert writer.inserted == []


def _linea_conflicto(idx: int, cross_total: str) -> dict:
    return {
        "SerieNumero": BOLETA["number"],
        "FechaDocumento": BOLETA["date"],
        "Idx": idx,
        "Sku": f"SKU-{idx}",
        "Cantidad": 1,
        "CrossTotal": cross_total,
    }


def test_conflict_reports_identity_of_the_registered_document() -> None:
    writer = FakeWriter(
        conflicts={1: "14257.000001"},
        lines={
            "14257.000001": [
                _linea_conflicto(1, "120.5000"),
                _linea_conflicto(2, "10.0000"),
            ]
        },
    )
    result = send_movsynerpos(
        gateway_with(BOLETA), writer, documentos=[PAYLOAD_BOLETA]
    )

    assert result["detalle"][0]["conflictos"] == [
        {
            "oid": "14257.000001",
            "number": BOLETA["number"],
            "lineas": 2,
            "total": "130.5000",
            "fecha": BOLETA["date"],
        }
    ]


def test_conflict_reports_the_serie_registered_for_the_same_oid() -> None:
    writer = FakeWriter(
        existing={1: "BS99-00000001"},
        lines={
            BOLETA["oid"]: [
                {
                    "SerieNumero": "BS99-00000001",
                    "FechaDocumento": BOLETA["date"],
                    "Idx": 1,
                    "Sku": "SKU-1",
                    "Cantidad": 1,
                    "CrossTotal": "120.5000",
                }
            ]
        },
    )
    result = send_movsynerpos(
        gateway_with(BOLETA), writer, documentos=[PAYLOAD_BOLETA]
    )

    conflicto = result["detalle"][0]["conflictos"][0]
    assert conflicto["oid"] == BOLETA["oid"]
    assert conflicto["number"] == "BS99-00000001"
    assert conflicto["lineas"] == 1


def test_conflict_snapshot_failure_keeps_minimal_identity() -> None:
    class BrokenLinesWriter(FakeWriter):
        def document_lines(self, oid, tipo):
            raise UpstreamError("snapshot failed")

    writer = BrokenLinesWriter(conflicts={1: "otro-oid"})
    result = send_movsynerpos(
        gateway_with(BOLETA), writer, documentos=[PAYLOAD_BOLETA]
    )

    # El fallo al leer el snapshot no oculta el conflicto ni rompe el lote.
    assert result["detalle"][0]["estado"] == ESTADO_CONFLICTO
    assert result["detalle"][0]["conflictos"] == [
        {
            "oid": "otro-oid",
            "number": BOLETA["number"],
            "lineas": 0,
            "total": None,
            "fecha": "",
        }
    ]


def test_serie_conflict_from_same_oid_does_not_block_insert() -> None:
    writer = FakeWriter(conflicts={1: BOLETA["oid"]})
    result = send_movsynerpos(
        gateway_with(BOLETA), writer, documentos=[PAYLOAD_BOLETA]
    )

    assert result["insertados"] == 1
    assert len(writer.inserted) == 2


def test_one_failing_document_does_not_abort_the_batch() -> None:
    writer = FakeWriter()
    payload_factura = {
        "tipo": "FACTURA",
        "oid": "no-existe",
        "number": "F001-99999999",
        "date": "2026-10-20",
    }
    result = send_movsynerpos(
        gateway_with(BOLETA),
        writer,
        documentos=[payload_factura, PAYLOAD_BOLETA],
    )

    assert result["total"] == 2
    assert result["errores"] == 1
    assert result["insertados"] == 1
    assert result["detalle"][0]["estado"] == ESTADO_ERROR
    assert result["detalle"][0]["error"] == "Documento no encontrado en SynerCom."
    assert result["detalle"][1]["estado"] == ESTADO_INSERTADO


def test_writer_failure_is_reported_as_error() -> None:
    writer = FakeWriter(fail=True)
    result = send_movsynerpos(
        gateway_with(BOLETA), writer, documentos=[PAYLOAD_BOLETA]
    )

    assert result["errores"] == 1
    assert result["detalle"][0]["estado"] == ESTADO_ERROR
    assert "SynerPOS" in result["detalle"][0]["error"]


def test_detail_without_items_is_error_not_crash() -> None:
    broken = {**BOLETA, "items": []}
    writer = FakeWriter()
    result = send_movsynerpos(
        gateway_with(broken), writer, documentos=[PAYLOAD_BOLETA]
    )

    assert result["errores"] == 1
    assert "líneas" in result["detalle"][0]["error"]


def test_note_credit_uses_its_own_payment_case() -> None:
    writer = FakeWriter()
    payload = {
        "tipo": "NOTA DE CREDITO",
        "oid": NOTA["oid"],
        "number": NOTA["number"],
        "date": NOTA["date"],
    }
    result = send_movsynerpos(
        gateway_with(NOTA, tipo="NOTA DE CREDITO"), writer, documentos=[payload]
    )

    assert result["insertados"] == 1
    assert writer.inserted[0]["CardProvider1"] == "Nota Credito"
    assert writer.inserted[0]["RefNC"] == "B004-00001234"


@pytest.mark.parametrize(
    "documentos",
    [
        [],
        "no-es-lista",
        [{"tipo": "GUIA", "oid": "x", "date": "2026-10-20"}],
        [{"tipo": "BOLETA", "oid": "", "date": "2026-10-20"}],
        [{"tipo": "BOLETA", "oid": "x", "date": "2026-13-01"}],
        [{"tipo": "BOLETA", "oid": "x", "date": ""}],
    ],
)
def test_invalid_requests_raise_value_error(documentos) -> None:
    with pytest.raises(ValueError):
        send_movsynerpos(
            gateway_with(BOLETA), FakeWriter(), documentos=documentos
        )


def test_more_than_25_documents_is_rejected() -> None:
    documentos = [
        {**PAYLOAD_BOLETA, "oid": f"oid-{index}"} for index in range(26)
    ]
    with pytest.raises(ValueError):
        send_movsynerpos(
            gateway_with(BOLETA), FakeWriter(), documentos=documentos
        )


def test_generated_correlation_id_is_returned_when_missing() -> None:
    result = send_movsynerpos(
        gateway_with(BOLETA), FakeWriter(), documentos=[PAYLOAD_BOLETA]
    )
    assert result["solicitud_id"]
    assert len(result["solicitud_id"]) >= 32


def test_duplicate_serie_with_broken_draft_inserts_only_the_valid_oid() -> None:
    """Caso real BS32-00005040: borradores con error GraphQL en lote no bloquean al OID válido."""
    broken_draft = {
        **BOLETA,
        "oid": "14257.634569",
        "number": "BS32-00005040",
        "_graphql_errors": ["items/0/lote"],
    }
    valid_doc = {
        **BOLETA,
        "oid": "14257.634657",
        "number": "BS32-00005040",
    }
    writer = FakeWriter()
    result = send_movsynerpos(
        gateway_with(broken_draft, valid_doc),
        writer,
        documentos=[
            {
                "tipo": "BOLETA",
                "oid": "14257.634569",
                "number": "BS32-00005040",
                "date": BOLETA["date"],
            },
            {
                "tipo": "BOLETA",
                "oid": "14257.634657",
                "number": "BS32-00005040",
                "date": BOLETA["date"],
            },
        ],
    )

    assert result["errores"] == 1
    assert result["insertados"] == 1
    assert result["detalle"][0]["estado"] == ESTADO_ERROR
    assert "incompleto en SynerCom" in result["detalle"][0]["error"]
    assert result["detalle"][1]["estado"] == ESTADO_INSERTADO
    assert all(line["IDSynerPos"] == "14257.634657" for line in writer.inserted)



def test_two_threads_do_not_duplicate_lines() -> None:
    """El lock por (tipo, oid) cubre verificación + inserción."""
    import threading
    import time
    from concurrent.futures import ThreadPoolExecutor

    class SlowWriter(FakeWriter):
        def __init__(self):
            super().__init__()
            self.rows: dict[int, str] = {}
            self.guard = threading.Lock()

        def existing_lines(self, oid, tipo):
            with self.guard:
                return dict(self.rows)

        def insert_lines(self, documento, lineas):
            time.sleep(0.05)  # widen the race window
            with self.guard:
                for line in lineas:
                    self.rows[int(line["Idx"])] = str(line["SerieNumero"])
            return len(lineas)

    writer = SlowWriter()
    gateway = gateway_with(BOLETA)

    def send():
        return send_movsynerpos(
            gateway, writer, documentos=[PAYLOAD_BOLETA], correlation_id="corr-lock"
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: send(), range(2)))

    states = sorted(result["detalle"][0]["estado"] for result in results)
    assert states == [ESTADO_INSERTADO, ESTADO_SIN_CAMBIOS]
    assert sorted(writer.rows) == [1, 2]


def test_document_logs_have_ids_but_no_pii(caplog) -> None:
    import logging

    with caplog.at_level(logging.INFO, logger="syner_check.movsynerpos"):
        send_movsynerpos(
            gateway_with(BOLETA),
            FakeWriter(),
            documentos=[PAYLOAD_BOLETA],
            correlation_id="corr-log",
        )

    doc_logs = [
        record.getMessage()
        for record in caplog.records
        if "MovSynerPos doc" in record.getMessage()
    ]
    assert doc_logs
    message = doc_logs[0]
    assert "correlation_id=corr-log" in message
    assert "tipo=BOLETA" in message
    assert f"oid={BOLETA['oid']}" in message
    assert f"number={BOLETA['number']}" in message
    assert "estado=insertado" in message
    for forbidden in ("CLIENTE PRUEBA", "cliente@example.test", "120.5"):
        assert forbidden not in message


def test_error_message_surfaces_the_safe_public_cause() -> None:
    exc = UpstreamError(
        "MovSynerPos insert failed: ProgrammingError.",
        code="permission",
        public_message=(
            "El login de escritura no tiene permiso INSERT sobre la tabla."
        ),
    )
    assert _error_message(exc) == (
        "El login de escritura no tiene permiso INSERT sobre la tabla."
    )


def test_error_message_keeps_generic_text_when_no_public_cause() -> None:
    assert _error_message(UpstreamError("socket cerrado")) == (
        "No fue posible consultar o escribir en SynerPOS."
    )
