# QA — Pantalla Intelisis UFE (paridad con la pestana FE del PHP)

Fecha: 2026-10-21 · Base: `PUnidas` (172.0.1.156) · Login: solo lectura

Alcance de esta ronda: **todo lo que no depende de la credencial de escritura del DBA**
(listado, KPIs, trazabilidad y validación individual en SUNAT). El reenvío queda para
la fase 2.

---

## 1. Paridad del universo (14 días)

El universo de la pantalla es una copia de `dbo.PUSP_ControlFac`. El contraste compara
el **cuerpo del SP tal cual** (mismos joins, mismo `WHERE` con `Ejercicio`/`periodo`/
`day(FechaEmision)`) contra nuestra consulta, sin necesidad de `EXECUTE`: se compara el
resultado, no se invoca el procedimiento.

Script: `qa/paridad_pusp_controlfac.sql` (lo puede correr el DBA con el login
de lectura; no escribe nada).

```powershell
.venv\Scripts\python.exe -c "..."   # o pegarlo en SSMS
```

| Día | Documentos (SP) | Documentos (nuestra copia) | Solo en el SP | Solo en nuestra copia | Resultado |
|---|---|---|---|---|---|
| 2026-10-20 | 464 | 464 | 0 | 0 | PARIDAD |
| 2026-10-19 | 466 | 466 | 0 | 0 | PARIDAD |
| 2026-10-18 | 375 | 375 | 0 | 0 | PARIDAD |
| 2026-10-17 | 812 | 812 | 0 | 0 | PARIDAD |
| 2026-10-16 | 802 | 802 | 0 | 0 | PARIDAD |
| 2026-10-15 | 697 | 697 | 0 | 0 | PARIDAD |
| 2026-10-14 | 515 | 515 | 0 | 0 | PARIDAD |
| 2026-10-13 | 664 | 664 | 0 | 0 | PARIDAD |
| 2026-10-12 | 588 | 588 | 0 | 0 | PARIDAD |
| 2026-10-11 | 388 | 388 | 0 | 0 | PARIDAD |
| 2026-10-10 | 773 | 773 | 0 | 0 | PARIDAD |
| 2026-10-09 | 561 | 561 | 0 | 0 | PARIDAD |
| 2026-10-08 | 617 | 617 | 0 | 0 | PARIDAD |
| 2026-10-07 | 631 | 631 | 0 | 0 | PARIDAD |
| **Total** | **8.353** | **8.353** | **0** | **0** | **PARIDAD** |

Riesgo conocido y medido: el SP filtra por `Ejercicio`/`periodo` y nuestra copia no.
Hay ventas del universo con esos campos en `NULL`, pero **ninguna** cae en el universo
de los últimos 60 días (consulta 2 del script → 0 filas).

## 2. Paridad de la clasificación (4 días)

Compara documento a documento las reglas de `rmand2/fe/core.php` (`fe_classify`)
transcritas a SQL contra lo que devuelve la app (dominio puro en producción).

Script: `tests/qa_paridad_clasificacion.py` (manual, no corre en el CI):

```powershell
.venv\Scripts\python.exe -m tests.qa_paridad_clasificacion 2026-10-20
```

| Día | Documentos | Diferencias | Motivos |
|---|---|---|---|
| 2026-10-20 | 464 | 2 | 1 × D14/D25 · 1 × D21 |
| 2026-10-17 | 812 | 0 | — |
| 2026-10-14 | 515 | 0 | — |
| 2026-10-10 | 773 | 1 | 1 × D14/D25 |

**Las 3 diferencias son decisiones documentadas**, no desvíos:

- **D14/D25**: el PHP marca `REVISAR ULTIMO INTENTO` cuando el último intento falló
  pero uno anterior salió OK; nosotros lo marcamos `GENERADOR SIN OK` (mismo veredicto
  REVISAR, otro nombre).
- **D21**: las NC que acreditan un `SE-*` no pasan por el generador; las mostramos como
  `NO APLICA` en vez de `SIN TRAZA`.
- **D19** (PENDIENTE sin traza) y **D13** (ventana de gracia) no aparecen en estos días,
  pero el script los detecta y los clasifica si occurrieran.

