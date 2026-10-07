"use client";

import { FileDiff } from "lucide-react";
import { useState } from "react";
import { ouvrirDansExplorateur, type StatsModifications } from "@/lib/fichiers/explorateur";
import { formatNombre } from "@/lib/format";
import { cn } from "@/lib/utils";

/** « +116 −88 » en vert et rouge, comme un diff git. */
export function CompteurLignes({ ajouts, suppressions, className }: { ajouts: number; suppressions: number; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 gap-1 font-mono tabular-nums", className)} title={`${ajouts} ligne(s) ajoutée(s), ${suppressions} supprimée(s)`}>
      <span className="text-emerald-600 dark:text-emerald-400">+{formatNombre(ajouts)}</span>
      <span className="text-red-600 dark:text-red-400">−{formatNombre(suppressions)}</span>
    </span>
  );
}

const LIBELLE_STATUT = { nouveau: "nouveau", modifie: "", supprime: "supprimé" } as const;

/** Résumé des fichiers changés par une réponse : « 2 fichiers modifiés +116 −88 », dépliable. */
export function ResumeModifications({ stats }: { stats: StatsModifications }) {
  const [ouvert, setOuvert] = useState(stats.fichiers.length <= 4);
  const n = stats.fichiers.length;
  return (
    <div className="rounded-lg border bg-muted/30 text-xs">
      <button type="button" onClick={() => setOuvert((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <FileDiff className="size-4 text-muted-foreground" />
        <span className="font-medium">
          {n} fichier{n > 1 ? "s" : ""} modifié{n > 1 ? "s" : ""}
        </span>
        <CompteurLignes ajouts={stats.ajouts} suppressions={stats.suppressions} />
        <span className="ml-auto text-muted-foreground">{ouvert ? "masquer" : "détails"}</span>
      </button>
      {ouvert && (
        <ul className="divide-y border-t">
          {stats.fichiers.map((f) => (
            <li key={f.chemin}>
              <button
                type="button"
                disabled={f.statut === "supprime"}
                onClick={() => ouvrirDansExplorateur(f.chemin)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono enabled:hover:bg-muted"
                title={f.statut === "supprime" ? f.chemin : `Ouvrir ${f.chemin} dans l'explorateur`}
              >
                <span className={cn("min-w-0 flex-1 truncate", f.statut === "supprime" && "line-through opacity-60")}>{f.chemin}</span>
                {LIBELLE_STATUT[f.statut] && <span className="font-sans text-[10px] text-muted-foreground">{LIBELLE_STATUT[f.statut]}</span>}
                <CompteurLignes ajouts={f.ajouts} suppressions={f.suppressions} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
