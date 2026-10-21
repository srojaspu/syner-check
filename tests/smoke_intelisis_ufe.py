"""Smoke del endpoint Intelisis UFE contra la base real (no parte del CI).

Se ejecuta a mano:

    .venv\\Scripts\\python.exe -m tests.smoke_intelisis_ufe
"""

from __future__ import annotations

import os

# Antes de importar la app: `app.config` lee el entorno al importarse.
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("AUTH_MODE", "development")
os.environ.setdefault("SESSION_SECRET", "smoke-secret-" + "x" * 32)
os.environ.setdefault("SESSION_HTTPS_ONLY", "false")

from dotenv import load_dotenv  # noqa: E402

load_dotenv(r"C:\Projects\PYTHON\syner-check-web\.env")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def main() -> None:
    with TestClient(app) as client:
        login = client.get("/auth/login", follow_redirects=False)
        print("login:", login.status_code)
        response = client.get(
            "/api/intelisis/ufe",
            params={"desde": "2026-10-15", "hasta": "2026-10-21"},
        )
        print("status:", response.status_code)
        if response.status_code != 200:
            print(response.text[:500])
            return
        data = response.json()
        kpis = data["kpis"]
        print("desde/hasta:", data["desde"], data["hasta"])
        print("intelisis_enabled:", data["intelisis_enabled"])
        print(
            "kpis:",
            {k: v for k, v in kpis.items() if not isinstance(v, list)},
        )
        print("por_generador:", kpis["por_generador"])
        print("por_incidencia:", kpis["por_incidencia"])
        print("filas:", len(data["rows"]))
        for fila in data["rows"][:3]:
            print(
                " ",
                fila["id_venta"],
                fila["documento"],
                fila["estado_generacion"],
                fila["generador"],
                fila["resultado"],
                fila["estado_sunat"],
            )


if __name__ == "__main__":
    main()
