import { useSyncExternalStore } from "react";

const abonner = () => () => {};

/** Vrai uniquement après l'hydratation côté client (évite les écarts SSR/CSR). */
export function useMounted(): boolean {
  return useSyncExternalStore(
    abonner,
    () => true,
    () => false,
  );
}
