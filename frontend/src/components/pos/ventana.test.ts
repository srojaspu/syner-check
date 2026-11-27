import { describe, expect, it } from "vitest";
import {
  diaHoraLimaAIso,
  duracionLegible,
  etiquetaVentana,
  horaLocalAIso,
  isoADiaLima,
  isoAHoraLocal,
  isoAHoraMinutoLima,
  resolverVentanaPersonalizada,
  validarVentana,
  ventanaDeRango,
} from "./ventana";

describe("ventana de logs POS", () => {
  it("calcula un preset terminando ahora y redondea al minuto", () => {
    const ventana = ventanaDeRango(
      "24h",
      new Date("2026-11-24T14:00:37.500Z"),
    );

    expect(ventana.hasta).toBe("2026-11-24T09:00:00-05:00");
    expect(ventana.desde).toBe("2026-11-23T09:00:00-05:00");
  });

  it("convierte hora de pared de Perú a ISO con offset fijo", () => {
    expect(horaLocalAIso("2026-11-24T08:30")).toBe(
      "2026-11-24T08:30:00-05:00",
    );
    expect(horaLocalAIso("2026-11-24T08:30:15")).toBe(
      "2026-11-24T08:30:15-05:00",
    );
  });

  it("hace ida y vuelta entre ISO y datetime-local sin mover la hora", () => {
    const iso = "2026-11-24T08:30:00-05:00";
    expect(isoAHoraLocal(iso)).toBe("2026-11-24T08:30");
    expect(horaLocalAIso(isoAHoraLocal(iso))).toBe(iso);
  });

  it("rechaza valores que no son fecha y hora locales", () => {
    expect(horaLocalAIso("")).toBeNull();
    expect(horaLocalAIso("2026-11-24")).toBeNull();
    expect(horaLocalAIso("2026-11-24T08:30:00Z")).toBeNull();
    expect(horaLocalAIso("mañana")).toBeNull();
  });

  it("acepta un rango personalizado válido", () => {
    const resultado = resolverVentanaPersonalizada(
      "2026-11-24T08:15",
      "2026-11-24T11:45",
    );

    expect(resultado).toEqual({
      ok: true,
      ventana: {
        desde: "2026-11-24T08:15:00-05:00",
        hasta: "2026-11-24T11:45:00-05:00",
      },
    });
  });

  it("exige ambos extremos y un fin posterior al inicio", () => {
    expect(
      resolverVentanaPersonalizada("", "2026-11-24T11:45"),
    ).toMatchObject({ ok: false });
    expect(
      resolverVentanaPersonalizada("2026-11-24T12:00", "2026-11-24T10:00"),
    ).toMatchObject({
      ok: false,
      error: "La fecha final debe ser posterior a la inicial.",
    });
    expect(
      resolverVentanaPersonalizada("2026-11-24T10:00", "2026-11-24T10:00"),
    ).toMatchObject({ ok: false });
  });

  it("permite 31 días exactos y rechaza un minuto más", () => {
    expect(
      resolverVentanaPersonalizada(
        "2026-11-01T00:00",
        "2026-12-02T00:00",
      ),
    ).toMatchObject({ ok: true });

    expect(
      resolverVentanaPersonalizada(
        "2026-11-01T00:00",
        "2026-12-02T00:01",
      ),
    ).toMatchObject({
      ok: false,
      error: "El rango no puede superar 31 días.",
    });
  });

  it("resume la duración en formato compacto", () => {
    expect(
      duracionLegible(
        "2026-11-24T08:15:00-05:00",
        "2026-11-24T09:00:00-05:00",
      ),
    ).toBe("45 min");
    expect(
      duracionLegible(
        "2026-11-24T08:15:00-05:00",
        "2026-11-24T14:45:00-05:00",
      ),
    ).toBe("6 h 30 min");
    expect(
      duracionLegible(
        "2026-11-23T09:00:00-05:00",
        "2026-11-24T09:00:00-05:00",
      ),
    ).toBe("1 d");
    expect(
      duracionLegible(
        "2026-11-18T00:00:00-05:00",
        "2026-11-26T03:00:00-05:00",
      ),
    ).toBe("8 d 3 h");
  });

  it("lleva el instante ISO al día de calendario de Perú", () => {
    // 03:30 UTC del 25 es 22:30 del 24 en Lima: el calendario debe mostrar 24.
    const dia = isoADiaLima("2026-11-25T03:30:00Z");

    expect(dia).not.toBeNull();
    expect(dia?.getFullYear()).toBe(2026);
    expect(dia?.getMonth()).toBe(10);
    expect(dia?.getDate()).toBe(24);
  });

  it("extrae la hora y el minuto de Perú", () => {
    expect(isoAHoraMinutoLima("2026-11-24T08:15:00-05:00")).toEqual({
      hora: "08",
      minuto: "15",
    });
    expect(isoAHoraMinutoLima("no-es-fecha")).toBeNull();
  });

  it("compone día de calendario y hora en ISO con offset", () => {
    expect(diaHoraLimaAIso(new Date(2026, 10, 24), "08", "15")).toBe(
      "2026-11-24T08:15:00-05:00",
    );
    expect(diaHoraLimaAIso(new Date(2026, 10, 24), "8", "15")).toBeNull();
  });

  it("valida extremos ya serializados en ISO", () => {
    expect(
      validarVentana(
        "2026-11-24T08:15:00-05:00",
        "2026-11-24T11:45:00-05:00",
      ),
    ).toMatchObject({ ok: true });
    expect(
      validarVentana("invalida", "2026-11-24T11:45:00-05:00"),
    ).toMatchObject({ ok: false });
  });

  it("etiqueta el rango en hora de Perú e incluye el año si cruza", () => {
    expect(
      etiquetaVentana({
        desde: "2026-11-24T08:15:00-05:00",
        hasta: "2026-11-24T11:45:00-05:00",
      }),
    ).toBe("24 nov, 08:15 → 24 nov, 11:45");

    expect(
      etiquetaVentana({
        desde: "2026-12-31T23:00:00-05:00",
        hasta: "2027-01-01T01:00:00-05:00",
      }),
    ).toBe("31 dic 2026, 23:00 → 1 ene 2027, 01:00");
  });
});
