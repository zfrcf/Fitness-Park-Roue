"use client";

import { useEffect, useState } from "react";
import { rafraichirMoi } from "@/components/coque/moi";
import type { TypeRetour } from "@/lib/comptes/lecons";

/** Votes (bon/mauvais) déjà posés, par conversation puis par message. */
const cache = new Map<string, Record<string, TypeRetour>>();
const abonnes = new Map<string, Set<() => void>>();

function prevenir(conversationId: string) {
  abonnes.get(conversationId)?.forEach((f) => f());
}

export async function chargerRetours(conversationId: string) {
  try {
    const r = await fetch(`/api/retours?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
    if (!r.ok) return;
    const d = (await r.json()) as { votes?: Record<string, TypeRetour> };
    cache.set(conversationId, d.votes ?? {});
    prevenir(conversationId);
  } catch {
    /* hors ligne */
  }
}

/** Vote courant d'un message et fonction pour (dé)voter avec une note facultative. */
export function useVote(conversationId: string, messageId: string) {
  const [, forcer] = useState(0);
  useEffect(() => {
    let set = abonnes.get(conversationId);
    if (!set) abonnes.set(conversationId, (set = new Set()));
    const cb = () => forcer((n) => n + 1);
    set.add(cb);
    if (!cache.has(conversationId)) void chargerRetours(conversationId);
    return () => {
      set!.delete(cb);
    };
  }, [conversationId, messageId]);

  const vote = cache.get(conversationId)?.[messageId];

  async function voter(note: TypeRetour, commentaire?: string) {
    const actuel = cache.get(conversationId) ?? {};
    const annule = vote === note && !commentaire;
    const prochain = annule ? "annuler" : note;
    // Optimiste.
    const copie = { ...actuel };
    if (annule) delete copie[messageId];
    else copie[messageId] = note;
    cache.set(conversationId, copie);
    prevenir(conversationId);
    try {
      await fetch("/api/retours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, messageId, note: prochain, commentaire }),
      });
      rafraichirMoi();
    } catch {
      void chargerRetours(conversationId); // resynchronise en cas d'échec
    }
  }

  return { vote, voter };
}
