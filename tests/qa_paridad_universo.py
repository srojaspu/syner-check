"""QA de paridad del universo: nuestra copia de PUSP_ControlFac vs el SP.

Ejecuta ``qa/paridad_pusp_controlfac.sql`` (que el DBA tambien puede
correr en SSMS con el login de lectura) y resume el resultado.

Uso (manual, no es parte del CI):

    .venv\\Scripts\\python.exe -m tests.qa_paridad_universo
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("AUTH_MODE", "development")
os.environ.setdefault("SESSION_SECRET", "qa-secret-" + "x" * 32)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(r"C:\Projects\PYTHON\syner-check-web\.env")

import pyodbc  # noqa: E402

from syner_check.config import (  # noqa: E402
    get_intelisis_config,
    get_intelisis_password,
)
from syner_check.db_client import build_connection_string  # noqa: E402

SCRIPT = (
    Path(__file__).resolve().parent.parent
    / "qa"
    / "paridad_pusp_controlfac.sql"
)


def main() -> None:
    sql = SCRIPT.read_text(encoding="utf-8")
    conexion = pyodbc.connect(
        build_connection_string(get_intelisis_config(), get_intelisis_password())
    )
    cursor = conexion.cursor()
    cursor.execute(sql)
    print("=== Paridad del universo: nuestra copia vs dbo.PUSP_ControlFac ===")
    dias = total_sp = total_nues = 0
    diferencias = 0
    for fila in cursor.fetchall():
        dias += 1
        total_sp += int(fila[3])
        total_nues += int(fila[4])
        diferencias += int(fila[5]) + int(fila[6])
        print(
            f"  {fila[0]}  ej={fila[1]} per={fila[2]}  "
            f"SP={fila[3]:>4}  nuestro={fila[4]:>4}  "
            f"solo_sp={fila[5]}  solo_nuestro={fila[6]}  -> {fila[7]}"
        )
    print(
        f"\n  TOTAL: {dias} dias · {total_sp} documentos en el SP · "
        f"{total_nues} en nuestra copia · {diferencias} diferencias"
    )
    if cursor.nextset():
        nulos = cursor.fetchall()
        print(
            f"  ventas del universo con Ejercicio/periodo NULL: {len(nulos)} "
            "(el SP las excluye; nuestra copia no)"
        )
        if nulos:
            print("   AVISO: hay divergencia posible en esas fechas.")
    conexion.close()

    if diferencias:
        print("\n  FALLA: el universo no coincide con el SP.")
        sys.exit(1)
    print("\n  OK: paridad total del universo.")


if __name__ == "__main__":
    main()

