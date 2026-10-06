"use client";

import { Archive, Download, FileCode2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { estProjetGradle, nomArchive, type FichierGenere } from "@/lib/fichiers/extraire";
import { ouvrirDansExplorateur } from "@/lib/fichiers/explorateur";
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
}: {
  fichiers: FichierGenere[];
  actions?: React.ReactNode;
  pied?: React.ReactNode;
  /** Titre à la place de « N fichiers ». */
  titre?: string;
  sousTitre?: string;
  /** Chemins modifiés par ce message (mis en évidence dans la liste). */
  modifies?: Set<string>;
}) {
  const [zipEnCours, setZipEnCours] = useState(false);
  if (!fichiers.length) return null;
  const nom = nomArchive(fichiers);
  const gradle = estProjetGradle(fichiers);

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
          {gradle && <span className="ml-1 text-xs text-muted-foreground">· projet Gradle</span>}
          {sousTitre && <span className="ml-1 text-xs text-muted-foreground">· {sousTitre}</span>}
        </span>
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
              {modifies?.has(f.chemin) && <span className="ml-1.5 rounded bg-primary/10 px-1 text-[10px] font-sans text-primary">modifié</span>}
            </button>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatNombre(f.contenu.length)} car.</span>
            <Button size="icon-xs" variant="ghost" aria-label={`Télécharger ${f.chemin}`} onClick={() => telechargerFichier(f)}>
              <Download />
            </Button>
          </li>
        ))}
      </ul>
      {pied}
    </div>
  );
}
