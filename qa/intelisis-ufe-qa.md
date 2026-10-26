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
- [x] Eje ERP: el total de la tarjeta cierra con los cuatro estados (433 = 409+8+16+0;
      19.036 = 18.601+35+304+96).
- [x] Ventas sin documentar: 304 en 31 días, separadas en 288 sin documento y 16 con
      documento inválido.
- [x] 430 tests Python + 169 vitest en verde; `tsc` limpio; `ruff` limpio.
- [ ] Contraste visual contra la pantalla PHP para un mismo día (requiere que César
      abra la pestaña FE con el mismo período).
- [ ] Reenvío (fase 2): requiere la credencial de escritura y la ventana de prueba.

## 7. Rediseño del eje ERP (verificación 2026-10-26)

Qué cambia: la tarjeta de Intelisis muestra el **total real del eje** (los cuatro estados de
`dbo.Venta`), su desglose y un puente con los documentos del listado. La grilla no cambia:
sigue mostrando solo documentos electrónicos (CONCLUIDO/PENDIENTE).

Medición de solo lectura, misma ventana del corte:

| Período | Ventas del eje | CONCLUIDO | PENDIENTE | SINAFECTAR | CANCELADO | Documentos en la grilla |
|---|---|---|---|---|---|---|
| 2026-10-25 | 433 | 409 | 8 | 16 | 0 | 417 |
| 2026-09-25 → 2026-10-25 (31 días) | 19.036 | 18.601 | 35 | 304 | 96 | — |

Comprobaciones:

- `409 + 8 + 16 + 0 = 433`: la tarjeta ya no muestra 409 (solo concluidos) como si fueran
  todas las ventas del día.
- `417 = 409 + 8`: el listado coincide con los dos estados que sí tienen comprobante.
- `19.036 = 18.601 + 35 + 304 + 96`: el desglose cierra también en el período largo.
- **SINAFECTAR (304)** no está en el listado porque no tiene comprobante electrónico: no se
  puede validar en SUNAT ni reenviar. Se consulta en el diálogo "Ventas sin documentar".
- **CANCELADO (96)** solo se informa; no forma parte del listado.

Situación documental de las 304 ventas SINAFECTAR: **288** sin ninguna fila en la bitácora y
**16** solo con un documento inválido (`159-00000000`, `OMITIDO_VALIDACION`). Además: **189**
sin folio (`MovID`) y **304** con `FechaRegistro` nula. Por eso el diálogo habla de "sin
documento emitido", no de "documento nulo": en 16 casos hay un `Documento` en la bitácora, pero
no es un comprobante.

El detalle de líneas no se consulta: el login de lectura no tiene `SELECT` sobre
`dbo.VentaD` (error 229, verificado el 2026-10-26). La medición externa daba 51 ventas sin
detalle, pero el diálogo no depende de un grant nuevo para funcionar.

Los dos estados derivados del Validador (`sin_traza`, `pendientes_conclusion`) y los de SUNAT
se explican en su popover, pero **no filtran**: la API no acepta esos filtros.

Verificación automática de esta ronda: **430 tests Python + 169 vitest** en verde,
`tsc --noEmit` limpio y `ruff check src tests` limpio.

## 8. Cómo repetir este QA

```powershell
# 1) Paridad del universo (14 días)
.venv\Scripts\python.exe -m tests.qa_paridad_universo

# 2) Paridad de la clasificación (por día)
.venv\Scripts\python.exe -m tests.qa_paridad_clasificacion 2026-10-20

# 3) Smoke de la pantalla (listado + trazabilidad)
.venv\Scripts\python.exe -m tests.smoke_intelisis_ufe

# 4) End-to-end con validacion en SUNAT (gasta cuota, no escribe en Intelisis)
.venv\Scripts\python.exe -m tests.smoke_e2e_intelisis_ufe --validar
```

Todos usan el `.env` local (login de lectura) y **no escriben nada en Intelisis**.
El único que escribe es el `dbo.SunatValidacion` de nuestra base (el estado SUNAT).

### El end-to-end no tiene efectos, y lo demuestra

`tests/smoke_e2e_intelisis_ufe.py` recorre el flujo completo (listado → filtro →
trazabilidad → validación) y verifica, sobre `PUnidas`:

| Verificación | Por qué |
|---|---|
| 0 filas de `SPPUFE_EjecucionLog` con `LoginName = pu_reader` (antes y después) | El generador **siempre** inserta una fila en la bitácora: si no hay ninguna atribuida a nuestro login, el SP no se ejecutó |
| `HAS_PERMS_BY_NAME('dbo.SPPUFE_UBL21','EXECUTE') = 0` (y el de `_NCND`) | Nuestro login **no puede** ejecutar el generador |
| `HAS_PERMS_BY_NAME('dbo.Venta','UPDATE') = 0` y `('dbo.SPPUFE_EjecucionLog','INSERT') = 0` | No puede escribir en las tablas que el generador toca |

Ojo con un detalle que se lleva por delante: **la bitácora crece sola** (los jobs
del propio ERP generan documentos con el login `sa`, desde `PUSVRGOGLOBAL`,
`PHXSVRGOGLOBAL`, `JACKSON-31`…). Comparar el total de filas antes y después no
prueba nada; por eso la verificación se hace por atribución (`LoginName`) y por
permisos, no por conteo.

Y **nada llega a Carvajal**: lo único que produce un TXT para Carvajal es el
generador, que la app no puede ejecutar.

