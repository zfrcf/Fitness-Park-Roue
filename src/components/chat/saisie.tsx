"use client";

import { ArrowUp, FileArchive, FileText, Globe, Loader2, Paperclip, Square, X } from "lucide-react";
import { useEffect, useRef, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import type { PiecesPreparees } from "./pieces-jointes";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Saisie({
  valeur,
  onChange,
  onEnvoyer,
  onArreter,
  occupe,
  indice,
  complement,
  rechercheWeb,
  onRechercheWeb,
  pieces,
  preparation,
  onAjouterFichiers,
  onRetirerImage,
  onRetirerFichiers,
}: {
  valeur: string;
  onChange: (v: string) => void;
  onEnvoyer: () => void;
  onArreter: () => void;
  occupe: boolean;
  indice?: React.ReactNode;
  /** Information ajoutée en fin de pied (ex. taille du contexte). */
  complement?: React.ReactNode;
  rechercheWeb: boolean;
  onRechercheWeb: (v: boolean) => void;
  /** Pièces jointes en attente d'envoi. */
  pieces?: PiecesPreparees;
  preparation?: boolean;
  onAjouterFichiers?: (fichiers: Array<{ fichier: File; chemin?: string }>) => void;
  onRetirerImage?: (index: number) => void;
  onRetirerFichiers?: (origine: string) => void;
}) {
  const selecteur = useRef<HTMLInputElement>(null);
  const aDesPieces = !!pieces && (pieces.images.length > 0 || pieces.fichiers.length > 0);
  const zone = useRef<HTMLTextAreaElement>(null);

  // Hauteur automatique.
  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [valeur]);

  // Raccourci « / » : focus sur la saisie ; Échap : arrêter la génération.
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => {
      const cible = e.target as HTMLElement | null;
      const dansChamp = cible && (cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" || cible.isContentEditable);
      if (e.key === "/" && !dansChamp && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        zone.current?.focus();
      } else if (e.key === "Escape" && occupe) {
        onArreter();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [occupe, onArreter]);

  function clavier(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onEnvoyer();
    }
  }

  function coller(e: ClipboardEvent<HTMLTextAreaElement>) {
    // Capture d'écran ou fichier collé : ajouté en pièce jointe (le texte collé reste du texte).
    const fichiers = [...e.clipboardData.files];
    if (!fichiers.length || !onAjouterFichiers) return;
    e.preventDefault();
    onAjouterFichiers(fichiers.map((f, i) => ({ fichier: f.name ? f : new File([f], `capture-${i + 1}.png`, { type: f.type }) })));
  }

  // Fichiers de code regroupés par origine (une archive .zip = une étiquette).
  const groupes = new Map<string, { nb: number; document: boolean }>();
  for (const f of pieces?.fichiers ?? []) {
    const cle = f.origine ?? f.chemin;
    const g = groupes.get(cle) ?? { nb: 0, document: f.genre === "document" };
    g.nb++;
    groupes.set(cle, g);
  }

  function soumettre(e: FormEvent) {
    e.preventDefault();
    onEnvoyer();
  }

  return (
    <form onSubmit={soumettre} className="border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5">
        <div className="flex flex-col rounded-2xl border bg-background p-1.5 pl-1.5 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        {(aDesPieces || preparation) && (
          <div className="flex flex-wrap items-center gap-1.5 px-1 pt-0.5 pb-1.5" aria-label="Pièces jointes">
            {pieces?.images.map((im, i) => (
              <div key={`${im.filename}-${i}`} className="group/piece relative size-14 overflow-hidden rounded-lg border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- image locale (data:), pas d'optimisation */}
                <img src={im.url} alt={im.filename ?? "image jointe"} className="size-full object-cover" />
                <button type="button" aria-label={`Retirer ${im.filename ?? "l'image"}`} onClick={() => onRetirerImage?.(i)} className="absolute top-0.5 right-0.5 rounded-full bg-background/90 p-0.5 opacity-80 hover:opacity-100">
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {[...groupes].map(([origine, g]) => (
              <span key={origine} className="flex max-w-60 items-center gap-1.5 rounded-lg border bg-muted/50 py-1 pr-1 pl-2 text-xs">
                {origine.toLowerCase().endsWith(".zip") ? <FileArchive className="size-3.5 shrink-0" /> : <FileText className="size-3.5 shrink-0" />}
                <span className="truncate" title={origine}>
                  {origine}
                </span>
                {g.nb > 1 && <span className="shrink-0 text-muted-foreground">{g.nb} fichiers</span>}
                <button type="button" aria-label={`Retirer ${origine}`} onClick={() => onRetirerFichiers?.(origine)} className="rounded p-0.5 hover:bg-muted">
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {preparation && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> lecture des fichiers…
              </span>
            )}
            {!!pieces?.ignores.length && (
              <span className="text-[11px] text-muted-foreground" title={pieces.ignores.join("\n")}>
                {pieces.ignores.length} ignoré{pieces.ignores.length > 1 ? "s" : ""} (binaires, trop gros…)
              </span>
            )}
          </div>
        )}
        <div className="flex items-end gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant={rechercheWeb ? "secondary" : "ghost"}
                  size="icon"
                  aria-pressed={rechercheWeb}
                  aria-label={rechercheWeb ? "Recherche web forcée : activée" : "Forcer une recherche web pour ce message"}
                  onClick={() => onRechercheWeb(!rechercheWeb)}
                  className={rechercheWeb ? "text-primary" : "text-muted-foreground"}
                />
              }
            >
              <Globe className="size-4" />
            </TooltipTrigger>
            <TooltipContent>{rechercheWeb ? "Recherche web forcée (cliquez pour désactiver)" : "Forcer une recherche web sur ce message"}</TooltipContent>
          </Tooltip>
          {onAjouterFichiers && (
            <>
              <Tooltip>
                <TooltipTrigger render={<Button type="button" variant="ghost" size="icon" aria-label="Joindre des fichiers" className="text-muted-foreground" onClick={() => selecteur.current?.click()} />}>
                  <Paperclip className="size-4" />
                </TooltipTrigger>
                <TooltipContent>Joindre des fichiers, une archive .zip, un PDF ou des images (ou glissez-les ici)</TooltipContent>
              </Tooltip>
              <input
                ref={selecteur}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const liste = [...(e.target.files ?? [])];
                  if (liste.length) onAjouterFichiers(liste.map((f) => ({ fichier: f })));
                  e.target.value = "";
                }}
              />
            </>
          )}
          <Textarea
            ref={zone}
            value={valeur}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={clavier}
            onPaste={coller}
            placeholder="Écrivez votre message… collez un lien pour qu'il soit lu"
            rows={1}
            aria-label="Message"
            className="max-h-60 min-h-8 flex-1 resize-none border-0 bg-transparent px-0 py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
            autoFocus
          />
          {occupe ? (
            <Tooltip>
              <TooltipTrigger render={<Button type="button" variant="outline" size="icon" aria-label="Arrêter la génération" onClick={onArreter} />}>
                <Square className="size-3.5 fill-current" />
              </TooltipTrigger>
              <TooltipContent>Arrêter (Échap)</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger render={<Button type="submit" size="icon" aria-label="Envoyer" disabled={(!valeur.trim() && !aDesPieces) || preparation} />}>
                <ArrowUp className="size-4" />
              </TooltipTrigger>
              <TooltipContent>Envoyer (Entrée)</TooltipContent>
            </Tooltip>
          )}
        </div>
        </div>
        <p className="px-1 text-center text-[11px] text-muted-foreground">
          {indice ?? (rechercheWeb ? "Recherche web forcée : le message est cherché sur le web avant la réponse" : "Entrée pour envoyer · Maj+Entrée pour un retour à la ligne · / pour écrire")}
          {complement && <> · {complement}</>}
        </p>
      </div>
    </form>
  );
}
