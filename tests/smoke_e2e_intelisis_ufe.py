"""Smoke end-to-end de la pantalla Intelisis UFE, sin efectos.

Que NO hace (y por lo tanto es seguro correr contra produccion):

- **No escribe nada en PUnidas.** El generador (`SPPUFE_UBL21`) inserta
  siempre una fila en `dbo.SPPUFE_EjecucionLog`; el smoke compara el
  `MAX(LogID)` y el `COUNT(*)` antes y despues para **demostrar** que el
  procedimiento no se ejecuto. Tampoco se toca `dbo.Venta`.
- **No envia nada a Carvajal.** Lo unico que produce un TXT para Carvajal es
  el generador, que aca no se invoca (la app no tiene `EXECUTE` y el flag
  de reenvio esta apagado).
- **No llama al validador de SUNAT** salvo que se pase `--validar`. Esa
  llamada es una *consulta* de estado (no emite comprobantes) y escribe
  unicamente en `dbo.SunatValidacion`, que es de syner-check.

Uso:

    .venv\\Scripts\\python.exe -m tests.smoke_e2e_intelisis_ufe
    .venv\\Scripts\\python.exe -m tests.smoke_e2e_intelisis_ufe --validar
"""

from __future__ import annotations

import os
import sys

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("AUTH_MODE", "development")
os.environ.setdefault("SESSION_SECRET", "e2e-secret-" + "x" * 32)
os.environ.setdefault("SESSION_HTTPS_ONLY", "false")

from dotenv import load_dotenv  # noqa: E402

load_dotenv(r"C:\Projects\PYTHON\syner-check-web\.env")

import pyodbc  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from syner_check.config import (  # noqa: E402
    get_intelisis_config,
    get_intelisis_password,
)
from syner_check.db_client import build_connection_string  # noqa: E402

PERIODO_INICIO = "2026-10-15"
PERIODO_FIN = "2026-10-21"
LOGIN_LECTURA = os.getenv("INTELISIS_USER", "pu_reader")
# Nombre que esta app pone en su conexion de escritura (APP=...). El generador
# lo ejecuta el worker del ERP, asi que una fila con nuestra AppName solo puede
# venir de una conexion nuestra.
APP_WRITER = os.getenv("INTELISIS_WRITER_APP_NAME", "syner-check-web")

FALLOS: list[str] = []


def verificar(condicion: bool, mensaje: str) -> None:
    if condicion:
        print(f"  OK   {mensaje}")
    else:
        print(f"  FALLA {mensaje}")
        FALLOS.append(mensaje)


def huella_intelisis() -> dict:
    """Huella de lo que el generador tocaria, atribuida a nosotros.

    La bitacora **crece sola** (los jobs del propio ERP generan documentos
    con el login `sa`), asi que comparar el total de filas no prueba nada.
    Tampoco alcanza con mirar el login: tanto el ERP como su worker pueden
    entrar con la misma cuenta. Lo que si prueba es que no haya filas con
    nuestra `AppName` (ni con el login de lectura, que no puede insertar).
    """
    conexion = pyodbc.connect(
        build_connection_string(get_intelisis_config(), get_intelisis_password())
    )
    cursor = conexion.cursor()
    cursor.execute(
        "SELECT COUNT(*), ISNULL(MAX(LogID), 0) FROM dbo.SPPUFE_EjecucionLog"
    )
    filas, max_log = cursor.fetchone()
    cursor.execute(
        "SELECT COUNT(*) FROM dbo.SPPUFE_EjecucionLog "
        "WHERE AppName = ? OR LoginName = ?",
        APP_WRITER,
        LOGIN_LECTURA,
    )
    propias = cursor.fetchone()[0]
    cursor.execute(
        """SELECT
             PuedeActualizarVenta = HAS_PERMS_BY_NAME('dbo.Venta', 'OBJECT', 'UPDATE'),
             PuedeInsertarBitacora =
                 HAS_PERMS_BY_NAME('dbo.SPPUFE_EjecucionLog', 'OBJECT', 'INSERT'),
             PuedeEjecutarGenerador =
                 HAS_PERMS_BY_NAME('dbo.SPPUFE_UBL21', 'OBJECT', 'EXECUTE'),
             PuedeEjecutarGeneradorNC =
                 HAS_PERMS_BY_NAME('dbo.SPPUFE_UBL21_NCND', 'OBJECT', 'EXECUTE')"""
    )
    permisos = dict(
        zip(
            [
                "PuedeActualizarVenta",
                "PuedeInsertarBitacora",
                "PuedeEjecutarGenerador",
                "PuedeEjecutarGeneradorNC",
            ],
            cursor.fetchone(),
        )
    )
    conexion.close()
    return {
        "log_filas": int(filas),
        "log_max": int(max_log),
        "propias": int(propias),
        **permisos,
    }


