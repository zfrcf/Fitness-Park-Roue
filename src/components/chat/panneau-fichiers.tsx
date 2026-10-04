"use client";

import { Archive, Download, FileCode2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { estProjetGradle, nomArchive, type FichierGenere } from "@/lib/fichiers/extraire";
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

export function PanneauFichiers({ fichiers, actions }: { fichiers: FichierGenere[]; actions?: React.ReactNode }) {
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
          {fichiers.length} fichier{fichiers.length > 1 ? "s" : ""}
          {gradle && <span className="ml-1 text-xs text-muted-foreground">· projet Gradle</span>}
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
            <span className="min-w-0 flex-1 truncate font-mono" title={f.chemin}>
              {f.chemin}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatNombre(f.contenu.length)} car.</span>
            <Button size="icon-xs" variant="ghost" aria-label={`Télécharger ${f.chemin}`} onClick={() => telechargerFichier(f)}>
              <Download />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
