"use client";

import { useEffect, useRef } from "react";

/**
 * Sondage périodique économe : ne tourne QUE lorsque l'onglet est visible (pause sur
 * visibilitychange, relance immédiate au retour), enchaînement par setTimeout (pas de
 * setInterval qui s'empile), et les réponses obsolètes sont ignorées. Évite d'épuiser les
 * quotas gratuits (Upstash, Neon) quand un onglet reste ouvert en arrière-plan.
 *
 * `charger` reçoit un AbortSignal et doit se terminer (succès ou échec) pour programmer le suivant.
 * `periodeMs` : null/0 désactive le sondage (le chargement initial a quand même lieu).
 */
export function useSondage(charger: (signal: AbortSignal) => Promise<void>, periodeMs: number | null): void {
  const ref = useRef(charger);
  // On garde la dernière version de `charger` sans relancer l'effet de sondage.
  useEffect(() => {
    ref.current = charger;
  });

  useEffect(() => {
    let arrete = false;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | undefined;

    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

    const tourner = async () => {
      if (arrete || !visible()) return;
      ctrl = new AbortController();
      try {
        await ref.current(ctrl.signal);
      } catch {
        /* réessai au prochain tour */
      }
      if (arrete || !periodeMs || !visible()) return;
      minuteur = setTimeout(() => void tourner(), periodeMs);
    };

    const surVisibilite = () => {
      if (arrete) return;
      if (visible()) {
        if (minuteur) clearTimeout(minuteur);
        void tourner(); // relance immédiate au retour sur l'onglet
      } else {
        if (minuteur) clearTimeout(minuteur);
        ctrl?.abort();
      }
    };

    void tourner();
    document.addEventListener("visibilitychange", surVisibilite);
    return () => {
      arrete = true;
      if (minuteur) clearTimeout(minuteur);
      ctrl?.abort();
      document.removeEventListener("visibilitychange", surVisibilite);
    };
  }, [periodeMs]);
}
