"""QA de paridad de clasificacion: reglas del PHP vs nuestra implementacion.

Compara, documento a documento y para un dia real:

- **Referencia (PHP)**: las reglas de ``rmand2/fe/core.php`` (``fe_classify``)
  transcritas a SQL: generador, incidencias y resultado.
- **Nuestra pantalla**: lo que devuelve ``src.application.intelisis_ufe``
  (dominio puro, ya en produccion).

Las diferencias esperadas son las decisiones documentadas (D13, D14, D19, D21,
D25). El script las clasifica y verifica que **no quede ninguna diferencia sin
explicar**: ese es el criterio de aceptacion.

Uso (manual, no es parte del CI):

    .venv\\Scripts\\python.exe -m tests.qa_paridad_clasificacion 2026-10-20
"""

from __future__ import annotations

import os
import sys
from collections import Counter

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("AUTH_MODE", "development")
os.environ.setdefault("SESSION_SECRET", "qa-secret-" + "x" * 32)
os.environ.setdefault("SESSION_HTTPS_ONLY", "false")

from dotenv import load_dotenv  # noqa: E402

load_dotenv(r"C:\Projects\PYTHON\syner-check-web\.env")

from syner_check.config import (  # noqa: E402
    get_intelisis_config,
    get_intelisis_password,
)
from syner_check.db_client import build_connection_string  # noqa: E402

import pyodbc  # noqa: E402

from src.application.intelisis_ufe import listar_ufe  # noqa: E402
from src.infrastructure.intelisis_ufe import IntelisisUfeReaderAdapter  # noqa: E402

# --- Referencia: el universo del SP y los intentos por documento -----------

REFERENCIA_SQL = """
WITH Ufe AS (
    SELECT V.ID AS IDVenta, V.Estatus, V.Mov, V.MovID, V.Referencia, V.Sucursal,
           B.TipoDocumentoPU
    FROM dbo.Venta V WITH (NOLOCK)
    LEFT JOIN dbo.MovTipo B WITH (NOLOCK) ON B.Modulo = 'VTAS' AND B.Mov = V.Mov
    WHERE V.Empresa = 'PU'
      AND V.Estatus IN ('CONCLUIDO', 'PENDIENTE')
      AND V.FechaEmision >= ? AND V.FechaEmision < DATEADD(DAY, 1, ?)
      AND V.Mov NOT IN ('RECIBO GIFT CARD', 'Reversion N-Credito', 'Reversion Vta',
                        'SE-Boleta', 'SE-Factura', 'SE-Nota Credito', 'Recibo')
      AND EXISTS (SELECT 1 FROM dbo.MovTipo X WITH (NOLOCK)
                  WHERE X.Modulo = 'VTAS' AND X.Mov = V.Mov
                    AND X.Clave IN ('VTAS.F', 'VTAS.FC', 'VTAS.B', 'VTAS.FB',
                                    'VTAS.D', 'VTAS.DC', 'VTAS.FG'))
)
SELECT
    U.IDVenta,
    U.Estatus,
    U.Referencia,
    U.TipoDocumentoPU,
    Intentos = (SELECT COUNT(*) FROM dbo.SPPUFE_EjecucionLog L WITH (NOLOCK)
                 WHERE L.IDVenta = U.IDVenta),
    OkRegistrados = (SELECT COUNT(*) FROM dbo.SPPUFE_EjecucionLog L WITH (NOLOCK)
                     WHERE L.IDVenta = U.IDVenta AND L.Estado = 'OK'
                       AND L.Etapa = 'FINALIZADO'),
    UltimoPorLogID = (SELECT TOP 1 L.Estado + '|' + L.Etapa
                      FROM dbo.SPPUFE_EjecucionLog L WITH (NOLOCK)
                      WHERE L.IDVenta = U.IDVenta ORDER BY L.LogID DESC),
    UltimoPorFecha = (SELECT TOP 1 L.Estado + '|' + L.Etapa
                      FROM dbo.SPPUFE_EjecucionLog L WITH (NOLOCK)
                      WHERE L.IDVenta = U.IDVenta
                      ORDER BY L.FechaInicio DESC, L.LogID DESC)
FROM Ufe U
"""


