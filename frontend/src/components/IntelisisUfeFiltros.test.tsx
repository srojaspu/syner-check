// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { filtraUfeFilas, opcionesSunat } from "./IntelisisUfeFiltros";
import type { IntelisisUfeRow } from "../api/types";

function fila(overrides: Partial<IntelisisUfeRow> = {}): IntelisisUfeRow {
  return {
    id_venta: 1,
    tipo: "BO",
    tipo_documento_pu: "03",
    documento: "602-00142702",
    documento_estimado: false,
    documento_teorico: "602-00142702",
    comprobante: "B602-00142702",
    mov: "E-Boleta",
    mov_id: "602-142702",
    fecha_emision: "2026-10-21",
    sucursal: 602,
    sucursal_nombre: "Tienda Central",
    cliente: "CLIENTE DE PRUEBA",
    cliente_codigo: "1000000082",
    ruc: "20101031773",
    importe: 100,
    impuestos: 18,
    total: 118,
    estatus_erp: "CONCLUIDO",
    referencia: "",
    estado_generacion: "generado",
    generador: "OK REGISTRADO",
    incidencias: [],
    resultado: "CONFORME",
    detalle_incidencia: null,
    en_espera: false,
    exento_generador: false,
    fuera_de_bitacora: false,
    etapa: "FINALIZADO",
    intentos: 1,
    ok_registrados: 1,
    ultimo_intento: "2026-10-21 12:41:07",
    hash: "",
    archivo_out: "",
    procedimiento: "SPPUFE_UBL21",
    tipo_sunat: "BOLETA",
    sunat: null,
    estado_sunat: "SUNAT SIN CONSULTA",
    reenvio: null,
    ...overrides,
  };
}

const FILAS = [
  fila({ id_venta: 1 }),
  fila({
    id_venta: 2,
    comprobante: "F202-00002576",
    documento: "202-00002576",
    documento_teorico: "202-00002576",
    mov_id: "202-2576",
    tipo: "FA",
    resultado: "REVISAR",
    estado_generacion: "sin_registro",
    generador: "SIN TRAZA",
    incidencias: ["SIN TRAZA"],
    sucursal: 202,
    sucursal_nombre: "Tienda Miraflores",
    cliente: "OTRO CLIENTE",
  }),
];

describe("filtraUfeFilas", () => {
  it("sin filtros devuelve todo", () => {
    expect(filtraUfeFilas(FILAS, {})).toHaveLength(2);
  });

  it("filtra por generador", () => {
    const out = filtraUfeFilas(FILAS, { generador: "SIN TRAZA" });
    expect(out.map((f) => f.id_venta)).toEqual([2]);
  });

  it("filtra por tipo", () => {
    const out = filtraUfeFilas(FILAS, { tipo: "FA" });
    expect(out.map((f) => f.id_venta)).toEqual([2]);
  });

  it("filtra por estado tecnico", () => {
    const out = filtraUfeFilas(FILAS, { estado: "generado" });
    expect(out.map((f) => f.id_venta)).toEqual([1]);
  });

  it("filtra por los estados derivados del Validador", () => {
    const sinTraza = fila({
      id_venta: 3,
      estado_generacion: "sin_registro",
      generador: "SIN TRAZA",
      incidencias: ["SIN TRAZA"],
    });
    const pendiente = fila({
      id_venta: 4,
      estatus_erp: "PENDIENTE",
      estado_generacion: "sin_registro",
      generador: "SIN TRAZA",
      incidencias: [],
    });
    const espera = fila({
      id_venta: 5,
      estado_generacion: "sin_registro",
      generador: "SIN TRAZA",
      incidencias: [],
      en_espera: true,
    });
    const noAplica = fila({
      id_venta: 6,
      estado_generacion: "sin_registro",
      generador: "NO APLICA",
      incidencias: [],
      exento_generador: true,
    });
    const filas = [sinTraza, pendiente, espera, noAplica];

    expect(
      filtraUfeFilas(filas, { derivado: "sin_traza" }).map((f) => f.id_venta),
    ).toEqual([3]);
    expect(
      filtraUfeFilas(filas, { derivado: "pendientes_conclusion" }).map(
        (f) => f.id_venta,
      ),
    ).toEqual([4]);
    expect(
      filtraUfeFilas(filas, { derivado: "en_espera" }).map((f) => f.id_venta),
    ).toEqual([5]);
    expect(
      filtraUfeFilas(filas, { derivado: "no_aplica" }).map((f) => f.id_venta),
    ).toEqual([6]);
  });

  it("filtra por sucursal", () => {
    const out = filtraUfeFilas(FILAS, { sucursal: 202 });
    expect(out.map((f) => f.id_venta)).toEqual([2]);
  });

  it("filtra por estatus del ERP", () => {
    expect(filtraUfeFilas(FILAS, { estatus: "CONCLUIDO" })).toHaveLength(2);
    expect(filtraUfeFilas(FILAS, { estatus: "PENDIENTE" })).toHaveLength(0);
  });

  it("filtra por estado SUNAT", () => {
    const out = filtraUfeFilas(FILAS, { sunat: "SUNAT SIN CONSULTA" });
    expect(out).toHaveLength(2);
  });

  it("aísla la que falló en SUNAT", () => {
    const filas = [
      ...FILAS,
      fila({ id_venta: 9, estado_sunat: "ERROR" }),
    ];
    const out = filtraUfeFilas(filas, { sunat: "ERROR" });
    expect(out.map((f) => f.id_venta)).toEqual([9]);
  });

  it("ofrece todos los estados de SUNAT, incluido el error", () => {
    expect(opcionesSunat([]).map((o) => o.value)).toEqual([
      "ACEPTADO",
      "AUTORIZADO",
      "PENDIENTE",
      "PROCESANDO",
      "SUNAT NO ENCONTRADO",
      "SUNAT NO ACEPTADO",
      "ERROR",
      "SUNAT SIN CONSULTA",
    ]);
  });

  it("agrega los estados nuevos que solo trae el KPI, sin duplicar", () => {
    const opciones = opcionesSunat([
      { key: "ACEPTADO", count: 3 },
      { key: "ESTADO NUEVO", count: 1 },
    ]);
    expect(opciones.map((o) => o.value)).toContain("ESTADO NUEVO");
    expect(
      opciones.filter((o) => o.value === "ACEPTADO"),
    ).toHaveLength(1);
  });

  it("busca por documento, cliente o id", () => {
    expect(filtraUfeFilas(FILAS, { q: "F202" })).toHaveLength(1);
    expect(filtraUfeFilas(FILAS, { q: "otro cliente" })).toHaveLength(1);
    expect(filtraUfeFilas(FILAS, { q: "142702" })).toHaveLength(1);
    expect(filtraUfeFilas(FILAS, { q: "no-existe" })).toHaveLength(0);
  });

  it("combina filtros", () => {
    const out = filtraUfeFilas(FILAS, {
      generador: "SIN TRAZA",
      tipo: "FA",
    });
    expect(out).toHaveLength(1);
    const ninguno = filtraUfeFilas(FILAS, {
      generador: "SIN TRAZA",
      tipo: "BO",
    });
    expect(ninguno).toHaveLength(0);
  });
});
