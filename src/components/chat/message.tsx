"use client";

import { AlertCircle, Bot, Brain, ChevronDown, Check, ExternalLink, FileText, Globe, Loader2, Pencil, RefreshCw, RotateCcw, Search, Sparkles, Wrench, X } from "lucide-react";
import { memo, useMemo, useState } from "react";

function texteDe(m: MessageUI): string {
  return partiesVisibles(m)
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MessageUI, MetaMessage } from "@/lib/chat/types";
import { formatNombre } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BoutonCopier } from "./bloc-code";
import { BoutonRetour } from "./bouton-retour";
import { Markdown } from "./markdown";
import { estProjetConstructible, extraireFichiers } from "@/lib/fichiers/extraire";
import { pagesHtml } from "@/lib/fichiers/apercu";
import { BoutonApercu } from "./apercu-web";
import type { StatsModifications } from "@/lib/fichiers/explorateur";
import { ResumeModifications } from "./compteur-lignes";
import { ImagesGenerees, PiecesDuMessage } from "./pieces-message";
import type { FichierProjet } from "@/lib/fichiers/projet";
import { estimerTokens } from "@/lib/chat/contexte";
import { BoutonCompiler, ListeCompilations, useCompilations } from "./carte-compilation";
import { PanneauFichiers } from "./panneau-fichiers";
import { analyserMessageAutomatique, partiesVisibles, type MessageAutomatique } from "./utils";

/**
 * Message écrit par l'application (correction après une compilation échouée, relance d'une tâche
 * de fond) : carte compacte avec les erreurs, journal complet dépliable, au lieu d'une grande bulle.
 */
function CarteMessageAutomatique({ auto, texte }: { auto: MessageAutomatique; texte: string }) {
  const [ouvert, setOuvert] = useState(false);
  const correction = auto.type === "correction";
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {correction ? <Wrench className="size-3.5 text-amber-600" /> : <RotateCcw className="size-3.5 text-muted-foreground" />}
        <span className="font-medium">{correction ? "Compilation échouée : correction demandée" : "Relance automatique de la tâche de fond"}</span>
        {auto.nbErreurs !== null && (
          <span className="rounded bg-red-500/10 px-1.5 text-red-700 dark:text-red-400">
            {auto.nbErreurs} erreur{auto.nbErreurs > 1 ? "s" : ""}
          </span>
        )}
        <button type="button" onClick={() => setOuvert((o) => !o)} className="ml-auto text-muted-foreground underline decoration-dotted underline-offset-2">
          {ouvert ? "masquer" : correction ? "journal complet" : "message complet"}
        </button>
      </div>
      {!ouvert && correction && auto.erreurs.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-red-700 dark:text-red-400">
          {auto.erreurs.map((e, i) => (
            <li key={i} className="truncate" title={e}>
              {e}
            </li>
          ))}
        </ul>
      )}
      {!ouvert && !correction && <p className="mt-1 truncate text-muted-foreground">{texte.split("\n")[0]}</p>}
      {ouvert && <pre className="mt-2 max-h-80 overflow-auto rounded bg-background p-2 font-mono text-[11px] whitespace-pre-wrap">{correction ? (auto.journal ?? texte) : texte}</pre>}
    </div>
  );
}