def referencia_php(intentos: int, ok_registrados: int, ultimo: str) -> dict:
    """`fe_classify` del PHP, transcrito (rmand2/fe/core.php:25-43)."""
    ultimo_ok = ultimo == "OK|FINALIZADO"
    generador = (
        "SIN TRAZA"
        if intentos == 0
        else ("OK REGISTRADO" if ok_registrados > 0 else "SIN OK")
    )
    if intentos == 0:
        incidencias = ["SIN TRAZA"]
    elif ok_registrados == 0:
        incidencias = ["GENERADOR SIN OK"]
    elif not ultimo_ok:
        incidencias = ["REVISAR ULTIMO INTENTO"]
    else:
        incidencias = []
    return {
        "generador": generador,
        "incidencias": incidencias,
        "resultado": "REVISAR" if incidencias else "CONFORME",
    }


def clasificar_diferencia(nuestra: dict, php: dict, referencia: dict) -> str:
    """Motivo de la diferencia (o '' si no hay diferencia)."""
    if nuestra["resultado"] == php["resultado"] and nuestra[
        "generador"
    ] == php["generador"]:
        return ""
    if nuestra.get("exento_generador"):
        return "D21: NC que acredita un SE-* (exenta del generador)"
    if nuestra.get("en_espera"):
        return "D13: dentro de la ventana de gracia"
    if nuestra["estatus_erp"].upper() != "CONCLUIDO":
        return "D19: venta PENDIENTE sin traza no es incidencia"
    if referencia["UltimoPorLogID"] != referencia["UltimoPorFecha"]:
        return "ULTIMO DISTINTO: LogID vs FechaInicio"
    if (
        "REVISAR ULTIMO INTENTO" in php["incidencias"]
        and "GENERADOR SIN OK" in nuestra["incidencias"]
    ):
        return "D14/D25: 'REVISAR ULTIMO INTENTO' -> 'GENERADOR SIN OK'"
    return "SIN EXPLICAR"


def main() -> None:
    dia = sys.argv[1] if len(sys.argv) > 1 else "2026-10-20"
    conexion = pyodbc.connect(
        build_connection_string(get_intelisis_config(), get_intelisis_password())
    )
    cursor = conexion.cursor()
    cursor.execute(REFERENCIA_SQL, dia, dia)
    nombres = [c[0] for c in cursor.description]
    referencia = {
        int(dict(zip(nombres, fila))["IDVenta"]): dict(zip(nombres, fila))
        for fila in cursor.fetchall()
    }
    conexion.close()

    nuestra = {
        fila["id_venta"]: fila
        for fila in listar_ufe(
            IntelisisUfeReaderAdapter(), start_iso=dia, end_iso=dia
        )["rows"]
    }

    print(f"=== Paridad de clasificacion · {dia} ===")
    print(f"documentos en el universo: {len(referencia)}")
    print(f"documentos en nuestra app: {len(nuestra)}")
    if set(referencia) != set(nuestra):
        print(
            "  AVISO: los conjuntos de documentos no coinciden:",
            len(set(referencia) ^ set(nuestra)),
        )

    motivos: Counter[str] = Counter()
    sin_explicar: list[int] = []
    for id_venta, ref in referencia.items():
        fila = nuestra.get(id_venta)
        if fila is None:
            continue
        php = referencia_php(
            int(ref["Intentos"] or 0),
            int(ref["OkRegistrados"] or 0),
            str(ref["UltimoPorLogID"] or ""),
        )
        motivo = clasificar_diferencia(fila, php, ref)
        if not motivo:
            continue
        motivos[motivo] += 1
        if motivo == "SIN EXPLICAR":
            sin_explicar.append(id_venta)

    print("\n-- diferencias por motivo --")
    if not motivos:
        print("  ninguna diferencia: paridad total con las reglas del PHP")
    for motivo, cantidad in motivos.most_common():
        print(f"  {cantidad:>4}  {motivo}")

    print("\n-- veredicto --")
    if sin_explicar:
        print(f"  FALLA: {len(sin_explicar)} diferencias sin explicar: {sin_explicar[:10]}")
        sys.exit(1)
    print("  OK: todas las diferencias son decisiones documentadas (D13, D14, D19, D21, D25).")

    print("\n-- 3 documentos para revisar a mano --")
    for id_venta in sorted(nuestra)[:3]:
        fila = nuestra[id_venta]
        ref = referencia.get(id_venta, {})
        print(f"  id_venta={id_venta} {fila['comprobante']} ({fila['mov']} {fila['mov_id']})")
        print(
            f"    nuestra: estado={fila['estado_generacion']} generador={fila['generador']} "
            f"resultado={fila['resultado']} incidencias={fila['incidencias']}"
        )
        print(
            f"    php    : intentos={ref.get('Intentos')} ok={ref.get('OkRegistrados')} "
            f"ultimo={ref.get('UltimoPorLogID')}"
        )


if __name__ == "__main__":
    main()

