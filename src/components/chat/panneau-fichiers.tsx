"use client";

import { Archive, Download, FileCode2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LIBELLES_TYPE, nomArchive, typeProjet, type FichierGenere } from "@/lib/fichiers/extraire";
import { ouvrirDansExplorateur, type StatsModifications } from "@/lib/fichiers/explorateur";
import { CompteurLignes } from "./compteur-lignes";
import { cn } from "@/lib/utils";
import { formatNombre } from "@/lib/format";

function telechargerBlob(blob: Blob, nom: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function telechargerFichier(f: FichierGenere) {
  telechargerBlob(new Blob([f.contenu], { type: "text/plain;charset=utf-8" }), f.chemin.split("/").pop() ?? "fichier.txt");
}

export async function fabriquerZip(fichiers: FichierGenere[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const f of fichiers) zip.file(f.chemin, f.contenu);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export function PanneauFichiers({
  fichiers,
  actions,
  pied,
  titre,
  sousTitre,
  modifies,
  stats,
}: {
  fichiers: FichierGenere[];
  actions?: React.ReactNode;
  pied?: React.ReactNode;
  /** Titre à la place de « N fichiers ». */
  titre?: string;
  sousTitre?: string;
  /** Chemins modifiés par ce message (mis en évidence dans la liste). */
  modifies?: Set<string>;
  /** Lignes ajoutées / supprimées par ce message (+N −M), par fichier et au total. */
  stats?: StatsModifications;
}) {
  const statParChemin = new Map((stats?.fichiers ?? []).map((s) => [s.chemin, s]));
  const supprimes = (stats?.fichiers ?? []).filter((s) => s.statut === "supprime");
  const [zipEnCours, setZipEnCours] = useState(false);
  if (!fichiers.length) return null;
  const nom = nomArchive(fichiers);
  const type = typeProjet(fichiers);

  async function zip() {
    setZipEnCours(true);
    try {
      telechargerBlob(await fabriquerZip(fichiers), `${nom}.zip`);
    } catch {
      toast.error("Impossible de créer l'archive.");
    } finally {
      setZipEnCours(false);
    }
  }

  return (
    <div className="rounded-lg border bg-muted/30" aria-label="Fichiers générés">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <FileCode2 className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">
          {titre ?? `${fichiers.length} fichier${fichiers.length > 1 ? "s" : ""}`}
          {type !== "inconnu" && fichiers.length > 1 && <span className="ml-1 text-xs text-muted-foreground">· {type === "web" ? "site web" : `projet ${LIBELLES_TYPE[type]}`}</span>}
          {sousTitre && <span className="ml-1 text-xs text-muted-foreground">· {sousTitre}</span>}
        </span>
        {stats && stats.fichiers.length > 0 && <CompteurLignes ajouts={stats.ajouts} suppressions={stats.suppressions} className="text-xs" />}
        <div className="ml-auto flex flex-wrap gap-1.5">
          {actions}
          <Button size="sm" variant="outline" onClick={() => void zip()} disabled={zipEnCours}>
            {zipEnCours ? <Loader2 className="animate-spin" /> : <Archive />} Télécharger le .zip
          </Button>
        </div>
      </div>
      <ul className="max-h-64 divide-y overflow-y-auto">
        {fichiers.map((f) => (
          <li key={f.chemin} className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <button
              type="button"
              onClick={() => ouvrirDansExplorateur(f.chemin)}
              className={cn("min-w-0 flex-1 truncate text-left font-mono hover:underline", modifies && !modifies.has(f.chemin) && "text-muted-foreground")}
              title={`Ouvrir ${f.chemin} dans l'explorateur`}
            >
              {f.chemin}
              {statParChemin.get(f.chemin)?.statut === "nouveau" ? (
                <span className="ml-1.5 rounded bg-emerald-500/10 px-1 font-sans text-[10px] text-emerald-700 dark:text-emerald-400">nouveau</span>
              ) : (
                modifies?.has(f.chemin) && !statParChemin.has(f.chemin) && <span className="ml-1.5 rounded bg-primary/10 px-1 text-[10px] font-sans text-primary">modifié</span>
              )}
            </button>
            {statParChemin.has(f.chemin) && <CompteurLignes ajouts={statParChemin.get(f.chemin)!.ajouts} suppressions={statParChemin.get(f.chemin)!.suppressions} />}
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatNombre(f.contenu.length)} car.</span>
            <Button size="icon-xs" variant="ghost" aria-label={`Télécharger ${f.chemin}`} onClick={() => telechargerFichier(f)}>
              <Download />
            </Button>
          </li>
        ))}
        {supprimes.map((f) => (
          <li key={f.chemin} className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate font-mono line-through opacity-60">{f.chemin}</span>
            <span className="font-sans text-[10px] text-muted-foreground">supprimé</span>
            <CompteurLignes ajouts={0} suppressions={f.suppressions} />
          </li>
        ))}
      </ul>
      {pied}
    </div>
  );
}
