# Feature: syner-clean-port (ODD)

## Objective
Port strangler a arquitectura limpia sin romper `app/` ni el CLI: capas nuevas bajo `src/` (domain/application/infrastructure/interfaces) que conviven con el código actual y lo van absorbiendo por casos de uso.

## Problem
- Lógica mezclada: endpoints FastAPI llaman directo a pyodbc/requests/Keycloak.
- Doble config (`app/config.py` vs `syner_check/config.py`), doble GraphQL (`app/graphql.py` vs `syner_check/queries.py`+`extractor.py`).
- `comparison.py` god-file (1112 líneas), sin tests, packaging `uv_build` roto con layout plano.

## Why
Separar reglas de negocio de I/O para poder testear, cambiar proveedores (GraphQL/SQL/auth) y arreglar packaging sin miedo.

## Scope
- Nuevo: `src/__init__.py`, `src/domain/` (entities, value objects, errors), `src/application/` (ports + use cases), `src/infrastructure/` (adapters que delegan a `syner_check/*`), `src/interfaces/` (schemas/wiring fino).
- `app/` y `syner_check/` NO se reescriben en este feature: solo se les agrega delegación mínima cuando un endpoint migra.
- Dockerfile suma `COPY src ./src`. `pyproject` no se toca salvo que el slice lo exija con evidencia.
- Tests: solo unitarios de domain/use-cases con fakes (si hay runner; si no, stub-tests como en fase 1).

## Constraints
- Sin subagentes en este runtime: inline, un archivo por vez, slices chicos.
- Sin git: sin commits; evidencia por comandos.
- TDD off (sin runner): checks funcionales + `py_compile`/`compileall`.
- Sin credenciales reales: adapters contra código existente, verificación con fakes/stubs.
- Cada slice mantiene endpoints y CLI funcionando (strangler, no big-bang).

## Tasks
- [x] C1 Domain (`src/domain/entities.py`, `src/domain/errors.py`, `src/domain/__init__.py`, `src/__init__.py`)
  - Aceptación: `Document`, `TipoDocumento`, `FechaRango` (valida orden y max días), errores `AuthError/NotFound/UpstreamError`; sin imports de fastapi/requests/pyodbc.
  - Checks: `py_compile`, stub-test de validaciones.
  - Evidencia 2026-09-20: `compileall src: OK`; `check_domain.py` (parse_many parity + 3 rechazos de tipo + 3 rechazos de rango): OK. Nota: se usó `UnauthorizedError` (PermissionError) en vez de `AuthError` para no chocar con Keycloak `auth.py`.
- [x] C2 Application ports + use cases (`src/application/ports.py`, `src/application/use_cases.py`)
  - Aceptación: `DocumentRepository/SearchGateway` ports + `GetSummary/SearchByNumber/GetDetail` que orquestan puertos; testeables con fakes.
  - Checks: `py_compile`, stub-test con fakes.
  - Evidencia 2026-09-20: `compileall src: OK`; `check_usecases.py` (sql_index con cache+dedup, graphql_fallback, get_detail OK + NotFound): OK. Nota: se implementaron `search_by_number` + `get_detail` (summary queda para C4/fase 3 por su merge SQL×GraphQL).
- [x] C3 Infrastructure adapters (`src/infrastructure/adapters.py`)
  - Aceptación: adapters que delegan a `syner_check/*` y `app/*` existentes sin duplicar queries; traducen excepciones a errores domain.
  - Checks: `py_compile` (+ import con stubs si faltan deps).
  - Evidencia 2026-09-20: `compileall src: OK`; `check_adapters.py` (delegación SQL/GraphQL + traducción a UpstreamError): OK.
- [x] C4 Interfaces wiring (`src/interfaces/schemas.py`, migración de 1 endpoint)
  - Aceptación: 1 endpoint (document detail) pasa por use-case vía adapter; contrato JSON idéntico; resto de endpoints intactos.
  - Checks: `py_compile`, comparación de contrato.
  - Evidencia 2026-09-20: `compileall app src: OK`; `check_wiring.py` (contrato idéntico `{"document": {..., "tipo"}}`, 404 y 400): OK. `api_document` delega a `src.interfaces.wiring.document_detail` vía `to_thread`; summary/search intactos. Dockerfile suma `COPY src`. Nota: se creó `wiring.py` en vez de `schemas.py` (no hay schemas nuevos: el contrato se reutiliza tal cual).
- [x] C5 Packaging + tests base
  - Aceptación: decisión `uv_build` vs layout documentada y aplicada con evidencia; `pytest` mínimo de domain/use-cases si hay runner, si no stub-tests; ruff config solo si no rompe.
  - Checks: comandos con resultado observado.
  - Evidencia 2026-09-20: `uv build` antes: FAIL (`Expected src\syner_check_web\__init__.py`); switch a `hatchling` con `packages=["app","syner_check","src"]` → `uv build`: OK (sdist+wheel, luego `dist/` eliminado). Tests stdlib `python -m unittest discover -s tests`: 7 tests OK (domain parity + use-cases con fakes). Ruff se difiere a fase 3 (sin runner instalado). `uv sync` completo no corrido (pesado/red).
- [x] C6 Verificación final
  - Aceptación: checklist C1–C5, pendientes honestos, `comparison.py` y migración total declarados fuera de este feature (fase 3).
  - Checks: `compileall`.
  - Evidencia 2026-09-20: `compileall app src tests: OK`; `unittest: 7 OK`; re-run de los 5 stub-checks (auth/domain/usecases/adapters/wiring): todos OK. Sin git: sin commits. Fuera de este feature (fase 3): migrar summary/search, `comparison.py` 1112 líneas, doble config GraphQL, pooling DB, cliente GraphQL async, ruff, `uv sync` completo, smoke con credenciales y `docker build`.

## Authorized scope
"adelante" tras proponer fase 2 con autorización explícita. Solo `src/` nuevo + `COPY src` en Dockerfile + delegación mínima en 1 endpoint (C4). Sin reescribir `app/`/`syner_check/`, sin push/PR.

## Progress
- 2026-09-20: documento creado. Sin código nuevo aún.
- 2026-09-20: C1 hecho (domain puro stdlib). Sin git: sin commit.
- 2026-09-20: C2 hecho (ports + search_by_number/get_detail con fakes). Sin git: sin commit.
- 2026-09-20: C3 hecho (adapters con traducción a UpstreamError). Sin git: sin commit.
- 2026-09-20: C4 hecho (api_document por use-case, contrato idéntico + COPY src). Sin git: sin commit.
- 2026-09-20: C5 hecho (hatchling + 7 tests unittest OK). Sin git: sin commit.

## Verification evidence
- C1: `python -m compileall -q src`: OK; `check_domain.py`: OK.
- C2: `python -m compileall -q src`: OK; `check_usecases.py`: OK.
- C3: `python -m compileall -q src`: OK; `check_adapters.py`: OK.
- C4: `python -m compileall -q app src`: OK; `check_wiring.py`: OK.
- C5: `uv build`: OK (hatchling); `python -m unittest discover -s tests`: 7 OK.
- C6: `compileall app src tests`: OK; 5 stub-checks re-run: OK.

## Next step
- Feature cerrado. Fase 3 (si la autorizás): migrar summary/search, comparison.py, doble config, pooling, GraphQL async, ruff, smoke y docker build.