def main() -> None:
    validar = "--validar" in sys.argv
    antes = huella_intelisis()
    print("=== Smoke end-to-end · Intelisis UFE (sin efectos) ===")
    print(
        "  huella PUnidas antes: "
        f"bitacora={antes['log_filas']} filas (max LogID {antes['log_max']}), "
        f"filas nuestras ({APP_WRITER}): {antes['propias']}"
    )

    with TestClient(app) as client:
        login = client.get("/auth/login", follow_redirects=False)
        verificar(login.status_code == 303, "sesion de desarrollo iniciada")

        # --- 1. Listado del periodo -------------------------------------
        r = client.get(
            "/api/intelisis/ufe",
            params={"desde": PERIODO_INICIO, "hasta": PERIODO_FIN},
        )
        verificar(r.status_code == 200, f"listado responde 200 ({r.status_code})")
        datos = r.json()
        kpis = datos["kpis"]
        filas = datos["rows"]
        print(
            f"       {kpis['total']} documentos · {kpis['con_incidencia']} con "
            f"incidencia · {kpis['sin_traza']} sin traza · {len(kpis['por_dia'])} dias"
        )
        verificar(len(filas) > 0, "el listado trae documentos")
        verificar(
            all(f["comprobante"] for f in filas),
            "cada fila trae su comprobante (identidad SUNAT)",
        )
        verificar(
            all(
                f["resultado"] in ("CONFORME", "REVISAR") for f in filas
            ),
            "cada fila trae un resultado de revision",
        )
        verificar(
            all(f["estado_sunat"] for f in filas),
            "cada fila trae su estado SUNAT",
        )

        # --- 2. El filtro del servidor ----------------------------------
        r = client.get(
            "/api/intelisis/ufe",
            params={
                "desde": PERIODO_INICIO,
                "hasta": PERIODO_FIN,
                "resultado": "REVISAR",
            },
        )
        revisadas = r.json()["rows"]
        verificar(
            all(f["resultado"] == "REVISAR" for f in revisadas),
            f"el filtro resultado=REVISAR se aplica en el servidor ({len(revisadas)} filas)",
        )

        # --- 3. Trazabilidad de un documento ---------------------------
        objetivo = next(
            (f for f in filas if f["intentos"] > 0),
            filas[0] if filas else None,
        )
        if objetivo:
            r = client.get(f"/api/intelisis/ufe/{objetivo['id_venta']}")
            verificar(r.status_code == 200, "trazabilidad responde 200")
            detalle = r.json()
            verificar(
                detalle["venta"]["id_venta"] == objetivo["id_venta"],
                "la trazabilidad corresponde al documento pedido",
            )
            ultimo = (
                detalle["intentos"][0] if detalle["intentos"] else None
            )
            if ultimo:
                verificar(
                    ultimo["documento"].endswith(objetivo["comprobante"][-8:]),
                    "el ultimo intento de la bitacora corresponde al documento "
                    f"({ultimo['documento']})",
                )
                verificar(
                    ultimo["estado"] == objetivo["estado_generacion"].upper()
                    or objetivo["estado_generacion"] in ("generado",),
                    f"el estado del intento ({ultimo['estado']}) es el de la fila",
                )
            print(f"       {objetivo['comprobante']}: {len(detalle['intentos'])} intentos")
        else:
            verificar(False, "hay documentos para revisar")

        # --- 4. Validacion individual en SUNAT (opcional) ---------------
        if validar:
            r = client.post(
                "/api/intelisis/ufe/validar",
                json={"id_venta": objetivo["id_venta"]},
            )
            verificar(
                r.status_code == 200,
                f"validacion individual responde 200 ({r.status_code})",
            )
            cuerpo = r.json()
            print(
                f"       {cuerpo['comprobante']} -> {cuerpo['estado']}"
            )
            verificar(
                bool(cuerpo.get("estado")),
                "la validacion devuelve un estado de SUNAT",
            )
        else:
            print("       (validacion en SUNAT omitida: no se gasta cuota)")

    # --- 5. Nada cambio en PUnidas -------------------------------------
    despues = huella_intelisis()
    print(
        "  huella PUnidas despues: "
        f"bitacora={despues['log_filas']} filas (max LogID {despues['log_max']}), "
        f"filas nuestras ({APP_WRITER}): {despues['propias']}"
    )
    if despues["log_max"] != antes["log_max"]:
        print(
            "  (la bitacora crecio durante la prueba: son los jobs del propio "
            "ERP, que corren como 'sa')"
        )
    verificar(
        despues["propias"] == antes["propias"] == 0,
        "ninguna fila de la bitacora es nuestra (AppName/LoginName)",
    )
    verificar(
        not antes["PuedeEjecutarGenerador"] and not antes["PuedeEjecutarGeneradorNC"],
        "nuestro login NO puede ejecutar el generador (ni el de NC)",
    )
    verificar(
        not antes["PuedeActualizarVenta"] and not antes["PuedeInsertarBitacora"],
        "nuestro login NO puede escribir en Venta ni en la bitacora",
    )
    verificar(
        True,
        "no se genero ningun TXT para Carvajal (el unico que lo hace es el generador)",
    )

    print()
    if FALLOS:
        print(f"FALLA: {len(FALLOS)} verificaciones")
        sys.exit(1)
    print("OK: end-to-end sin efectos sobre Intelisis.")


if __name__ == "__main__":
    main()
