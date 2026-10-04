"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUp, Bot, Loader2, Square, User } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { REGLAGES_DEFAUT, type MessageUI, type MetaMessage, type Reglages } from "@/lib/chat/types";
import { formatNombre } from "@/lib/format";
import { cn } from "@/lib/utils";
import { partiesVisibles } from "./utils";

function MetaReponse({ meta }: { meta?: MetaMessage }) {
  if (!meta?.fournisseur) return null;
  const u = meta.usage;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      <span>{meta.fournisseur}</span>
      <span className="font-mono">{meta.modele}</span>
      {u && u.total > 0 && (
        <span>
          {formatNombre(u.entree)} → {formatNombre(u.sortie)} tokens
        </span>
      )}
      {meta.cout ? <span>{meta.cout.toFixed(4)} $</span> : null}
      {meta.bascules && meta.bascules.length > 0 && (
        <span title={meta.bascules.map((b) => `${b.de} → ${b.vers} (${b.raison})`).join("\n")}>
          {meta.bascules.length} bascule{meta.bascules.length > 1 ? "s" : ""}
        </span>
      )}
      {meta.resume && <span>historique résumé</span>}
    </div>
  );
}

export function FenetreChat({ conversationId, reglages = REGLAGES_DEFAUT }: { conversationId: string; reglages?: Reglages }) {
  const [saisie, setSaisie] = useState("");
  const zone = useRef<HTMLTextAreaElement>(null);
  const bas = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, stop, error } = useChat<MessageUI>({
    id: conversationId,
    transport: new DefaultChatTransport({ api: "/api/chat", body: { conversationId, reglages } }),
    onData: (part) => {
      if (part.type === "data-bascule") {
        const b = part.data;
        toast.message(`Bascule ${b.de} → ${b.vers}`, { description: `${b.raison}${b.continuation ? " · reprise à la suite" : ""}` });
      } else if (part.type === "data-tous-epuises") {
        toast.error(part.data.message);
      }
    },
  });

  const occupe = status === "submitted" || status === "streaming";

  useEffect(() => {
    bas.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  function envoyer(e?: FormEvent) {
    e?.preventDefault();
    const texte = saisie.trim();
    if (!texte || occupe) return;
    void sendMessage({ text: texte });
    setSaisie("");
    zone.current?.focus();
  }

  function clavier(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      envoyer();
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {messages.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
              <Bot className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Posez une question pour commencer.</p>
            </div>
          )}
          {messages.map((m) => {
            const parts = partiesVisibles(m);
            const texte = parts
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("");
            const estUtilisateur = m.role === "user";
            return (
              <div key={m.id} className={cn("flex gap-3", estUtilisateur && "justify-end")}>
                {!estUtilisateur && (
                  <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Bot className="size-4" />
                  </div>
                )}
                <div className={cn("max-w-[85%]", estUtilisateur && "rounded-2xl bg-muted px-4 py-2.5")}>
                  <div className="whitespace-pre-wrap text-[15px] leading-relaxed">
                    {texte}
                    {!estUtilisateur && occupe && m === messages.at(-1) && !texte && (
                      <Loader2 className="inline size-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {!estUtilisateur && <MetaReponse meta={m.metadata} />}
                </div>
                {estUtilisateur && (
                  <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <User className="size-4" />
                  </div>
                )}
              </div>
            );
          })}
          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error.message}
            </p>
          )}
          <div ref={bas} />
        </div>
      </div>
      <form onSubmit={envoyer} className="border-t bg-background p-3 sm:p-4">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <Textarea
            ref={zone}
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={clavier}
            placeholder="Écrivez votre message… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)"
            rows={1}
            className="max-h-48 min-h-10 flex-1 resize-none"
            autoFocus
          />
          {occupe ? (
            <Button type="button" variant="outline" size="icon" aria-label="Arrêter" onClick={() => stop()}>
              <Square className="size-4" />
            </Button>
          ) : (
            <Button type="submit" size="icon" aria-label="Envoyer" disabled={!saisie.trim()}>
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
