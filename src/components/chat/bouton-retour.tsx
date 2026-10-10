"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useVote } from "./retours";
import { cn } from "@/lib/utils";

/**
 * Boutons 👍 / 👎 sur une réponse de l'assistant. Un 👎 (ou un 👍) peut s'accompagner d'une note :
 * « ce qu'il faut éviter / refaire ». L'app en fait une leçon réinjectée dans les conversations
 * suivantes (voir lecons.ts) : l'assistant évite ses erreurs passées et reproduit ce qui a plu.
 */
export function BoutonRetour({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const { vote, voter } = useVote(conversationId, messageId);
  const [ouvert, setOuvert] = useState<null | "bon" | "mauvais">(null);
  const [note, setNote] = useState("");

  function envoyer(type: "bon" | "mauvais") {
    void voter(type, note.trim() || undefined);
    setOuvert(null);
    setNote("");
    toast.success(type === "bon" ? "Bon point retenu 👍" : "Noté : l'assistant en tiendra compte 👎", {
      description: note.trim() ? "Leçon enregistrée pour les prochaines conversations." : undefined,
    });
  }

  function bouton(type: "bon" | "mauvais") {
    const Icone = type === "bon" ? ThumbsUp : ThumbsDown;
    const actif = vote === type;
    return (
      <Popover open={ouvert === type} onOpenChange={(o) => setOuvert(o ? type : null)}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={type === "bon" ? "Bonne réponse" : "Mauvaise réponse"}
              aria-pressed={actif}
              className={cn(actif && (type === "bon" ? "text-emerald-600" : "text-destructive"))}
              onClick={() => {
                // Clic simple : (dé)vote tout de suite ; la note reste facultative via le popover.
                if (actif) void voter(type);
              }}
            />
          }
        >
          <Icone className={cn("size-3.5", actif && "fill-current")} />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-3">
          <p className="mb-2 text-sm font-medium">{type === "bon" ? "Qu'est-ce qui était bien ?" : "Qu'est-ce qui n'allait pas ?"}</p>
          <p className="mb-2 text-xs text-muted-foreground">Facultatif, mais utile : l&apos;assistant s&apos;en souviendra dans vos prochaines conversations.</p>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={400}
            placeholder={type === "bon" ? "Ex. : bonne structure, a bien suivi la consigne…" : "Ex. : a inventé une fonction qui n'existe pas, n'a pas respecté le format…"}
            className="text-sm"
            autoFocus
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOuvert(null)}>
              Annuler
            </Button>
            <Button type="button" size="sm" onClick={() => envoyer(type)}>
              Enregistrer
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <>
      {bouton("bon")}
      {bouton("mauvais")}
    </>
  );
}
