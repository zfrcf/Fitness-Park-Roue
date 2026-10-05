"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowDown, Bot, ListChecks, Loader2 } from "lucide-react";
import Link from "next/link";
import type { TachePublique } from "@/lib/db/taches";
import { detecterTacheLongue } from "@/lib/taches/detecter";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { signalerMajConversations } from "@/components/coque/barre-laterale";
import { Button } from "@/components/ui/button";
import type { MessageUI } from "@/lib/chat/types";
import { Message } from "./message";
import { fusionnerProjet } from "@/lib/fichiers/projet";
import { estimerTokens } from "@/lib/chat/contexte";
import { formatNombre } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useReglages } from "./reglages-contexte";
import { Saisie } from "./saisie";

const SUGGESTIONS = [
  "Résume cet article : https://fr.wikipedia.org/wiki/Fitness",
  "Rédige un message pour relancer un adhérent inactif, ton chaleureux",
  "Explique-moi la différence entre marge brute et marge nette avec un exemple",
  "Propose un plan de réunion d'équipe de 30 minutes",
];

function texteDe(m: MessageUI | undefined): string {
  return m ? m.parts.filter((p) => p.type === "text").map((p) => p.text).join("") : "";
}

export function FenetreChat({
  conversationId,
  messagesInitiaux = [],
  messageInitial,
  tacheInitiale,
}: {
  conversationId: string;
  messagesInitiaux?: MessageUI[];
  /** Premier message envoyé automatiquement à l'arrivée (depuis l'accueil). */
  messageInitial?: string;
  /** Tâche de fond attachée à cette conversation : bandeau et mise à jour en direct. */
  tacheInitiale?: TachePublique;
}) {
  const [saisie, setSaisie] = useState("");
  const [tache, setTache] = useState<TachePublique | undefined>(tacheInitiale);
  const [lancementTache, setLancementTache] = useState(false);
  const [suggestionRejetee, setSuggestionRejetee] = useState<string>("");
  const messageInitialEnvoye = useRef(false);
  const { reglages } = useReglages();
  const urlRemplacee = useRef(messagesInitiaux.length > 0);
  const zoneDefilement = useRef<HTMLDivElement>(null);
  const [collé, setCollé] = useState(true); // suit-on le bas de la conversation ?
  const [rechercheWeb, setRechercheWeb] = useState(false);

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
      } else if (part.type === "data-info") {
        toast.message(part.data.texte, { duration: 3000 });
      }
    },
  });

  const occupe = status === "submitted" || status === "streaming";
  const tacheActive = !!tache && (tache.statut === "en_cours" || tache.statut === "en_attente");

  // Premier message automatique (arrivée depuis l'accueil avec ?q=). Différé d'un tic : en
  // développement, React monte/démonte le composant deux fois et le premier envoi serait perdu.
  useEffect(() => {
    if (!messageInitial || messageInitialEnvoye.current) return;
    const t = setTimeout(() => {
      messageInitialEnvoye.current = true;
      void sendMessage({ text: messageInitial }, { body: { rechercheWeb: false } });
      if (!urlRemplacee.current) {
        urlRemplacee.current = true;
        window.history.replaceState(null, "", `/c/${conversationId}`);
        setTimeout(signalerMajConversations, 800);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [messageInitial, sendMessage, conversationId]);

  // Conversation pilotée par une tâche de fond : on suit la tâche et on recharge les messages ajoutés par le serveur.
  useEffect(() => {
    if (!tache) return;
    let actif = true;
    const tic = async () => {
      try {
        const rt = await fetch(`/api/taches/${tache.id}`, { cache: "no-store" });
        if (rt.ok && actif) {
          const { tache: t } = (await rt.json()) as { tache: TachePublique };
          setTache(t);
        }
        if (occupe) return;
        const rc = await fetch(`/api/conversations/${conversationId}`, { cache: "no-store" });
        if (!rc.ok || !actif) return;
        const { messages: serveur } = (await rc.json()) as { messages: MessageUI[] };
        setMessages((prev) => {
          const memeFin = prev.length === serveur.length && prev.at(-1)?.id === serveur.at(-1)?.id && texteDe(prev.at(-1)) === texteDe(serveur.at(-1));
          return memeFin ? prev : serveur;
        });
      } catch {
        /* réessai au prochain tic */
      }
    };
    const id = setInterval(() => void tic(), tacheActive ? 4000 : 20_000);
    return () => {
      actif = false;
      clearInterval(id);
    };
  }, [tache?.id, tacheActive, occupe, conversationId, setMessages, tache]);

  // Défilement : on suit le bas tant que l'utilisateur n'a pas remonté. Tout geste vers le haut
  // (molette, doigt, barre) décolle immédiatement ; on recolle seulement une fois revenu tout en bas.
  const dernierScrollTop = useRef(0);
  const defilerEnBas = useCallback((lisse = false) => {
    const el = zoneDefilement.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: lisse ? "smooth" : "auto" });
    dernierScrollTop.current = el.scrollHeight;
  }, []);
  useEffect(() => {
    if (collé) defilerEnBas();
  }, [messages, collé, defilerEnBas]);
  useEffect(() => {
    const el = zoneDefilement.current;
    if (!el) return;
    const decoller = () => setCollé(false);
    const molette = (e: WheelEvent) => {
      if (e.deltaY < 0) decoller();
    };
    let doigtY = 0;
    const toucheDebut = (e: TouchEvent) => {
      doigtY = e.touches[0]?.clientY ?? 0;
    };
    const toucheMouvement = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      if (y > doigtY + 4) decoller(); // le doigt descend : le contenu remonte
    };
    el.addEventListener("wheel", molette, { passive: true });
    el.addEventListener("touchstart", toucheDebut, { passive: true });
    el.addEventListener("touchmove", toucheMouvement, { passive: true });
    return () => {
      el.removeEventListener("wheel", molette);
      el.removeEventListener("touchstart", toucheDebut);
      el.removeEventListener("touchmove", toucheMouvement);
    };
  }, []);
  function surDefilement() {
    const el = zoneDefilement.current;
    if (!el) return;
    const enBas = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    if (el.scrollTop < dernierScrollTop.current - 2) setCollé(false);
    else if (enBas) setCollé(true);
    dernierScrollTop.current = el.scrollTop;
  }

  // État du projet (fusion des fichiers de toutes les réponses) et taille estimée du contexte.
  const messagesStables = occupe ? messages.slice(0, -1) : messages;
  const projet = useMemo(() => fusionnerProjet(messagesStables), [messagesStables]);
  const tokensContexte = useMemo(
    () => messagesStables.reduce((n, m) => n + estimerTokens(m.parts.filter((p) => p.type === "text").map((p) => p.text).join("")), 0),
    [messagesStables],
  );

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
    void sendMessage({ text: t }, { body: { rechercheWeb } });
    setSaisie("");
    setCollé(true);
    premiereFois();
  }

  function editer(index: number, texte: string) {
    if (occupe) return;
    clearError();
    setMessages((prev) => prev.slice(0, index));
    void sendMessage({ text: texte }, { body: { rechercheWeb } });
    setCollé(true);
  }

  function regenerer(messageId?: string) {
    if (occupe) return;
    clearError();
    setCollé(true);
    void regenerate({ ...(messageId ? { messageId } : {}), body: { rechercheWeb } });
  }

  const dernierIndex = messages.length - 1;

  // Proposition de tâche de fond : dernier message utilisateur « travaille jusqu'à… », au repos, sans tâche active.
  const dernierUser = [...messages].reverse().find((m) => m.role === "user");
  const dernierUserId = dernierUser?.id ?? "";
  const suggestionTache =
    !occupe &&
    !tacheActive &&
    conversationId !== "sans-id" &&
    !!dernierUser &&
    suggestionRejetee !== dernierUserId &&
    detecterTacheLongue(dernierUser.parts.filter((p) => p.type === "text").map((p) => p.text).join(""));

  async function lancerEnTache() {
    setLancementTache(true);
    try {
      const r = await fetch("/api/taches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, objectif: dernierUser ? dernierUser.parts.filter((p) => p.type === "text").map((p) => p.text).join("").slice(0, 500) : "Poursuivre le travail en cours", compiler: true, auto: true }),
      });
      const j = (await r.json()) as { tache?: TachePublique; erreur?: string };
      if (!r.ok || !j.tache) throw new Error(j.erreur ?? "échec");
      setTache(j.tache);
      setSuggestionRejetee(dernierUserId);
      toast.success("Tâche de fond lancée : elle continue même si vous fermez la page.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible de lancer la tâche.");
    } finally {
      setLancementTache(false);
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {tache && (
        <div className={cn("flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs", tacheActive ? "bg-primary/5" : "bg-muted/40")} role="status">
          {tacheActive ? <Loader2 className="size-3.5 animate-spin" /> : <ListChecks className="size-3.5" />}
          <span className="font-medium">Tâche de fond {tacheActive ? "en cours" : tache.statut === "terminee" ? "terminée" : tache.statut === "pause" ? "en pause" : tache.statut === "echouee" ? "échouée" : "arrêtée"}</span>
          <span className="text-muted-foreground">{tache.etape} · cycle {tache.cycles}/{tache.maxCycles}</span>
          {tacheActive && <span className="text-muted-foreground">· les nouveaux échanges apparaissent ici en direct</span>}
          <Link href="/taches" className="ml-auto underline decoration-dotted underline-offset-2">
            gérer
          </Link>
        </div>
      )}
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
              conversationId={conversationId}
              onRegenerer={m.role === "assistant" ? () => regenerer(i === dernierIndex ? undefined : m.id) : undefined}
              onEditer={m.role === "user" ? (t) => editer(i, t) : undefined}
              onEnvoyer={(t) => envoyer(t)}
              projet={m.role === "assistant" && i === dernierIndex && projet.length > 0 ? projet : undefined}
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
      {suggestionTache && (
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-4 pb-1 text-xs">
          <div className="flex flex-1 flex-wrap items-center gap-2 rounded-lg border bg-primary/5 px-3 py-2">
            <ListChecks className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              Cette demande peut tourner en <strong>tâche de fond</strong> : elle continue même si vous fermez la page, et compile en boucle jusqu&apos;au résultat.
            </span>
            <Button size="xs" disabled={lancementTache} onClick={() => void lancerEnTache()}>
              {lancementTache ? <Loader2 className="animate-spin" /> : <ListChecks />} Lancer en tâche de fond
            </Button>
            <Button size="xs" variant="ghost" aria-label="Ignorer" onClick={() => setSuggestionRejetee(dernierUserId)}>
              Ignorer
            </Button>
          </div>
        </div>
      )}
      <Saisie
        complement={messages.length > 0 ? <span className="tabular-nums" title="taille estimée de l'historique envoyé au modèle">contexte ≈ {formatNombre(tokensContexte)} tokens</span> : undefined}
        valeur={saisie}
        onChange={setSaisie}
        onEnvoyer={() => envoyer()}
        onArreter={() => stop()}
        occupe={occupe}
        rechercheWeb={rechercheWeb}
        onRechercheWeb={setRechercheWeb}
      />
    </div>
  );
}
