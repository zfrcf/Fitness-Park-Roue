"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { REGLAGES_DEFAUT, type Reglages } from "@/lib/chat/types";

interface Ctx {
  reglages: Reglages;
  charges: boolean;
  enregistrer: (partiel: Partial<Reglages>) => Promise<void>;
}

const ReglagesCtx = createContext<Ctx>({ reglages: REGLAGES_DEFAUT, charges: false, enregistrer: async () => {} });

export function ReglagesProvider({ children }: { children: React.ReactNode }) {
  const [reglages, setReglages] = useState<Reglages>(REGLAGES_DEFAUT);
  const [charges, setCharges] = useState(false);

  useEffect(() => {
    let actif = true;
    void fetch("/api/reglages", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { reglages?: Reglages } | null) => {
        if (actif && j?.reglages) setReglages(j.reglages);
      })
      .finally(() => actif && setCharges(true));
    return () => {
      actif = false;
    };
  }, []);

  const enregistrer = useCallback(async (partiel: Partial<Reglages>) => {
    const r = await fetch("/api/reglages", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partiel),
    });
    if (!r.ok) throw new Error("Enregistrement impossible");
    const j = (await r.json()) as { reglages: Reglages };
    setReglages(j.reglages);
  }, []);

  return <ReglagesCtx.Provider value={{ reglages, charges, enregistrer }}>{children}</ReglagesCtx.Provider>;
}

export function useReglages() {
  return useContext(ReglagesCtx);
}
