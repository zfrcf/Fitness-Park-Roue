"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowDown, Bot, Files, ListChecks, Loader2 } from "lucide-react";
import Link from "next/link";
import type { TachePublique } from "@/lib/db/taches";
import { detecterTacheLongue } from "@/lib/taches/detecter";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Explorateur } from "@/components/explorateur/explorateur";
import { blocOuvert } from "@/lib/fichiers/extraire";
import { statsModifications, type StatsModifications } from "@/lib/fichiers/explorateur";
import { useSondage } from "@/hooks/use-sondage";
import type { FluxTache } from "@/lib/taches/flux";
import { allegerHistorique, LIMITE_ENVOI_OCTETS, tailleEnvoi } from "@/lib/fichiers/pieces-jointes";
import { fichiersDuDepot, preparerPiecesJointes, type PiecesPreparees } from "./pieces-jointes";
import { toast } from "sonner";
import { signalerMajConversations } from "@/components/coque/barre-laterale";
import { Button } from "@/components/ui/button";
import type { MessageUI } from "@/lib/chat/types";
import { Message } from "./message";
import { fusionnerProjetDetaille } from "@/lib/fichiers/projet";
import { estimerTokens } from "@/lib/chat/contexte";
import { formatNombre } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useReglages } from "./reglages-contexte";
import { Saisie } from "./saisie";
import { lirePremierMessage, messageErreurLisible } from "./utils";

const SUGGESTIONS = [
  "Résume cet article : https://fr.wikipedia.org/wiki/Fitness",
  "Rédige un message pour relancer un adhérent inactif, ton chaleureux",
  "Explique-moi la différence entre marge brute et marge nette avec un exemple",
  "Propose un plan de réunion d'équipe de 30 minutes",
];

const PIECES_VIDES: PiecesPreparees = { images: [], fichiers: [], ignores: [], erreurs: [] };

/* Préférences de l'explorateur (par navigateur) : ouvert/fermé et largeur du panneau. */
const CLE_EXPLORATEUR = "atelier:explorateur";
const CLE_LARGEUR = "atelier:explorateur:largeur";
const abonnesPref = new Set<() => void>();
function lirePref(cle: string): string | null {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
}
function ecrirePref(cle: string, valeur: string) {
  try {
    localStorage.setItem(cle, valeur);
  } catch {
    /* stockage indisponible : préférence non retenue */
  }
  abonnesPref.forEach((f) => f());
}
function usePref(cle: string, defaut: string): string {
  return useSyncExternalStore(
    (f) => {
      abonnesPref.add(f);
      return () => abonnesPref.delete(f);
    },
    () => lirePref(cle) ?? defaut,
    () => defaut,
  );
}

function texteDe(m: MessageUI | undefined): string {
  return m ? m.parts.filter((p) => p.type === "text").map((p) => p.text).join("") : "";
}

