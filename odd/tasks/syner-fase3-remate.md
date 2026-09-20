# Feature: syner-fase3-remate (ODD)

## Objective
Completar el remate: migrar summary/search a casos de uso, unificar config, sanear `comparison.py`, robustez mínima (pooling/timeouts/logging), calidad (ruff+tests), y verificación pesada (`uv sync`, smoke, `docker build`).

## Problem
- `api_summary` y `api_search` aún con lógica en el endpoint (merge SQL×GraphQL, fallback).
- Doble config (`app/config.py` vs `syner_check/config.py` con `try/except` traga-errores y globales al import).
- `comparison.py` god-file (1112 líneas) con posible código muerto (`compare_records`, `load_json_file`).
- `graphql_client.py` usa `print` + `time.sleep` (bloquea) en vez de logging.
- Sin ruff, sin smoke real, sin `docker build` verificado.

## Why
Dejar el repo homogéneo: toda la I/O detrás de puertos/adapters, un solo origen de config, cliente con logging y sin bloqueos evitables.

## Scope
- `app/main.py` (summary/search por use-case), `src/application/use_cases.py` (+`summarize`), `src/interfaces/wiring.py`, `syner_check/config.py` (mínimo, sin romper CLI), `syner_check/graphql_client.py` (logging, sin cambiar reintentos), `comparison.py`/`io_utils.py` (solo lo muerto con evidencia), `pyproject` (ruff), `tests/`, Dockerfile/compose (solo si el build lo exige).
- NO nuevas dependencias. NO secretos reales (smoke sin credenciales o se declara pendiente).

## Constraints
- Inline, un archivo por vez. Sin git: sin commits. TDD off: unittest stdlib + stub-checks.
- Cada endpoint migrado mantiene contrato JSON idéntico (verificado por stub-test).
- Operaciones pesadas (`uv sync`, `docker build`) se intentan una vez con timeout amplio; si fallan, quedan pendientes honestos, no se reintenta en loop.
- Smoke con credenciales reales: imposible sin secretos → se declara pendiente, no se inventa.

## Tasks
- [x] M1 Migrar summary + search (`src/application/use_cases.py`, `src/interfaces/wiring.py`, `app/main.py`)
  - Aceptación: `summarize` nuevo + `search_by_number` reutilizado; `api_summary`/`api_search` delegan; `source`/`in_sql`/`searched_range` idénticos.
  - Checks: `py_compile`, stub-test de contrato, `unittest`.
  - Evidencia 2026-09-20: `compileall app src: OK`; `check_wiring2.py` (contrato summary/search + 3 mapeos 400): OK; `unittest`: 8 OK (incluye `SummarizeTests` nuevo). Endpoint conserva su validación 400 previa; imports muertos (`app.db`, `app.graphql`, `timedelta`) eliminados de `main.py`.
- [x] M2 Unificar config (`syner_check/config.py`)
  - Aceptación: sin `try/except` traga-errores, sin globales al import que queden rancios; CLI sigue funcionando igual.
  - Checks: `py_compile`, `python -m syner_check --help` si el runner lo permite.
  - Evidencia 2026-09-20: `compileall`: OK; `unittest`: 8 OK. Eliminado `try/except` muerto (`os.getenv` nunca levanta) y helper `_first_env` sin usos (grep: 0 referencias). Nuevo `get_graphql_url()` perezoso; `extractor.py` y `app/graphql.py` lo usan (mismo mensaje de error, sin global rancio). `GRAPHQL_URL` se sigue exportando por compat. CLI `--help` no corrido: sin runner con deps (dotenv/requests) en este runtime.
- [x] M3 Sanear comparison.py (`syner_check/comparison.py`, `syner_check/io_utils.py`)
  - Aceptación: leer completo, identificar muerto/duplicado con evidencia (grep de usos); solo se elimina lo probadamente muerto; el resto se documenta para extracción futura.
  - Checks: `py_compile`, grep de referencias, `unittest`.
  - Evidencia 2026-09-20: leído entero (1112 líneas). Eliminado con grep-evidencia (0 referencias fuera del cluster): `load_json_file`, `compare_records`, familia `compare_graphql_vs_sql`/`build_sql_key`/`build_graphql_key`/`_build_key`/snapshots/`_index_by_key`/sources/defaults, `import json` huérfano (153+80 líneas) + archivo `io_utils.py` (solo `save_json` no-op, 0 imports). Archivo 1112→878 líneas. Vivo verificado funcional (`compare_headers` matched=1, `parse_tipos` aliases OK). `unittest`: 8 OK. Resto (header-grain, line-bags, consola, CSV) todo vivo vía extractor/main: se documenta, no se extrae en este feature.
