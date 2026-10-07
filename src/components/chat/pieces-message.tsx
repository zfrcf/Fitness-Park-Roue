"use client";

import { Download, FileArchive, FileText, ImageOff, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MessageUI } from "@/lib/chat/types";
import { ouvrirDansExplorateur } from "@/lib/fichiers/explorateur";
import { formatNombre } from "@/lib/format";
import { cn } from "@/lib/utils";

function telechargerDataUrl(url: string, nom: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Image cliquable (vignette) qui s'ouvre en grand avec un bouton de téléchargement. */
export function ImageAgrandissable({ url, nom, legende, className }: { url: string; nom: string; legende?: string; className?: string }) {
  const [ouverte, setOuverte] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOuverte(true)} className={cn("overflow-hidden rounded-lg border bg-muted", className)} title={legende ?? nom}>
        {/* eslint-disable-next-line @next/next/no-img-element -- image en data: URL, pas d'optimisation possible */}
        <img src={url} alt={legende ?? nom} className="size-full object-cover" />
      </button>
      <Dialog open={ouverte} onOpenChange={setOuverte}>
        <DialogContent className="max-h-[95dvh] max-w-[min(95vw,1100px)] overflow-y-auto sm:max-w-[min(95vw,1100px)]">
          <DialogHeader>
            <DialogTitle className="truncate">{nom}</DialogTitle>
            {legende && <DialogDescription className="line-clamp-3">{legende}</DialogDescription>}
          </DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element -- image en data: URL */}
          <img src={url} alt={legende ?? nom} className="max-h-[75dvh] w-full rounded-md object-contain" />
          <Button variant="outline" onClick={() => telechargerDataUrl(url, nom)}>
            <Download /> Télécharger
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Pièces jointes d'un message de l'utilisateur : vignettes des images, fichiers (ouvrables dans l'explorateur). */
export function PiecesDuMessage({ message }: { message: MessageUI }) {
  const images = message.parts.filter((p) => p.type === "file" && p.mediaType.startsWith("image/"));
  const joints = message.parts.flatMap((p) => (p.type === "data-fichiers-joints" ? [p.data] : []));
  const fichiers = joints.flatMap((j) => j.fichiers);
  const ignores = joints.flatMap((j) => j.ignores ?? []);
  if (!images.length && !fichiers.length && !ignores.length) return null;
  // Archives : une ligne par archive ; fichiers isolés : un par un.
  const archives = new Map<string, number>();
  for (const f of fichiers) if (f.origine) archives.set(f.origine, (archives.get(f.origine) ?? 0) + 1);
  const isoles = fichiers.filter((f) => !f.origine);
  return (
    <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
      {images.map((im, i) =>
        im.type === "file" && im.url.startsWith("data:") ? (
          <ImageAgrandissable key={i} url={im.url} nom={im.filename ?? `image-${i + 1}.jpg`} className="size-24" />
        ) : (
          <span key={i} className="flex size-24 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
            <ImageOff className="size-5" />
          </span>
        ),
      )}
      {[...archives].map(([origine, n]) => (
        <span key={origine} className="flex items-center gap-1.5 rounded-lg border bg-muted/50 px-2 py-1 text-xs">
          <FileArchive className="size-3.5" /> {origine} <span className="text-muted-foreground">· {formatNombre(n)} fichiers</span>
        </span>
      ))}
      {isoles.map((f) => (
        <button
          key={f.chemin}
          type="button"
          disabled={f.genre === "document"}
          onClick={() => ouvrirDansExplorateur(f.chemin)}
          className="flex max-w-64 items-center gap-1.5 rounded-lg border bg-muted/50 px-2 py-1 text-xs enabled:hover:bg-muted"
          title={f.genre === "document" ? `${f.chemin} : texte lu par le modèle` : `Ouvrir ${f.chemin} dans l'explorateur`}
        >
          <FileText className="size-3.5 shrink-0" />
          <span className="truncate font-mono">{f.chemin}</span>
          <span className="shrink-0 text-muted-foreground">{f.genre === "document" ? "texte" : `${formatNombre(f.contenu.split("\n").length)} l.`}</span>
        </button>
      ))}
      {ignores.length > 0 && (
        <span className="text-[11px] text-muted-foreground" title={ignores.join("\n")}>
          {ignores.length} fichier{ignores.length > 1 ? "s" : ""} non lu{ignores.length > 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

/** Images générées dans une réponse de l'assistant (outil generer_image). */
export function ImagesGenerees({ message }: { message: MessageUI }) {
  const images = message.parts.flatMap((p) => (p.type === "data-image" ? [p.data] : []));
  if (!images.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((im, i) =>
        im.erreur ? (
          <div key={i} className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <ImageOff className="size-4" /> Image non générée : {im.erreur}
          </div>
        ) : im.url ? (
          <figure key={i} className="flex flex-col gap-1">
            <ImageAgrandissable url={im.url} nom={`image-${i + 1}.jpg`} legende={im.prompt} className="aspect-square w-72 max-w-full" />
            <figcaption className="max-w-72 truncate text-[11px] text-muted-foreground" title={im.prompt}>
              {im.source === "pollinations" ? "Pollinations (secours)" : "FLUX · Cloudflare"} · {im.prompt}
            </figcaption>
          </figure>
        ) : (
          <div key={i} className="flex aspect-square w-72 max-w-full items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Génération de l&apos;image…
          </div>
        ),
      )}
    </div>
  );
}