export function FenetreChat({
  conversationId,
  messagesInitiaux = [],
  tacheInitiale,
}: {
  conversationId: string;
  messagesInitiaux?: MessageUI[];
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
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ conversationId, reglages }),
      // Images et fichiers joints : envoyés avec le nouveau message seulement, le serveur reprend
      // ceux de l'historique en base (limite de 4,5 Mo par requête sur Vercel).
      prepareSendMessagesRequest: ({ id, messages: liste, body, trigger, messageId }) => ({
        body: { ...body, id, messages: allegerHistorique(liste), trigger, messageId },
      }),
    }),
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
    if (messagesInitiaux.length > 0 || messageInitialEnvoye.current) return;
    const t = setTimeout(() => {
      if (messageInitialEnvoye.current) return;
      const premier = lirePremierMessage(sessionStorage, Date.now());
      messageInitialEnvoye.current = true;
      if (!premier) return;
      void sendMessage({ text: premier }, { body: { rechercheWeb: false } });
      if (!urlRemplacee.current) {
        urlRemplacee.current = true;
        window.history.replaceState(null, "", `/c/${conversationId}`);
        setTimeout(signalerMajConversations, 800);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [sendMessage, conversationId, messagesInitiaux.length]);

  // Conversation pilotée par une tâche de fond : on suit la tâche et on recharge les messages ajoutés par le serveur.
  const tacheId = tache?.id;
  const [rechargement, setRechargement] = useState(0);
  useEffect(() => {
    if (!tacheId) return;
    let actif = true;
    const tic = async () => {
      try {
        const rt = await fetch(`/api/taches/${tacheId}`, { cache: "no-store" });
        if (rt.ok && actif) {
          const { tache: t } = (await rt.json()) as { tache: TachePublique };
          // Conserver l'objet précédent si identique (évite de recréer l'effet à chaque tic).
          setTache((prev) => (prev && JSON.stringify(prev) === JSON.stringify(t) ? prev : t));
        }
        if (occupe || !actif) return;
        const rc = await fetch(`/api/conversations/${conversationId}`, { cache: "no-store" });
        if (!rc.ok || !actif) return;
        const { messages: serveur } = (await rc.json()) as { messages: MessageUI[] };
        setMessages((prev) => {
          // Course persistance (onEnd) / premier sondage : ne pas remplacer par une liste plus courte.
          if (serveur.length < prev.length && prev.at(-1)?.role === "assistant") return prev;
          const memeFin = prev.length === serveur.length && prev.at(-1)?.id === serveur.at(-1)?.id && texteDe(prev.at(-1)) === texteDe(serveur.at(-1));
          return memeFin ? prev : serveur;
        });
      } catch {
        /* réessai au prochain tic */
      }
    };
    if (rechargement) void tic(); // la réponse en direct vient d'être enregistrée : on la charge tout de suite
    const id = setInterval(() => void tic(), tacheActive ? 4000 : 20_000);
    return () => {
      actif = false;
      clearInterval(id);
    };
  }, [tacheId, tacheActive, occupe, conversationId, setMessages, rechargement]);

  // Tâche de fond : la réponse qu'elle est en train d'écrire s'affiche en direct dans la conversation.
  const [flux, setFlux] = useState<FluxTache | null>(null);
  const fluxPrecedent = useRef<FluxTache | null>(null);
  const suivreFlux = tacheActive && !occupe;
  useSondage(
    useCallback(
      async (signal: AbortSignal) => {
        const r = await fetch(`/api/conversations/${conversationId}/flux`, { cache: "no-store", signal });
        if (!r.ok) return;
        const { flux: f } = (await r.json()) as { flux: FluxTache | null };
        if (!f && fluxPrecedent.current) setRechargement((n) => n + 1);
        fluxPrecedent.current = f;
        setFlux((prev) => (prev?.maj === f?.maj ? prev : f));
      },
      [conversationId],
    ),
    suivreFlux ? 1500 : null,
  );
  const fluxVisible = suivreFlux && flux?.texte ? flux : null;
  const messagesAffiches = useMemo<MessageUI[]>(() => {
    if (!fluxVisible) return messages;
    // Réponse déjà enregistrée (le flux n'est pas encore effacé) : pas de doublon.
    if (messages.at(-1)?.role === "assistant" && texteDe(messages.at(-1)) === fluxVisible.texte) return messages;
    return [...messages, { id: "flux-tache", role: "assistant", parts: [{ type: "text", text: fluxVisible.texte }] } as MessageUI];
  }, [messages, fluxVisible]);

  // Défilement : on suit le bas tant que l'utilisateur n'a pas remonté. Tout geste vers le haut
  // (molette, doigt, barre) décolle immédiatement ; on recolle seulement une fois revenu tout en bas.
  const dernierScrollTop = useRef(0);
  const defilerEnBas = useCallback((lisse = false) => {
    const el = zoneDefilement.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: lisse ? "smooth" : "auto" });
    // Position RÉELLE après défilement (≈ scrollHeight - clientHeight), pas scrollHeight : sinon dès que
    // le contenu dépasse l'écran, surDefilement croit qu'on a remonté et « décolle » tout seul. (#19)
    dernierScrollTop.current = el.scrollTop;
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

  // Explorateur en direct : projet y compris la réponse en cours d'écriture, état avant la dernière
  // réponse (décorations U/M et lignes modifiées) et fichier en train d'être écrit.
  const messagesDirect = useDeferredValue(messagesAffiches);
  const projetDirect = useMemo(() => fusionnerProjetDetaille(messagesDirect).fichiers, [messagesDirect]);
  const precedents = useMemo(() => {
    const fin = messagesDirect.at(-1)?.role === "assistant" ? messagesDirect.slice(0, -1) : messagesDirect;
    return new Map(fusionnerProjetDetaille(fin).fichiers.map((f) => [f.chemin, f.contenu]));
  }, [messagesDirect]);
  const derniereReponse = messagesDirect.at(-1);
  const enEcriture = useMemo(
    () => ((occupe || !!fluxVisible) && derniereReponse?.role === "assistant" ? blocOuvert(texteDe(derniereReponse)) : null),
    [occupe, fluxVisible, derniereReponse],
  );
  const explorateurOuvert = usePref(CLE_EXPLORATEUR, "1") === "1" && projetDirect.length > 0;
  const largeurExplorateur = Math.max(380, Number(usePref(CLE_LARGEUR, "760")) || 760);
  const basculerExplorateur = useCallback(() => ecrirePref(CLE_EXPLORATEUR, lirePref(CLE_EXPLORATEUR) === "0" ? "1" : "0"), []);
  useEffect(() => {
    const clavier = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        basculerExplorateur();
      }
    };
    const ouvrir = () => ecrirePref(CLE_EXPLORATEUR, "1");
    window.addEventListener("keydown", clavier);
    window.addEventListener("atelier:explorateur", basculerExplorateur); // menu de l'application de bureau
    window.addEventListener("atelier:ouvrir-fichier", ouvrir);
    return () => {
      window.removeEventListener("keydown", clavier);
      window.removeEventListener("atelier:explorateur", basculerExplorateur);
      window.removeEventListener("atelier:ouvrir-fichier", ouvrir);
    };
  }, [basculerExplorateur]);
  function redimensionner(e: React.PointerEvent) {
    e.preventDefault();
    const deplacer = (ev: PointerEvent) => {
      const l = Math.min(window.innerWidth - 420, Math.max(380, window.innerWidth - ev.clientX));
      ecrirePref(CLE_LARGEUR, String(Math.round(l)));
    };
    const finir = () => {
      window.removeEventListener("pointermove", deplacer);
      window.removeEventListener("pointerup", finir);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", deplacer);
    window.addEventListener("pointerup", finir);
  }

  // État du projet (fusion des fichiers de toutes les réponses) et taille estimée du contexte.
  const messagesStables = occupe ? messages.slice(0, -1) : messages;
  const { fichiers: projet, echecs, instantanes } = useMemo(() => fusionnerProjetDetaille(messagesStables, { instantanes: true }), [messagesStables]);
  // « +N −M » de chaque réponse qui a changé le projet.
  const modificationsParMessage = useMemo(() => {
    const out = new Map<string, StatsModifications>();
    for (const [id, inst] of instantanes ?? []) out.set(id, statsModifications(inst.avant, inst.apres));
    return out;
  }, [instantanes]);
  // Estimation du contexte réellement envoyé : texte des messages + contenu des pages lues
  // (réinjecté au modèle) + état du projet (renvoyé à chaque tour). (#41)
  const tokensContexte = useMemo(() => {
    let n = 0;
    for (const m of messagesStables) {
      for (const p of m.parts) {
        if (p.type === "text") n += estimerTokens(p.text);
        else if (p.type === "data-page-lue") {
          const contenu = (p.data as { contenu?: string } | undefined)?.contenu;
          if (contenu) n += estimerTokens(contenu);
        }
      }
    }
    n += projet.reduce((s, f) => s + estimerTokens(f.contenu), 0);
    return n;
  }, [messagesStables, projet]);

  function premiereFois() {
    if (urlRemplacee.current) return;
    urlRemplacee.current = true;
    window.history.replaceState(null, "", `/c/${conversationId}`);
    setTimeout(signalerMajConversations, 800);
  }

  // Pièces jointes en attente d'envoi.
  const [pieces, setPieces] = useState<PiecesPreparees>(PIECES_VIDES);
  const [preparation, setPreparation] = useState(false);
  const [depotSurvol, setDepotSurvol] = useState(false);
  async function ajouterFichiers(liste: Array<{ fichier: File; chemin?: string }>) {
    setPreparation(true);
    try {
      const p = await preparerPiecesJointes(liste);
      p.erreurs.forEach((e) => toast.error(e));
      setPieces((avant) => {
        // Même chemin joint deux fois : la nouvelle version remplace l'ancienne.
        const chemins = new Set(p.fichiers.map((f) => f.chemin));
        return {
          images: [...avant.images, ...p.images].slice(0, 4),
          fichiers: [...avant.fichiers.filter((f) => !chemins.has(f.chemin)), ...p.fichiers],
          ignores: [...avant.ignores, ...p.ignores],
          erreurs: [],
        };
      });
    } finally {
      setPreparation(false);
    }
  }

  function envoyer(texte = saisie) {
    const t = texte.trim();
    const avecPieces = pieces.images.length > 0 || pieces.fichiers.length > 0;
    if ((!t && !avecPieces) || occupe || preparation) return;
    const parts: MessageUI["parts"] = [];
    if (t) parts.push({ type: "text", text: t });
    parts.push(...pieces.images);
    if (pieces.fichiers.length || pieces.ignores.length) parts.push({ type: "data-fichiers-joints", data: { fichiers: pieces.fichiers, ignores: pieces.ignores } });
    if (tailleEnvoi(parts) > LIMITE_ENVOI_OCTETS) {
      toast.error("Pièces jointes trop lourdes pour un seul message (3,5 Mo au plus) : retirez-en une partie.");
      return;
    }
    clearError();
    void sendMessage({ parts }, { body: { rechercheWeb } });
    setSaisie("");
    setPieces(PIECES_VIDES);
    setCollé(true);
    premiereFois();
  }

  function editer(index: number, texte: string) {
    if (occupe) return;
    clearError();
    // Les pièces jointes du message édité sont conservées ; seul le texte change.
    const joints = messages[index]?.parts.filter((p) => p.type === "file" || p.type === "data-fichiers-joints") ?? [];
    setMessages((prev) => prev.slice(0, index));
    void sendMessage({ parts: [{ type: "text", text: texte }, ...joints] }, { body: { rechercheWeb } });
    setCollé(true);
  }

  function regenerer(messageId?: string) {
    if (occupe) return;
    clearError();
    setCollé(true);
    void regenerate({ ...(messageId ? { messageId } : {}), body: { rechercheWeb } });
  }

  const dernierIndex = messagesAffiches.length - 1;

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
        body: JSON.stringify({ conversationId, objectif: dernierUser ? dernierUser.parts.filter((p) => p.type === "text").map((p) => p.text).join("").slice(0, 120) : "Poursuivre le travail en cours", compiler: true, auto: true }),
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
    <div className="flex min-h-0 flex-1">
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setDepotSurvol(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDepotSurvol(false);
      }}
      onDrop={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setDepotSurvol(false);
        void fichiersDuDepot(e.dataTransfer).then((l) => {
          if (l.length) void ajouterFichiers(l);
        });
      }}
    >
      {depotSurvol && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/85 text-sm font-medium">
          Déposez vos fichiers, dossiers, archives .zip, PDF ou images
        </div>
      )}
      {projetDirect.length > 0 && !explorateurOuvert && (
        <Button
          size="sm"
          variant="outline"
          className="absolute top-2 right-3 z-20 shadow-sm"
          onClick={basculerExplorateur}
          title="Ouvrir l'explorateur de fichiers (Ctrl+Maj+E)"
        >
          {enEcriture ? <Loader2 className="animate-spin" /> : <Files />} Fichiers · {projetDirect.length}
        </Button>
      )}
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
          {messagesAffiches.map((m, i) => (
            <Message
              key={m.id}
              message={m}
              dernier={i === dernierIndex}
              enCours={(occupe && i === dernierIndex && m.role === "assistant") || m.id === "flux-tache"}
              occupe={occupe}
              conversationId={conversationId}
              onRegenerer={m.role === "assistant" ? () => regenerer(i === dernierIndex ? undefined : m.id) : undefined}
              onEditer={m.role === "user" ? (t) => editer(i, t) : undefined}
              onEnvoyer={(t) => envoyer(t)}
              projet={m.role === "assistant" && i === messages.length - 1 && projet.length > 0 ? projet : undefined}
              avertissements={m.role === "assistant" ? echecs.filter((e) => e.messageId === m.id).map((e) => `${e.chemin} : ${e.raison}`) : undefined}
              modifications={modificationsParMessage.get(m.id)}
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
              <span>{messageErreurLisible(error)}</span>
              <Button size="xs" variant="outline" onClick={() => regenerer()}>
                Réessayer
              </Button>
            </div>
          )}
        </div>
      </div>
      {!collé && messages.length > 0 && (
        // Flotte juste au-dessus de la zone de saisie (dans le flux) au lieu d'un bottom-24 absolu qui
        // recouvrait la saisie. (#19)
        <div className="pointer-events-none relative z-10 mx-auto -mt-11 flex w-full justify-center">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Aller en bas"
            className="pointer-events-auto rounded-full shadow-md"
            onClick={() => {
              setCollé(true);
              defilerEnBas(true);
            }}
          >
            <ArrowDown className="size-4" />
          </Button>
        </div>
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
        pieces={pieces}
        preparation={preparation}
        onAjouterFichiers={(l) => void ajouterFichiers(l)}
        onRetirerImage={(i) => setPieces((p) => ({ ...p, images: p.images.filter((_, j) => j !== i) }))}
        onRetirerFichiers={(origine) => setPieces((p) => ({ ...p, fichiers: p.fichiers.filter((f) => (f.origine ?? f.chemin) !== origine) }))}
      />
    </div>
    {explorateurOuvert && (
      <>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionner l'explorateur"
          onPointerDown={redimensionner}
          className="hidden w-1 shrink-0 cursor-col-resize border-l bg-border/40 transition-colors hover:bg-primary/40 lg:block"
        />
        <Explorateur
          fichiers={projetDirect}
          precedents={precedents}
          enEcriture={enEcriture}
          onFermer={basculerExplorateur}
          className="fixed inset-0 z-40 lg:static lg:z-auto lg:w-[var(--largeur-explorateur)] lg:shrink-0"
          style={{ ["--largeur-explorateur" as string]: `${largeurExplorateur}px` }}
        />
      </>
    )}
    </div>
  );
}