- [x] M4 Robustez mínima (`syner_check/graphql_client.py`, `app/db.py`)
  - Aceptación: `print`→logging, timeout inyectable (no `os.getenv` por llamada), sin cambiar política de reintentos; DB con timeout y cierre ya existentes verificados.
  - Checks: `py_compile`, stub-test.
  - Evidencia 2026-09-20: `compileall syner_check`: OK; `check_graphql.py` (timeout inyectado 7.5 propagado al POST, default por env 42, retry-policy intacta): OK. `import json` huérfano eliminado. DB: `Connection Timeout` + `ApplicationIntent=ReadOnly` + `try/finally close` ya estaban (verificado por lectura en fase 1, sin cambios). Prints del CLI consola (extractor/main/comparison) se dejan: son su UI, no ruido de librería.
- [x] M5 Calidad + verificación pesada (`pyproject` ruff, `tests/`, `uv sync`, smoke)
  - Aceptación: config ruff mínima; tests nuevos de `summarize`; `uv sync` intentado; smoke `/health` (+ `/api/me` en development si hay runner).
  - Checks: comandos observados; lo que falle queda pendiente honesto.
  - Evidencia 2026-09-20: `ruff check` 41→0 (7 auto + `app/db.py` reescrito idéntico, E402, E701/2, E501; `per-file-ignores E501` solo para query-strings atómicas de `app/graphql.py`; `src/`+`tests/` ya limpios). `pyproject.scripts` corregido (`syner-check-web="app.main:app"` no era callable → `syner-check="syner_check.main:main"`). `uv sync`: OK. Smoke real (uvicorn + development): `/health`→`{"status":"ok"}`, `/api/me`→`{"user":null}`, `/api/summary` sin sesión→401. `compileall`+`unittest` 8 OK + wiring2/graphql-checks OK.
- [x] M6 Docker build + cierre
  - Aceptación: `docker build` intentado una vez; cierre con checklist y pendientes.
  - Checks: comando observado.
  - Evidencia 2026-09-20: `docker --version` → comando no existe en este runtime Windows (sin Docker instalado): build imposible acá, queda pendiente para tu máquina/CI. Dockerfile verificado por lectura: COPY acotado incluye `src`, `pip install .` ahora resuelve con hatchling, USER appuser + HEALTHCHECK presentes. Cierre: M1–M5 verificados; pendientes honestos abajo.

## Authorized scope
"sigue con la fase 3" tras proponerla. Solo Scope. Sin push/PR. Sin secretos.

## Progress
- 2026-09-20: documento creado. Falta leer `comparison.py` completo antes de M3.
- 2026-09-20: M1 hecho (summary/search por use-case). Sin git: sin commit.
- 2026-09-20: M2 hecho (config sin traga-errores + URL perezosa). Sin git: sin commit.
- 2026-09-20: M3 hecho (muerto eliminado, 1112→878). Sin git: sin commit.
- 2026-09-20: M4 hecho (logging + timeout inyectable). Sin git: sin commit.
- 2026-09-20: M5 hecho (ruff 0 + sync + smoke real). Sin git: sin commit.

## Verification evidence
- M1: `compileall app src`: OK; `check_wiring2.py`: OK; `unittest`: 8 OK.
- M2: `compileall app syner_check src tests`: OK; `unittest`: 8 OK.
- M3: `compileall syner_check`: OK; grep post-limpieza: 0 huérfanos; funcional vivo: OK; `unittest`: 8 OK.
- M4: `compileall syner_check`: OK; `check_graphql.py`: OK.
- M5: `ruff check`: 0; `uv sync`: OK; smoke `/health` ok, `/api/me` null, `/api/summary` 401; `unittest`: 8 OK.
- M6: docker ausente en runtime (pendiente máquina/CI); barrido final `compileall` OK + `unittest` 8 OK + `ruff` 0.

## Next step
- Feature cerrado. Pendientes honestos fuera de este runtime: `docker build` (sin Docker acá), smoke con credenciales reales (GraphQL/Keycloak/SQL), `python -m syner_check --help` con runner completo. Nada más queda en código.