El script **falla** (código 1) si aparece alguna diferencia `SIN EXPLICAR`.

## 3. Validación individual contra SUNAT

Prueba real contra el validador (cuenta de cuota real):

| Documento | Identidad enviada | Resultado |
|---|---|---|
| Factura 7465947 | `F202-00002576` | **ACEPTADO** (`codigo_sunat=1`, RUC ACTIVO, HABIDO) |
| NC 7466221 | `F710-00012286` | **ACEPTADO** (observación: el comprobante de pago fue emitido a otro contribuyente, normal en una NC) |

Descubrimiento crítico: **la identidad de SUNAT lleva el prefijo de tipo**
(`B710-00004539`), no el número que guarda la bitácora (`710-00004539`). Consultar con
la serie sin prefijo devuelve `422 "En comprobantes físicos, el campo 'monto' no debe
registrar información"`. La serie real sale de la sección CAB 04 del TXT que genera el
ERP (`PUTBL_FE_EBOLETA_*`).

## 4. Verificación de 3 documentos a mano

| id_venta | Comprobante | Nuestra pantalla | Referencia (SQL) |
|---|---|---|---|
| 7464427 | `F710-00212560` | generado · OK REGISTRADO · CONFORME | 1 intento, 1 OK, último `OK\|FINALIZADO` |
| 7464429 | `F710-00212561` | generado · OK REGISTRADO · CONFORME | 1 intento, 1 OK, último `OK\|FINALIZADO` |
| 7464431 | `F710-00212562` | generado · OK REGISTRADO · CONFORME | 1 intento, 1 OK, último `OK\|FINALIZADO` |

## 5. Rendimiento

| Operación | Tiempo | Payload |
|---|---|---|
| Listado de 7 días (3.892 documentos, periodo por defecto) | ~3 s | 2,4 MB |
| Listado de 31 días sin filtro (17.976 documentos) | 6,9 s | 3,2 MB (5.000 filas + aviso de recorte) |
| Listado de 31 días filtrando por REVISAR (298 filas) | 8,2 s | 0,19 MB |
| Listado de 31 días filtrando por SIN TRAZA (1.551 filas) | 11,2 s | 0,95 MB |
| Listado de 1 día (464 documentos) | 0,6 s (SQL) | 0,3 MB |
| Trazabilidad de un documento | 1,2 s | — |
| Validación individual en SUNAT | 3,2 s | — |

Los filtros se aplican en el servidor (D29): con 31 días el universo son ~18.000
documentos y filtrarlos en el navegador no era viable. Antes de ese cambio el
listado de 31 días devolvía **17,7 MB**.

## 6. Criterios de aceptación

- [x] Universo con paridad exacta contra `PUSP_ControlFac` en 14 días (8.353 documentos).
- [x] Clasificación con paridad o con diferencias explicadas (D13, D14, D19, D21, D25).
- [x] Validación individual contra SUNAT con resultado real.
- [x] Payload del listado acotado: 31 días sin filtro 3,2 MB (antes 17,7 MB), filtrado 0,19 MB.
- [x] 281 tests Python + 86 vitest en verde; `tsc` limpio; build de producción OK.
- [x] 252 tests Python + 77 vitest en verde; `tsc` limpio; build de producción OK.
- [ ] Contraste visual contra la pantalla PHP para un mismo día (requiere que César
      abra la pestaña FE con el mismo período).
- [ ] Reenvío (fase 2): requiere la credencial de escritura y la ventana de prueba.

## 7. Cómo repetir este QA

```powershell
# 1) Paridad del universo (14 días)
.venv\Scripts\python.exe -m tests.qa_paridad_universo     # o el script .sql en SSMS

# 2) Paridad de la clasificación (por día)
.venv\Scripts\python.exe -m tests.qa_paridad_clasificacion 2026-10-20

# 3) Smoke completo (listado + trazabilidad + validación SUNAT)
.venv\Scripts\python.exe -m tests.smoke_intelisis_ufe --validar
```

Todos usan el `.env` local (login de lectura) y **no escriben nada en Intelisis**.
El único que escribe es el `dbo.SunatValidacion` de nuestra base (el estado SUNAT).

