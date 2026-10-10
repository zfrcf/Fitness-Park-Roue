"use client";

import { useEffect, useState } from "react";
import { LOCAL } from "@/lib/mode";

export interface Moi {
  utilisateur: { id: string; nom: string; email: string | null; admin: boolean };
  quota: { messages: number; tokens: number; limiteMessages: number; limiteTokens: number } | null;
  points?: { bons: number; mauvais: number };
}

let cache: Moi | null = null;
const abonnes = new Set<(m: Moi | null) => void>();

async function charger() {
  try {
    const r = await fetch("/api/moi", { cache: "no-store" });
    if (!r.ok) return;
    cache = (await r.json()) as Moi;
    abonnes.forEach((f) => f(cache));
  } catch {
    /* hors ligne */
  }
}

/** Rafraîchit le compte affiché (après un message : le quota change). */
export function rafraichirMoi() {
  void charger();
}

/** Compte connecté (null le temps du chargement). En atelier local : administrateur. */
export function useMoi(): Moi | null {
  const [moi, setMoi] = useState<Moi | null>(LOCAL ? { utilisateur: { id: "admin", nom: "Administrateur", email: null, admin: true }, quota: null } : cache);
  useEffect(() => {
    if (LOCAL) return;
    abonnes.add(setMoi);
    if (!cache) void charger();
    return () => {
      abonnes.delete(setMoi);
    };
  }, []);
  return moi;
}
