"use client";

import { ArrowUp, Globe, Square } from "lucide-react";
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
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
  rechercheWeb,
  onRechercheWeb,
}: {
  valeur: string;
  onChange: (v: string) => void;
  onEnvoyer: () => void;
  onArreter: () => void;
  occupe: boolean;
  indice?: React.ReactNode;
  rechercheWeb: boolean;
  onRechercheWeb: (v: boolean) => void;
}) {
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

  function soumettre(e: FormEvent) {
    e.preventDefault();
    onEnvoyer();
  }

  return (
    <form onSubmit={soumettre} className="border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5">
        <div className="flex items-end gap-2 rounded-2xl border bg-background p-1.5 pl-1.5 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
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
          <Textarea
            ref={zone}
            value={valeur}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={clavier}
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
              <TooltipTrigger render={<Button type="submit" size="icon" aria-label="Envoyer" disabled={!valeur.trim()} />}>
                <ArrowUp className="size-4" />
              </TooltipTrigger>
              <TooltipContent>Envoyer (Entrée)</TooltipContent>
            </Tooltip>
          )}
        </div>
        <p className="px-1 text-center text-[11px] text-muted-foreground">
          {indice ?? (rechercheWeb ? "Recherche web forcée : le message est cherché sur le web avant la réponse" : "Entrée pour envoyer · Maj+Entrée pour un retour à la ligne · / pour écrire")}
        </p>
      </div>
    </form>
  );
}
