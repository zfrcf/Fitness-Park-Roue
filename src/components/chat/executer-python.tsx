"use client";

import { Loader2, Play, Square, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SortieOrdonnee } from "@/components/chat/console-python";
import { avecMorceaux, tamponMorceaux } from "@/lib/execution/morceaux";
import { arreterExecution, executerPython, type Morceau } from "@/lib/execution/python-navigateur";

/**
 * Bouton « Exécuter » d'un bloc Python : lance le code dans le navigateur de l'utilisateur
 * (Pyodide/WebAssembly), sans jamais toucher le serveur. Chaque clic repart d'un état propre
 * (fenêtres tkinter/turtle et figures du clic précédent fermées). Affiche sous le bloc la sortie dans
 * l'ordre exact du programme (textes, erreurs, graphiques matplotlib), en direct tant qu'il tourne
 * (fenêtre ouverte, boucle avec time.sleep), puis ce qu'il affiche ensuite (clics, minuteries).
 */
export function ExecuterPython({ code }: { code: string }) {
  const [etat, setEtat] = useState<"repos" | "charge" | "fait">("repos");
  const [etape, setEtape] = useState("");
  const [morceaux, setMorceaux] = useState<Morceau[]>([]);

  async function lancer() {
    setEtat("charge");
    setMorceaux([]);
    // Une mise à jour d'état par image au plus, pas une par print.
    const tampon = tamponMorceaux((ms) => setMorceaux((l) => avecMorceaux(l, ms)));
    try {
      const r = await executerPython(code, setEtape, { sortieTardive: tampon.ajouter, enDirect: tampon.ajouter, neuf: true });
      tampon.abandonner(); // déjà dans r.morceaux
      setMorceaux(r.morceaux);
    } catch (e) {
      setMorceaux((l) => [...l, { texte: e instanceof Error ? e.message : "Exécution impossible.", erreur: true }]);
    } finally {
      setEtat("fait");
      setEtape("");
    }
  }

  const aErreur = morceaux.some((m) => "texte" in m && m.erreur);
  return (
    <>
      <Button type="button" variant="ghost" size="xs" onClick={() => void lancer()} disabled={etat === "charge"} aria-label="Exécuter ce code Python dans le navigateur">
        {etat === "charge" ? <Loader2 className="animate-spin" /> : <Play />}
        <span className="hidden sm:inline">{etat === "charge" ? etape || "Exécution…" : "Exécuter"}</span>
      </Button>
      {etat === "charge" && (
        <Button type="button" variant="ghost" size="xs" onClick={() => arreterExecution()} aria-label="Arrêter le programme" title="Arrête le programme (ses fenêtres se ferment)">
          <Square />
          <span className="hidden sm:inline">Arrêter</span>
        </Button>
      )}
      {etat !== "repos" && morceaux.length ? (
        <div className="border-t bg-background/60">
          <div className="flex items-center justify-between px-3 py-1 text-[11px] text-muted-foreground">
            <span>
              Sortie{aErreur ? " (erreur)" : ""} · exécuté dans votre navigateur{etat === "charge" ? " · en cours" : ""}
            </span>
            {etat === "fait" && (
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Effacer la sortie" onClick={() => setEtat("repos")}>
                <X />
              </Button>
            )}
          </div>
          <div className="max-h-[32rem] overflow-auto px-3 pb-3">
            <SortieOrdonnee morceaux={morceaux} classeTexte="text-[12px] leading-relaxed" classeImage="my-2 max-h-96 max-w-full" />
          </div>
        </div>
      ) : null}
    </>
  );
}
