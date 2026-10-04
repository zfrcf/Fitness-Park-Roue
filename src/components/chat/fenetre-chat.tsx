"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowDown, Bot } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { signalerMajConversations } from "@/components/coque/barre-laterale";
import { Button } from "@/components/ui/button";
import type { MessageUI } from "@/lib/chat/types";
import { Message } from "./message";
import { useReglages } from "./reglages-contexte";
import { Saisie } from "./saisie";

const SUGGESTIONS = [
  "Résume cet article : https://fr.wikipedia.org/wiki/Fitness",
  "Rédige un message pour relancer un adhérent inactif, ton chaleureux",
  "Explique-moi la différence entre marge brute et marge nette avec un exemple",
  "Propose un plan de réunion d'équipe de 30 minutes",
];

export function FenetreChat({ conversationId, messagesInitiaux = [] }: { conversationId: string; messagesInitiaux?: MessageUI[] }) {
  const [saisie, setSaisie] = useState("");
  const { reglages } = useReglages();
  const urlRemplacee = useRef(messagesInitiaux.length > 0);
  const zoneDefilement = useRef<HTMLDivElement>(null);
  const [collé, setCollé] = useState(true); // suit-on le bas de la conversation ?

  const { messages, sendMessage, status, stop, error, regenerate, setMessages, clearError } = useChat<MessageUI>({
    id: conversationId,
    messages: messagesInitiaux,
    transport: new DefaultChatTransport({ api: "/api/chat", body: () => ({ conversationId, reglages }) }),
    onFinish: () => signalerMajConversations(),
    onData: (part) => {
      if (part.type === "data-bascule") {
        const b = part.data;
        toast.message(`Bascule ${b.de} → ${b.vers}`, { description: `${b.raison}${b.continuation ? " · reprise à la suite" : ""}` });
      } else if (part.type === "data-tous-epuises") {
        toast.error(part.data.message, { duration: 10_000 });
      }
    },
  });

  const occupe = status === "submitted" || status === "streaming";

  // Défilement : on suit le bas tant que l'utilisateur n'a pas remonté.
  const defilerEnBas = useCallback((lisse = false) => {
    const el = zoneDefilement.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: lisse ? "smooth" : "auto" });
  }, []);
  useEffect(() => {
    if (collé) defilerEnBas();
  }, [messages, collé, defilerEnBas]);
  function surDefilement() {
    const el = zoneDefilement.current;
    if (!el) return;
    setCollé(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }

  function premiereFois() {
    if (urlRemplacee.current) return;
    urlRemplacee.current = true;
    window.history.replaceState(null, "", `/c/${conversationId}`);
    setTimeout(signalerMajConversations, 800);
  }

  function envoyer(texte = saisie) {
    const t = texte.trim();
    if (!t || occupe) return;
    clearError();
    void sendMessage({ text: t });
    setSaisie("");
    setCollé(true);
    premiereFois();
  }

  function editer(index: number, texte: string) {
    if (occupe) return;
    clearError();
    setMessages((prev) => prev.slice(0, index));
    void sendMessage({ text: texte });
    setCollé(true);
  }

  function regenerer(messageId?: string) {
    if (occupe) return;
    clearError();
    setCollé(true);
    void regenerate(messageId ? { messageId } : undefined);
  }

  const dernierIndex = messages.length - 1;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={zoneDefilement} onScroll={surDefilement} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-6 py-16 text-center sm:py-24">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
                <Bot className="size-6" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Comment puis-je vous aider ?</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Les réponses s&apos;appuient sur plusieurs fournisseurs gratuits, avec bascule automatique.
                </p>
              </div>
              <div className="grid w-full gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => envoyer(s)}
                    className="rounded-xl border px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <Message
              key={m.id}
              message={m}
              dernier={i === dernierIndex}
              enCours={occupe && i === dernierIndex && m.role === "assistant"}
              occupe={occupe}
              onRegenerer={m.role === "assistant" ? () => regenerer(i === dernierIndex ? undefined : m.id) : undefined}
              onEditer={m.role === "user" ? (t) => editer(i, t) : undefined}
            />
          ))}
          {status === "submitted" && messages.at(-1)?.role === "user" && (
            <Message
              message={{ id: "attente", role: "assistant", parts: [] }}
              dernier
              enCours
              occupe
            />
          )}
          {error && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span>{error.message}</span>
              <Button size="xs" variant="outline" onClick={() => regenerer()}>
                Réessayer
              </Button>
            </div>
          )}
        </div>
      </div>
      {!collé && messages.length > 0 && (
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Aller en bas"
          className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full shadow-md"
          onClick={() => {
            setCollé(true);
            defilerEnBas(true);
          }}
        >
          <ArrowDown className="size-4" />
        </Button>
      )}
      <Saisie valeur={saisie} onChange={setSaisie} onEnvoyer={() => envoyer()} onArreter={() => stop()} occupe={occupe} />
    </div>
  );
}
