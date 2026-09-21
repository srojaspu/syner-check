# Feature: syner-frontend-react (ODD)

## Objective
Reemplazar el frontend vanilla (78-line HTML + app.js + app.css) por React + TypeScript con TanStack Table, Lucide icons, temas claro/oscuro sólidos, exportación Excel y fecha con hora (createdDate), sin perder ningún comportamiento actual y usando composition pattern.

## Problem
- Vanilla JS con template strings: sin tipos, sin componentes, difícil de extender.
- Tabla hand-rolled sin sorting/filtrado; CSV en vez de Excel; fecha sin hora.
- Iconos con emoji/texto (☾☀✓⌕×); tema funcional pero básico.

## Why
Tabla seria (sort/filter/pagination), Excel real, hora de emisión visible, iconografía consistente y arquitectura de componentes componible.

## Scope
- Nuevo: `frontend/` (Vite + React + TS): deps `react`, `@tanstack/react-table`, `lucide-react`, `xlsx`; build a `app/static/frontend/`; base `/static/frontend/`.
- Composición: `<AppShell>` con slots (header/search/results/drawer); `DataTable` compound (`Toolbar`/`Pagination` por contexto); containers (hooks) vs presentacionales puros.
- Paridad: login card, tabs rango/número, presets 7/30, tipos, paginación visual, stats, drawer con productos/impuestos/pagos, copiar número, imprimir, 401→login.
- Cambios: exporta XLSX (no CSV); columna Fecha/Hora desde `createdDate` con fallback a `date` (creditNotes no trae createdDate del schema); tema system/light/dark persistido (misma key `syner-check-theme`).
- Backend: solo `home()` sirve el dist; se eliminan `templates/index.html`, `static/js/app.js`, `static/css/app.css` (muertos). `avatar.svg` se conserva.
- NO se tocan queries GraphQL ni endpoints (contrato intacto).

## Constraints
- Sin subagentes: inline, un archivo por vez. Sin git-commit salvo pedido (hay repo: commits solo si los pide).
- `npm install`/`npm run build` con red (hay). Verificación: `tsc --noEmit` + build + smoke de la página servida.
- Excel lado cliente (xlsx) desde las filas visibles/filtradas: sin cambio backend.
- NO secretos en el frontend (ya es así; se mantiene).

## Tasks
- [x] R1 Scaffold (`frontend/package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `src/main.tsx`) + `npm install`; build hello-world verde.
  - Checks: `npm run build` OK.
  - Evidencia 2026-09-20: `npm install` OK (solo aprobó script postinstall de esbuild); `tsc --noEmit && vite build` OK → `app/static/frontend/` (base `/static/frontend/`, proxy dev a :8000). Deps: react 18, tanstack-table 8, lucide-react, xlsx, vite 6.
- [x] R2 Core (`src/api/*` tipos+cliente, `src/theme/*` provider, `src/hooks/*` containers: useSession/useSummary/useSearch/useDocument).
  - Checks: `tsc --noEmit` OK.
  - Evidencia 2026-09-20: `types.ts` espeja el contrato (Voucher con `createdDate?` + `sql?`); `client.ts` con `AuthError` y 401→login; `format.ts` con `formatDateTime(createdDate, date)` (fallback sin hora para NC) + `formatMoney`/`toISODate`; `ThemeContext` (misma key `syner-check-theme`, system/light/dark); hooks `useSession`/`useVouchers`/`useDocument`. `tsc`: OK.
- [x] R3 Tablas por composición (`DataTable` compound + `SearchPanels` + `StatsBar`): sort, filtro global, paginación visual, badges SQL, tipos.
  - Checks: `tsc` OK.
  - Evidencia 2026-09-20: `DataTable.{Root,Toolbar,View,Pagination}` por contexto (sort en nº/fecha-hora/total, filtro global, page-size 25/50/100); `columns.tsx` con Fecha/Hora (`createdDate` + badge `s/h` si falta) y badges Lucide; `RangePanel`/`NumberPanel` (presets, chips, Enter) + `StatsBar` con iconos. `tsc`: OK.
- [x] R4 Drawer detalle + Excel (`DetailDrawer`, `exportExcel` con fecha/hora) + Lucide en toda la UI.
  - Checks: `tsc` OK.
  - Evidencia 2026-09-20: `DetailDrawer` compone `Field`/`Section`/`Items|Taxes|PaymentsTable` (copiar con feedback, imprimir); `excel.ts` exporta XLSX con columnas Fecha emisión (texto) + ISO, anchos calibrados; Lucide en topbar/tabs/tabla/stats/drawer (cero emoji). `tsc`: OK.
- [x] R5 Wiring backend (`app/main.py:home` → dist; borrar vanilla) + smoke página servida y login visible.
  - Checks: build OK, smoke `/` 200 con `root`, `/health` OK.
  - Evidencia 2026-09-20: `npm run build` OK (chunk 517KB por xlsx, warning documentado, aceptable en app interna); `home()` sirve `app/static/frontend/index.html`; borrados `templates/index.html`, `static/js/app.js`, `static/css/app.css` (grep: 0 referencias); smoke real: `/`→200 con `root` + assets, `/health`→ok. Backend intacto: compile + `unittest` 8 OK + `ruff` 0.
- [x] R6 Cierre (barrido `tsc`+build+`unittest`+`ruff`, pendientes honestos).
  - Checks: todo verde.
  - Evidencia 2026-09-20: `npm run build` OK; `unittest` 8 OK; `ruff` 0; `.gitignore` ignora `frontend/node_modules/` y `app/static/frontend/` (build output versionado no). Sin commit (no pedido): quedan pendientes de commit fase 3 (httpx2, summary/search) + este feature.

## Authorized scope
Pedido explícito + "usa patron composition tambien". Solo `frontend/`, `app/static/frontend/`, `home()` y borrado vanilla. Sin tocar API/queries. Commits solo si los pide.

## Progress
- 2026-09-20: documento creado. Frontend vanilla leído (paridad anotada).
- 2026-09-20: R1 hecho (scaffold + build verde). Sin commit (no pedido).
- 2026-09-20: R2 hecho (core + hooks). Sin commit.
- 2026-09-20: R3+R4 hechos (tabla compound, paneles, drawer, Excel, Lucide). Sin commit.
- 2026-09-20: R5 hecho (dist servido + vanilla borrado + smoke). Sin commit.
- 2026-09-20: R6 hecho (cierre). Sin commit.
- 2026-09-20: Fix post-cierre (sin commit): paginación 100% controlada + reset en cada búsqueda; filtro global eliminado → filtros por columna (texto: documento/fecha/cliente; selects: tipo/SQL) + botón Limpiar filtros; `tsc` + build + smoke `/` 200 OK.

## Verification evidence
- R1: `npm install` OK; `npm run build` (tsc + vite) OK.
- R2: `tsc --noEmit` OK.
- R3+R4: `tsc --noEmit` OK.
- R5: `npm run build` OK; smoke `/` 200 + `/health` ok; backend compile + `unittest` 8 OK + `ruff` 0.
- R6: build final OK; `unittest` 8 OK; `ruff` 0; gitignore al día; sin commit.
- Fix post-cierre: `tsc` OK; `npm run build` OK; smoke `/` 200 OK.

## Next step
- Feature cerrado. Si querés: commit (pedilo), o probar con tus credenciales reales y contarme qué ves.
