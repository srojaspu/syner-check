import { useEffect, useState } from "react";

/** Secciones de primer nivel de la aplicacion. */
export type AppRoute = "comprobantes" | "intelisis-ufe" | "series-sucursal";

const RUTAS: Record<string, AppRoute> = {
  "#/comprobantes": "comprobantes",
  "#/intelisis-ufe": "intelisis-ufe",
  "#/series-sucursal": "series-sucursal",
};

export const RUTA_COMPROBANTES: AppRoute = "comprobantes";

/** Hash -> ruta. Cualquier hash desconocido cae en comprobantes. */
export function rutaDesdeHash(hash: string): AppRoute {
  return RUTAS[hash] ?? RUTA_COMPROBANTES;
}

/**
 * Ruteo por hash (`#/comprobantes`, `#/intelisis-ufe`).
 *
 * Sin router: deep link y boton "atras" funcionan de inmediato y el shell
 * queda listo para un router futuro.
 */
export function useHashRoute(): AppRoute {
  const [ruta, setRuta] = useState<AppRoute>(() =>
    rutaDesdeHash(typeof window === "undefined" ? "" : window.location.hash),
  );

  useEffect(() => {
    const onChange = () => setRuta(rutaDesdeHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return ruta;
}
