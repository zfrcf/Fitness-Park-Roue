"use client";

import { Loader2, Play, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { executerPython } from "@/lib/execution/python-navigateur";
import { tronquerSortie } from "@/lib/execution/langues";
import { cn } from "@/lib/utils";

/**
 * Bouton « Exécuter » d'un bloc Python : lance le code dans le navigateur de l'utilisateur
 * (Pyodide/WebAssembly), sans jamais toucher le serveur. Affiche la sortie sous le bloc.
 */
export function ExecuterPython({ code }: { code: string }) {
  const [etat, setEtat] = useState<"repos" | "charge" | "fait">("repos");
  const [etape, setEtape] = useState("");
  const [sortie, setSortie] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  async function lancer() {
    setEtat("charge");
    setErreur(null);
    setSortie("");
    try {
      const r = await executerPython(code, setEtape);
      setSortie(tronquerSortie(r.sortie));
      setErreur(r.erreur ? tronquerSortie(r.erreur, 60, 4000) : null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Exécution impossible.");
    } finally {
      setEtat("fait");
      setEtape("");
    }
  }

  const aResultat = etat === "fait" && (sortie || erreur);
  return (
    <>
      <Button type="button" variant="ghost" size="xs" onClick={() => void lancer()} disabled={etat === "charge"} aria-label="Exécuter ce code Python dans le navigateur">
        {etat === "charge" ? <Loader2 className="animate-spin" /> : <Play />}
        <span className="hidden sm:inline">{etat === "charge" ? etape || "Exécution…" : "Exécuter"}</span>
      </Button>
      {aResultat && (
        <div className="border-t bg-background/60">
          <div className="flex items-center justify-between px-3 py-1 text-[11px] text-muted-foreground">
            <span>Sortie{erreur ? " (erreur)" : ""} · exécuté dans votre navigateur</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Effacer la sortie" onClick={() => setEtat("repos")}>
              <X />
            </Button>
          </div>
          <pre className={cn("max-h-80 overflow-auto px-3 pb-3 text-[12px] leading-relaxed whitespace-pre-wrap", erreur && "text-destructive")}>
            {sortie}
            {sortie && erreur ? "\n" : ""}
            {erreur}
            {!sortie && !erreur ? "(aucune sortie)" : ""}
          </pre>
        </div>
      )}
    </>
  );
}
