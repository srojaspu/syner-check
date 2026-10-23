import { describe, expect, it } from "vitest";
import { nuevoToken } from "./token";

describe("nuevoToken", () => {
  it("genera 32 caracteres hexadecimales", () => {
    expect(nuevoToken()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("no repite el token entre solicitudes", () => {
    expect(nuevoToken()).not.toBe(nuevoToken());
  });
});
