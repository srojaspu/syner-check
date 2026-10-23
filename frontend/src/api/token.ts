/**
 * Token de idempotencia de una solicitud de reenvío (32 hex).
 *
 * Mismo formato que `feop_enqueue` del ERP: el backend deriva un token por
 * fila (`sha256("<token>:<id_venta>")`) porque `FE_Reenvio.Token` es único.
 * Reintentar con el mismo token devuelve la fila ya creada en vez de duplicar
 * el reenvío, así que se genera al abrir la confirmación y se conserva durante
 * los reintentos de esa misma intención.
 */
export function nuevoToken(): string {
  const bytes = new Uint8Array(16);
  const cripto = globalThis.crypto;
  if (cripto?.getRandomValues) {
    cripto.getRandomValues(bytes);
  } else {
    // Solo para entornos sin Web Crypto (nunca en producción).
    for (let indice = 0; indice < bytes.length; indice += 1) {
      bytes[indice] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