function MetaReponse({ meta, enCours, texte }: { meta?: MetaMessage; enCours?: boolean; texte?: string }) {
  if (!meta?.fournisseur) return null;
  const u = meta.usage;
  const sep = <span aria-hidden className="text-border">·</span>;
  const enDirect = enCours && !(u && u.total > 0) && texte;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
      <span className="font-medium">{meta.fournisseur}</span>
      {sep}
      <span className="font-mono">{meta.modele}</span>
      {enDirect && (
        <>
          {sep}
          <span className="tabular-nums" title="estimation pendant la génération (≈ 3,2 caractères par token)" aria-live="polite">
            ≈ {formatNombre(estimerTokens(texte))} tokens
          </span>
        </>
      )}
      {u && u.total > 0 && (
        <>
          {sep}
          <span title="tokens d'entrée → tokens de sortie">
            {formatNombre(u.entree)} → {formatNombre(u.sortie)} tokens
          </span>
        </>
      )}
      {meta.cout ? (
        <>
          {sep}
          <span>{meta.cout.toFixed(4)} $</span>
        </>
      ) : null}
      {meta.neurons ? (
        <>
          {sep}
          <span title="Cloudflare Workers AI : 10 000 neurons gratuits par jour">{meta.neurons} neurons</span>
        </>
      ) : null}
      {meta.dureeMs ? (
        <>
          {sep}
          <span>{(meta.dureeMs / 1000).toFixed(1).replace(".", ",")} s</span>
        </>
      ) : null}
      {meta.bascules && meta.bascules.length > 0 && (
        <>
          {sep}
          <Tooltip>
            <TooltipTrigger render={<span className="cursor-help underline decoration-dotted" />}>
              {meta.bascules.length} bascule{meta.bascules.length > 1 ? "s" : ""}
            </TooltipTrigger>
            <TooltipContent>
              <ul className="list-disc pl-3">
                {meta.bascules.map((b, i) => (
                  <li key={i}>
                    {b.de} → {b.vers} : {b.raison}
                    {b.continuation ? " (reprise à la suite)" : ""}
                  </li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        </>
      )}
      {meta.resume && (
        <>
          {sep}
          <span title="Les anciens messages ont été résumés pour tenir dans le contexte">historique résumé</span>
        </>
      )}
    </div>
  );
}

type PageLue = Extract<MessageUI["parts"][number], { type: "data-page-lue" }>["data"];

const SOURCES: Record<PageLue["source"], string> = { direct: "lecture directe", jina: "via Jina Reader", pdf: "PDF" };

function PastillesPages({ pages }: { pages: PageLue[] }) {
  if (!pages.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Pages lues">
      {pages.map((p) => {
        const Icone = !p.ok ? AlertCircle : p.source === "pdf" ? FileText : Globe;
        let hote = p.url;
        try {
          hote = new URL(p.url).hostname.replace(/^www\./, "");
        } catch {
          /* brut */
        }
        return (
          <li key={p.url}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "inline-flex max-w-[280px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted",
                      !p.ok && "border-destructive/40 text-destructive",
                    )}
                  />
                }
              >
                <Icone className="size-3.5 shrink-0" />
                <span className="truncate">{p.ok ? p.titre : hote}</span>
                {p.ok && p.condense && <Sparkles className="size-3 shrink-0 text-muted-foreground" />}
                <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {p.ok ? (
                  <>
                    <p className="font-medium">{p.titre}</p>
                    <p className="text-xs opacity-80">
                      {hote} · {SOURCES[p.source]} · {Intl.NumberFormat("fr-FR").format(p.caracteres)} caractères
                      {p.condense ? " · condensée pour tenir dans le contexte" : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-xs">Page non lue : {p.erreur}</p>
                )}
              </TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

type Recherche = Extract<MessageUI["parts"][number], { type: "data-recherche" }>["data"];

function Recherches({ liste }: { liste: Recherche[] }) {
  const [ouvert, setOuvert] = useState<string | null>(null);
  if (!liste.length) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label="Recherches web">
      {liste.map((r, i) => {
        const cle = `${i}-${r.requete}`;
        const estOuvert = ouvert === cle;
        return (
          <li key={cle} className="rounded-lg border bg-muted/30 text-sm">
            <button
              type="button"
              onClick={() => setOuvert(estOuvert ? null : cle)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground"
              aria-expanded={estOuvert}
              disabled={r.etat === "en-cours"}
            >
              {r.etat === "en-cours" ? <Loader2 className="size-3.5 animate-spin" /> : r.etat === "erreur" ? <AlertCircle className="size-3.5 text-destructive" /> : <Search className="size-3.5" />}
              <span className="truncate">
                {r.etat === "en-cours" ? "Recherche web en cours : " : r.etat === "erreur" ? "Recherche web impossible : " : "Recherche web : "}
                <span className="text-foreground">{r.requete}</span>
                {r.etat === "ok" && r.resultats ? ` · ${r.resultats.length} résultat${r.resultats.length > 1 ? "s" : ""}${r.moteur ? ` (${r.moteur})` : ""}` : ""}
              </span>
              {r.etat !== "en-cours" && <ChevronDown className={cn("ml-auto size-3.5 shrink-0 transition-transform", estOuvert && "rotate-180")} />}
            </button>
            {estOuvert && r.etat === "erreur" && <p className="border-t px-3 py-2 text-xs text-destructive">{r.erreur}</p>}
            {estOuvert && r.etat === "ok" && (
              <ol className="flex flex-col gap-1.5 border-t px-3 py-2">
                {(r.resultats ?? []).map((x, j) => (
                  <li key={x.url} className="text-xs">
                    <a href={x.url} target="_blank" rel="noopener noreferrer" className="font-medium underline decoration-dotted underline-offset-2">
                      {j + 1}. {x.titre}
                    </a>
                    <span className="block truncate text-muted-foreground">{x.url}</span>
                    {x.extrait && <span className="block text-muted-foreground">{x.extrait}</span>}
                  </li>
                ))}
              </ol>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Raisonnement({ texte, enCours }: { texte: string; enCours: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  if (!texte.trim()) return null;
  return (
    <div className="mb-2 rounded-lg border bg-muted/30 text-sm">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground"
        aria-expanded={ouvert}
      >
        <Brain className="size-3.5" />
        {enCours ? "Raisonnement en cours…" : "Raisonnement"}
        <ChevronDown className={cn("ml-auto size-3.5 transition-transform", ouvert && "rotate-180")} />
      </button>
      {ouvert && <div className="border-t px-3 py-2 whitespace-pre-wrap text-muted-foreground">{texte}</div>}
    </div>
  );
}

function PanneauFichiersAvecCompilation({
  fichiers,
  projet,
  avertissements,
  conversationId,
  messageId,
  occupe,
  onEnvoyer,
  modifications,
}: {
  /** Lignes ajoutées / supprimées par ce message (+N −M). */
  modifications?: StatsModifications;
  /** Fichiers produits par ce message. */
  fichiers: ReturnType<typeof extraireFichiers>;
  /** État complet du projet de la conversation (dernier message seulement). */
  projet?: FichierProjet[];
  /** Modifications partielles de ce message qui n'ont pas pu être appliquées. */
  avertissements?: string[];
  conversationId?: string;
  messageId: string;
  occupe: boolean;
  onEnvoyer?: (texte: string) => void;
}) {
  // Sur le dernier message, on montre, télécharge et compile le projet complet ; les fichiers de ce message sont marqués.
  const complet = projet && projet.length > fichiers.length ? projet : undefined;
  const affiches = complet ?? fichiers;
  // Fichiers touchés par CE message : ceux renvoyés en entier et ceux modifiés par bloc ```modif.
  const modifies = useMemo(
    () => (complet ? new Set([...fichiers.map((f) => f.chemin), ...complet.filter((f) => f.messageId === messageId).map((f) => f.chemin)]) : undefined),
    [complet, fichiers, messageId],
  );
  const constructible = estProjetConstructible(affiches) && !!conversationId && !!projet;
  const apercu = pagesHtml(affiches).length > 0 ? <BoutonApercu fichiers={affiches} /> : null;
  const liste = useMemo(() => affiches.map((f) => ({ chemin: f.chemin, contenu: f.contenu })), [affiches]);
  const { liste: compilations, compiler, lancement, enCours, majCompilation } = useCompilations(constructible ? conversationId : undefined, messageId, liste);
  const titre = complet ? `Projet complet : ${complet.length} fichiers` : undefined;
  const nbModifies = modifies?.size ?? fichiers.length;
  const sousTitre = complet && nbModifies > 0 ? `${nbModifies} modifié${nbModifies > 1 ? "s" : ""} dans cette réponse` : complet ? "aucun fichier modifié dans cette réponse" : undefined;
  const alerte = avertissements?.length ? (
    <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
      <p className="font-medium">Modifications non appliquées (le texte à remplacer ne correspond pas au fichier) :</p>
      <ul className="mt-1 list-disc pl-4">
        {avertissements.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      {onEnvoyer && !occupe && (
        <Button size="xs" variant="outline" className="mt-2" onClick={() => onEnvoyer("Ces modifications n'ont pas pu être appliquées : renvoie ces fichiers en entier, chacun dans son bloc de code avec son chemin.")}>
          Demander les fichiers entiers
        </Button>
      )}
    </div>
  ) : null;
  if (!constructible) {
    return (
      <>
        {alerte}
        <PanneauFichiers fichiers={affiches} titre={titre} sousTitre={sousTitre} modifies={modifies} stats={modifications} actions={apercu} />
      </>
    );
  }
  return (
    <>
      {alerte}
      <PanneauFichiers
        fichiers={affiches}
        titre={titre}
        sousTitre={sousTitre}
        modifies={modifies}
        stats={modifications}
        actions={
          <>
            {apercu}
            <BoutonCompiler onClick={() => void compiler()} occupe={lancement || enCours} />
          </>
        }
        pied={<ListeCompilations liste={compilations} onDemanderCorrection={occupe ? undefined : onEnvoyer} onMaj={majCompilation} />}
      />
    </>
  );
}

export interface PropsMessage {
  message: MessageUI;
  dernier: boolean;
  enCours: boolean;
  occupe: boolean;
  conversationId?: string;
  onRegenerer?: () => void;
  onEditer?: (texte: string) => void;
  /** Envoie un nouveau message utilisateur (demande de correction après compilation). */
  onEnvoyer?: (texte: string) => void;
  /** État complet du projet de la conversation (fourni au dernier message de l'assistant). */
  projet?: FichierProjet[];
  /** Modifications partielles (blocs modif) de ce message non appliquées, à signaler. */
  avertissements?: string[];
  /** Lignes ajoutées / supprimées par ce message dans le projet (+N −M). */
  modifications?: StatsModifications;
}

export const Message = memo(function Message({ message: m, dernier, enCours, occupe, conversationId, onRegenerer, onEditer, onEnvoyer, projet, avertissements, modifications }: PropsMessage) {
  const [edition, setEdition] = useState(false);
  const fichiers = useMemo(() => (m.role === "assistant" && !enCours ? extraireFichiers(texteDe(m)) : []), [m, enCours]);
  const automatique = useMemo(() => (m.role === "user" ? analyserMessageAutomatique(m.id, texteDe(m)) : null), [m]);
  const [brouillon, setBrouillon] = useState("");
  const parts = partiesVisibles(m);
  const texte = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
  const raisonnement = parts
    .filter((p) => p.type === "reasoning")
    .map((p) => p.text)
    .join("");
  const pages = m.parts.filter((p) => p.type === "data-page-lue").map((p) => p.data);
  const recherches = m.parts.filter((p) => p.type === "data-recherche").map((p) => p.data);
  const estUtilisateur = m.role === "user";

  if (estUtilisateur && automatique) return <CarteMessageAutomatique auto={automatique} texte={texte} />;

  if (estUtilisateur) {
    return (
      <div className="group flex flex-col items-end gap-1">
        {edition ? (
          <form
            className="w-full max-w-[85%]"
            onSubmit={(e) => {
              e.preventDefault();
              if (brouillon.trim()) onEditer?.(brouillon.trim());
              setEdition(false);
            }}
          >
            <Textarea value={brouillon} onChange={(e) => setBrouillon(e.target.value)} autoFocus rows={3} className="min-h-20" aria-label="Modifier le message" onKeyDown={(e) => {
              if (e.key === "Escape") setEdition(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }} />
            <div className="mt-1.5 flex justify-end gap-1.5">
              <Button type="button" size="sm" variant="ghost" onClick={() => setEdition(false)}>
                <X /> Annuler
              </Button>
              <Button type="submit" size="sm" disabled={!brouillon.trim()}>
                <Check /> Envoyer
              </Button>
            </div>
          </form>
        ) : (
          <>
            {texte && <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">{texte}</div>}
            <PiecesDuMessage message={m} />
            <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <BoutonCopier texte={texte} />
              {onEditer && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={occupe}
                  onClick={() => {
                    setBrouillon(texte);
                    setEdition(true);
                  }}
                >
                  <Pencil /> <span className="hidden sm:inline">Modifier</span>
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="group flex gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <Bot className="size-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Recherches liste={recherches} />
        <PastillesPages pages={pages} />
        <Raisonnement texte={raisonnement} enCours={enCours && !texte} />
        {texte ? (
          <Markdown texte={texte} />
        ) : enCours ? (
          <div className="flex h-7 items-center text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : null}
        <ImagesGenerees message={m} />
        {/* Panneau projet : visible dès que CE message a des fichiers OU que le projet accumulé en a
            un (fourni au dernier message), même si la dernière réponse est de la prose. (#39) */}
        {fichiers.length > 0 || (projet && projet.length > 0) ? (
          <PanneauFichiersAvecCompilation
            fichiers={fichiers}
            projet={projet}
            avertissements={avertissements}
            conversationId={conversationId}
            messageId={m.id}
            occupe={occupe}
            onEnvoyer={onEnvoyer}
            modifications={modifications}
          />
        ) : (
          // Réponse qui ne fait que modifier (blocs modif) : résumé « N fichiers modifiés +a −b ».
          modifications && modifications.fichiers.length > 0 && !enCours && <ResumeModifications stats={modifications} />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <MetaReponse meta={m.metadata} enCours={enCours} texte={texte} />
          {!enCours && (
            <div className={cn("flex gap-0.5 transition-opacity", dernier ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
              <BoutonCopier texte={texte} />
              {conversationId && m.id && <BoutonRetour conversationId={conversationId} messageId={m.id} />}
              {onRegenerer && (
                <Button type="button" variant="ghost" size="xs" disabled={occupe} onClick={onRegenerer}>
                  <RefreshCw /> <span className="hidden sm:inline">Régénérer</span>
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
