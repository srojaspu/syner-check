"""Diagnóstico read-only del destino del writer de MovSynerPos.

Ejecutar **dentro del host/contenedor de la app** (donde viven las variables
``DB_*``, ``TABLE_NAME`` y el driver ODBC de SQL Server), no en otra máquina:
el objetivo es ver exactamente lo que ve el proceso que falla.

Uso::

    python scripts/check_movsynerpos.py

Responde, sin escribir nada:

* qué tabla resuelve ``TABLE_NAME`` (producción vs QA);
* si esa tabla existe;
* qué columnas del contrato del writer faltan;
* qué login usa la app y si tiene ``INSERT`` sobre la tabla;
* si el kill switch de escritura está activo.

Nunca imprime contraseñas, cadenas de conexión ni valores de filas. Códigos de
salida: ``0`` destino sano, ``1`` destino con problemas, ``2`` no se pudo
diagnosticar (config incompleta o conexión fallida).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    from src.infrastructure.movsynerpos import MovSynerPosWriterAdapter
    from syner_check import config

    target = config.get_movsynerpos_target()
    if target is None:
        print(
            json.dumps(
                {
                    "error": (
                        "TABLE_NAME no resuelve a una tabla válida. Revisa "
                        "TABLE_NAME, DB_HOST, DB_NAME y DB_USER."
                    )
                },
                indent=2,
                ensure_ascii=False,
            )
        )
        return 2

    try:
        report = MovSynerPosWriterAdapter().diagnose()
    except Exception as exc:  # noqa: BLE001 - el script no debe explotar
        print(
            json.dumps(
                {
                    "target": target,
                    "error": "No se pudo abrir la conexión de diagnóstico.",
                    "error_class": type(exc).__name__,
                    "hint": (
                        "Verifica DB_HOST, DB_NAME, DB_USER, DB_USER_PASSWORD "
                        "y el driver ODBC en este host."
                    ),
                },
                indent=2,
                ensure_ascii=False,
            )
        )
        return 2

    report["write_enabled"] = config.movsynerpos_enabled()
    print(json.dumps(report, indent=2, ensure_ascii=False, default=str))

    missing = report.get("missing_columns") or []
    problems = (
        report.get("exists") is False
        or report.get("can_insert") in (0, False)
        or bool(missing)
        or bool(report.get("error"))
    )
    if problems:
        print(
            "\nDestino con problemas: corrige lo anterior (tabla/columnas/"
            "GRANT INSERT) antes de reenviar.",
            file=sys.stderr,
        )
        return 1

    print("\nDestino OK: tabla, columnas y permiso INSERT correctos.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
