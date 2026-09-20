# Feature: syner-fix-seguro (ODD)

## Objective
Corregir errores críticos y de seguridad sin reestructurar a clean architecture.

## Problem
- Bypass de auth cuando `hd` viene vacío (hace fallback al dominio permitido).
- Endpoints async bloqueados por `ThreadPoolExecutor` + Keycloak sync.
- Búsqueda por número con N+1 GraphQL y detalle que escanea todo el rango.
- Config duplicada y frágil (`int()` sin validar, `raise` en import).
- Dockerfile copia todo (incluye `.venv`/`app.zip`) y corre como root; sin healthcheck.

## Why
Base sana antes de cualquier port. Seguridad y disponibilidad primero.

## Scope
- `app/auth.py`, `app/main.py`, `app/graphql.py`, `app/config.py`, `syner_check/config.py` (solo lectura para no romper CLI), `Dockerfile`, `docker-compose.yml`, `.dockerignore` (nuevo), `.gitignore` (si falta).
- No se toca `syner_check/comparison.py` (god-file 1112 líneas) salvo lectura; va a fase 2.
- No se crea `src/` ni capas clean; eso es otro feature.

## Constraints
- Sin subagentes disponibles en este runtime (Task bloqueado por free-tier): trabajo inline, un archivo por vez.
- Sin git repo: no hay work-unit commits ni PRs; evidencia = lectura de vuelta + comandos observados.
- TDD: deshabilitado (no hay runner ni tests). Checks = funcionales ordinarios + `python -m compileall`.
- No pedir OAuth real ni credenciales; verificación con smoke sin secretos.

## Tasks
- [x] F1 Auth hd estricto + dev email validado (`app/auth.py`)
  - Aceptación: `hd` vacío o distinto se rechaza aunque el email termine en el dominio; `DEV_USER_EMAIL` se valida con la misma regla en modo development.
  - Checks: `compileall`, prueba manual de `is_allowed_email` con casos borde.
  - Evidencia 2026-09-20: `python -m py_compile app/auth.py: OK`; stub-test `is_allowed_email` 6 casos borde: OK. Hallazgo lateral: `uv run` rompe por `uv_build` que espera `src/syner_check_web` ( packaging incompatible con layout plano) — va a F4/F5.
- [x] F2 No bloquear event loop (`app/graphql.py`, `app/main.py`)
  - Aceptación: llamadas GraphQL/Keycloak salen del loop (threads dedicados o cliente async) sin cambiar el contrato de respuesta.
  - Checks: `compileall`, smoke `/health`, revisión de que no hay `.result()` bloqueante en path async.
  - Evidencia 2026-09-20: `py_compile app/main.py: OK`; 6 sitios `asyncio.to_thread` (summary, fetch_documents, fetch_by_number, 2×detail en search, detail en document). Contrato JSON intacto (mismo dict de retorno).
- [x] F3 Búsqueda N+1 acotada (`app/main.py`, `app/graphql.py`)
  - Aceptación: `api_search` no hace una query GraphQL por fila SQL; `api_document` no baja el rango completo para un solo `oid` si hay forma acotada; se mantiene `source`/`in_sql`.
  - Checks: `compileall`, smoke de contrato (forma del JSON) sin credenciales reales.
  - Evidencia 2026-09-20: `py_compile app/main.py: OK`; `detail_cache[(tipo, doc_date)]` por request (misma respuesta, 1 query por fecha distinta en vez de 1 por fila). `api_document` ya es 1 sola query de 1 día: se deja.
- [x] F4 Config robusta (`app/config.py`)
  - Aceptación: `int()` de env con fallback seguro, `GRAPHQL_URL` requerido con error claro en uso (no en import si rompe CLI), mensajes sin valores secretos.
  - Checks: `compileall`, arranque con env mínimo.
  - Evidencia 2026-09-20: `py_compile app/config.py: OK`; `_int_env` con fallback + `MAX_RANGE_DAYS>=1`. `SESSION_SECRET` requerido se mantiene (falla rápido y sin exponer valor); `GRAPHQL_URL` vacío ya falla en uso con mensaje claro (`app/graphql.py:_client`).
- [x] F5 Docker + higiene (`Dockerfile`, `docker-compose.yml`, `.dockerignore`)
  - Aceptación: `COPY` acotado, usuario no-root, healthcheck, compose con healthcheck; no se versionan artefactos nuevos.
  - Checks: `docker build` solo si el usuario lo autoriza (pesado); si no, `compileall` + lectura de vuelta.
  - Evidencia 2026-09-20: lectura de vuelta Dockerfile (COPY acotado a pyproject/uv.lock/README + app + syner_check, USER appuser, HEALTHCHECK /health) y compose (healthcheck curl /health) OK; `.dockerignore` nuevo excluye `.venv/app.zip/.env/odd/output`. Build NO corrido (pesado, pendiente autorización). Alerta: `pip install .` usa `uv_build` que ya falla con layout plano (`uv run` lo probó) — el build Docker puede fallar hasta que fase 2 arregle packaging; no se tocó `pyproject` para no romper el CLI sin tests.
- [x] F6 Verificación funcional
  - Aceptación: checklist F1–F5 con evidencia, pendientes honestos, próximo paso (fase 2 clean) definido.
  - Checks: comandos corridos con resultado observado.
  - Evidencia 2026-09-20: `python -m compileall -q app: OK`; `check_auth2.py: OK`. No se corrió server ni docker build (requieren credenciales/recursos; pendientes con autorización). Sin git: sin commits (repo no inicializado).

## Authorized scope
Pedido explícito: "busques errores y los corrijas" + respuesta "Fix seguro primero". Cambios solo dentro de Scope. Sin push/PR/merge (no hay git).

## Progress
- 2026-09-20: documento creado, sin cambios de código aún. Mirror Engram pendiente de sync en cada tarea.
- 2026-09-20: F1 hecho (auth hd estricto + dev validado). Sin git: sin commit, evidencia arriba.
- 2026-09-20: F2 hecho (asyncio.to_thread en 6 sitios). Sin git: sin commit.
- 2026-09-20: F3 hecho (detail_cache por request). Sin git: sin commit.
- 2026-09-20: F4 hecho (config robusta). Sin git: sin commit.
- 2026-09-20: F5 hecho (Docker + higiene). Sin git: sin commit.

## Verification evidence
- F1: `python -m py_compile app/auth.py`: OK; `check_auth2.py` (6 casos borde hd vacío/None/dominio ajeno/subdominio evil/mayúsculas): OK.
- `uv run` falla por packaging (`Expected a Python module at: src\syner_check_web\__init__.py`): preexistente, no causado por F1.
- F2: `python -m py_compile app/main.py`: OK; `Select-String asyncio.to_thread`: 6 sitios.
- F3: `python -m py_compile app/main.py`: OK.
- F4: `python -m py_compile app/config.py`: OK.
- F5: lectura de vuelta Dockerfile + compose + `.dockerignore`: OK; build Docker pendiente.
- F6: `python -m compileall -q app`: OK; `check_auth2.py`: OK.

## Next step
- Fase 2 propuesta: port strangler a clean architecture (`src/domain|application|infrastructure|interfaces`), packaging `uv_build` vs layout plano, god-file `comparison.py` (1112 líneas), tests pytest + ruff, pooling DB y cliente GraphQL async. Requiere tu autorización explícita.
