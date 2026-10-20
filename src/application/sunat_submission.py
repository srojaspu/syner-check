"""Live progress for asynchronous SUNAT batch submissions.

The SUNAT validator accepts a batch quickly and works asynchronously. The
web request that starts a batch must therefore return immediately; otherwise
the browser timeout hides the real progress and the user sees a stuck screen.
This registry is the small, in-process projection the UI polls while the
submission thread is running.

It is intentionally not the source of truth: ``SunatValidacion`` and the
reconcile worker remain authoritative. The state is ephemeral, which is fine
for the single-instance deployment; after a restart the worker still closes
every job that reached SUNAT.
"""

from __future__ import annotations

import hashlib
import json
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

TERMINAL_STATES = frozenset({"COMPLETADO", "ERROR"})


def _empty_omitidos() -> dict[str, Any]:
    return {
        "aceptados": 0,
        "en_proceso": 0,
        "sin_confirmar": 0,
        "invalidos": [],
    }


def submission_fingerprint(
    documentos: list[dict[str, Any]], alcance: str = "no_aceptados"
) -> str:
    """Stable identity for an explicit batch (scope + type + number + date).

    The fingerprint only suppresses a double click while the same batch is
    active. It is not used to skip cache checks or to decide what to submit.
    The scope is part of the identity: a running "no aceptados" submission
    must not be reused when the user confirms "todos".
    """
    items: list[tuple[str, str, str]] = []
    for item in documentos:
        if not isinstance(item, dict):
            continue
        items.append(
            (
                str(item.get("tipo", "")).strip().upper(),
                str(item.get("number", "")).strip().upper(),
                str(item.get("date", "")).strip()[:10],
            )
        )
    items.sort()
    raw = json.dumps(
        {"alcance": str(alcance or "no_aceptados"), "items": items},
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now()


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds")


@dataclass
class SunatSubmission:
    """Mutable progress snapshot for one explicit validation request."""

    id: str
    fingerprint: str
    usuario: str
    total: int
    alcance: str = "no_aceptados"
    estado: str = "EN_COLA"
    fase: str = "preparando"
    mensaje: str = "Preparando validación…"
    por_enviar: int = 0
    chunks_total: int = 0
    chunks_done: int = 0
    enviados: int = 0
    omitidos: dict[str, Any] = field(default_factory=_empty_omitidos)
    trabajos: list[dict[str, Any]] = field(default_factory=list)
    errores: list[dict[str, Any]] = field(default_factory=list)
    iniciado_en: datetime = field(default_factory=_now)
    actualizado_en: datetime = field(default_factory=_now)

    def porcentaje(self) -> float:
        # Documents are the user-facing unit: "50 de 167 enviados". The chunk
        # counter alone made the bar disagree with that label.
        if self.estado == "COMPLETADO":
            value = 100.0
        elif self.por_enviar > 0:
            value = (self.enviados / self.por_enviar) * 100.0
        elif self.chunks_total > 0:
            value = (self.chunks_done / self.chunks_total) * 100.0
        else:
            value = 0.0
        return round(min(100.0, max(0.0, value)), 1)

    def as_dict(self) -> dict[str, Any]:
        return {
            "solicitud_id": self.id,
            "estado": self.estado,
            "fase": self.fase,
            "mensaje": self.mensaje,
            "total": self.total,
            "alcance": self.alcance,
            "por_enviar": self.por_enviar,
            "chunks_total": self.chunks_total,
            "chunks_done": self.chunks_done,
            "enviados": self.enviados,
            "omitidos": self.omitidos,
            "trabajos": list(self.trabajos),
            "errores": list(self.errores),
            "porcentaje": self.porcentaje(),
            "iniciado_en": _iso(self.iniciado_en),
            "actualizado_en": _iso(self.actualizado_en),
        }


class SunatSubmissionRegistry:
    """Thread-safe registry of live submissions (one web process)."""

    def __init__(self, retention_minutes: int = 120) -> None:
        self._lock = threading.Lock()
        self._items: dict[str, SunatSubmission] = {}
        self._retention = timedelta(minutes=max(1, int(retention_minutes)))

    def create(
        self,
        *,
        usuario: str,
        total: int,
        fingerprint: str,
        alcance: str = "no_aceptados",
    ) -> tuple[SunatSubmission, bool]:
        """Return ``(submission, reused)``.

        An active submission for the same user and same document set is
        reused, so a double click cannot split one batch into two progress
        trackers.
        """
        with self._lock:
            self._prune_locked()
            for item in self._items.values():
                if (
                    item.usuario == usuario
                    and item.fingerprint == fingerprint
                    and item.estado not in TERMINAL_STATES
                ):
                    return item, True
            item = SunatSubmission(
                id=uuid.uuid4().hex,
                fingerprint=fingerprint,
                usuario=usuario,
                total=max(0, int(total)),
                alcance=str(alcance or "no_aceptados"),
            )
            self._items[item.id] = item
            return item, False

    def get(
        self, solicitud_id: str, *, usuario: str | None = None
    ) -> SunatSubmission | None:
        with self._lock:
            self._prune_locked()
            item = self._items.get(str(solicitud_id))
            if item is None:
                return None
            if usuario and item.usuario and item.usuario != usuario:
                return None
            return item

    def snapshot(
        self, solicitud_id: str, *, usuario: str | None = None
    ) -> dict[str, Any] | None:
        """Return a consistent copy of the current state."""
        with self._lock:
            self._prune_locked()
            item = self._items.get(str(solicitud_id))
            if item is None:
                return None
            if usuario and item.usuario and item.usuario != usuario:
                return None
            return item.as_dict()

    def start(self, solicitud_id: str) -> None:
        with self._lock:
            item = self._items.get(str(solicitud_id))
            if item is None or item.estado in TERMINAL_STATES:
                return
            item.estado = "EN_PROCESO"
            item.fase = "preparando"
            item.mensaje = "Preparando validación…"
            item.actualizado_en = _now()

    def progress(self, solicitud_id: str, payload: dict[str, Any]) -> None:
        """Merge a progress update emitted by the submission thread."""
        with self._lock:
            item = self._items.get(str(solicitud_id))
            if item is None or item.estado in TERMINAL_STATES:
                return
            item.estado = "EN_PROCESO"
            if payload.get("fase"):
                item.fase = str(payload["fase"])
            if payload.get("mensaje"):
                item.mensaje = str(payload["mensaje"])
            for key in (
                "total",
                "por_enviar",
                "chunks_total",
                "chunks_done",
                "enviados",
            ):
                if key in payload:
                    try:
                        setattr(item, key, max(0, int(payload[key])))
                    except (TypeError, ValueError):
                        continue
            if isinstance(payload.get("omitidos"), dict):
                item.omitidos = dict(payload["omitidos"])
            if isinstance(payload.get("trabajos"), list):
                item.trabajos = list(payload["trabajos"])
            if isinstance(payload.get("errores"), list):
                item.errores = list(payload["errores"])
            item.actualizado_en = _now()

    def complete(self, solicitud_id: str, result: dict[str, Any]) -> None:
        with self._lock:
            item = self._items.get(str(solicitud_id))
            if item is None:
                return
            trabajos = result.get("trabajos") or []
            errores = result.get("errores") or []
            item.total = max(0, int(result.get("total") or item.total))
            item.por_enviar = max(
                0, int(result.get("por_enviar") or item.por_enviar)
            )
            item.enviados = max(0, int(result.get("enviados") or 0))
            item.omitidos = (
                dict(result.get("omitidos") or {})
                if isinstance(result.get("omitidos"), dict)
                else item.omitidos
            )
            item.trabajos = list(trabajos)
            item.errores = list(errores)
            item.fase = "finalizando"
            if errores and not trabajos:
                item.estado = "ERROR"
                first_message = (
                    errores[0].get("mensaje")
                    if isinstance(errores[0], dict)
                    else ""
                )
                item.mensaje = str(
                    first_message
                    or (
                        "No se pudo enviar el lote. Revisa el detalle e "
                        "inténtalo de nuevo."
                    )
                )
            else:
                item.estado = "COMPLETADO"
                item.chunks_done = item.chunks_total
                if trabajos:
                    item.mensaje = "Lotes enviados. Consultando SUNAT…"
                elif item.omitidos.get("aceptados"):
                    aceptados = int(item.omitidos.get("aceptados") or 0)
                    if item.alcance == "todos":
                        item.mensaje = (
                            f"{aceptados} documento(s) ya estaban ACEPTADOS y "
                            "no se pudieron reconsultar."
                        )
                    else:
                        # The user asked to validate but the default scope
                        # skipped accepted vouchers. Say how to force them.
                        item.mensaje = (
                            f"{aceptados} documento(s) ya estaban ACEPTADOS. "
                            "Elige «Todos» para volver a consultarlos en SUNAT."
                        )
                else:
                    item.mensaje = "No había documentos nuevos para enviar."
            item.actualizado_en = _now()

    def fail(
        self,
        solicitud_id: str,
        message: str,
        *,
        errores: list[dict[str, Any]] | None = None,
    ) -> None:
        with self._lock:
            item = self._items.get(str(solicitud_id))
            if item is None:
                return
            item.estado = "ERROR"
            item.fase = "finalizando"
            item.mensaje = message
            if errores:
                item.errores = list(errores)
            item.actualizado_en = _now()

    def _prune_locked(self) -> None:
        cutoff = _now() - self._retention
        stale = [
            key
            for key, item in self._items.items()
            if item.actualizado_en < cutoff
        ]
        for key in stale:
            del self._items[key]

    def clear(self) -> None:
        """Test helper: drop every tracked submission."""
        with self._lock:
            self._items.clear()

    def __len__(self) -> int:
        with self._lock:
            self._prune_locked()
            return len(self._items)
