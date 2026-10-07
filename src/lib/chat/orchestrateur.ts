/**
 * Orchestrateur : enchaîne les fournisseurs pour produire une réponse en flux.
 * - bascule sur 429 / 402 / 401 / 5xx / timeout / coupure réseau ;
 * - si la coupure survient en plein flux, le texte déjà émis est conservé et le
 *   fournisseur suivant continue exactement à la suite ; si cette reprise échoue,
 *   la réponse est régénérée entièrement ;
 * - reste sur le même fournisseur pendant une conversation tant qu'il répond ;
 * - mémorise en KV les fournisseurs épuisés avec leur heure de réessai ;
 * - résume les anciens messages quand le contexte du suivant est plus court.
 */
import { generateText, stepCountIs, streamText, type LanguageModel, type ModelMessage, type ToolSet, type UIMessageStreamWriter } from "ai";
import { fuseauHoraire } from "@/lib/fuseau";
import type { KV } from "@/lib/kv";
import { lireQuota } from "@/lib/fournisseurs/entetes";
import { classerErreur, type ErreurClassee } from "@/lib/fournisseurs/erreurs";
import { apprendreLimites, lireLimites } from "@/lib/fournisseurs/limites";
import { reserverCreneau } from "@/lib/fournisseurs/debit";
import type { EtatFournisseur, Fournisseur, NiveauRaisonnement } from "@/lib/fournisseurs/types";
import { ajusterAuContexte, estimerTokens, INSTRUCTION_RESUME, promptResume, sansRaisonnement, texteDe, tokensMessage } from "./contexte";
import type { Bascule, MessageUI, MetaMessage, Reglages } from "./types";

export interface DepsOrchestrateur {
  /** Ne pas remettre en tête le fournisseur « collant » de la conversation. */
  ignorerPreference?: boolean;
  /** Attente maximale avant un nouvel essai sur place après une limite de débit courte (15 s par défaut). */
  attenteMaxReessaiMs?: number;
  /** Fenêtre du limiteur de débit partagé (60 s par défaut ; réduite dans les tests). */
  fenetreDebitMs?: number;
  fournisseurs: Fournisseur[];
  kv: KV;
  creerModele: (f: Fournisseur, opts: { raisonnement: NiveauRaisonnement }) => LanguageModel;
  maintenant?: () => number;
  /** Délai sans aucun octet reçu avant de considérer le fournisseur en panne. */
  delaiInactiviteMs?: number;
  /** Autorise-t-on un fournisseur payant maintenant ? (plafond mensuel) */
  autoriserPayant?: (f: Fournisseur) => Promise<boolean>;
  /** Enregistre la consommation d'un fournisseur payant (coût rapporté par l'API si disponible). */
  enregistrerDepense?: (f: Fournisseur, usage: { entree: number; sortie: number }, cout?: number) => Promise<void>;
  /** Journalisation (désactivée en test). */
  log?: (message: string) => void;
}

export interface ParamsExecution {
  writer: UIMessageStreamWriter<MessageUI>;
  messages: ModelMessage[];
  reglages: Reglages;
  conversationId: string;
  signal?: AbortSignal;
  /** Outils proposés au modèle (recherche web). Retirés automatiquement si le fournisseur les refuse. */
  outils?: ToolSet;
  /** Outil à appeler obligatoirement à la première étape (demande explicite : « génère une image… »). */
  outilImpose?: string;
  /**
   * Contrôle de la réponse terminée : renvoie une consigne si elle ne fait pas ce qui était demandé
   * (ex. modifications annoncées mais aucun fichier écrit). Le même fournisseur est alors relancé
   * une fois avec cette consigne, et sa suite est ajoutée à la même réponse.
   */
  relance?: (texte: string) => string | null;
}

export interface ResultatExecution {
  ok: boolean;
  texte: string;
  meta: MetaMessage;
  erreur?: string;
}

const PREFIXE_ETAT = "fournisseur:etat:";
const TTL_ETAT = 7 * 24 * 3600;
const PREFIXE_CONV = "conv:fournisseur:";
const TTL_CONV = 30 * 24 * 3600;
const PREFIXE_RESUME = "conv:resume:";
const TTL_RESUME = 30 * 24 * 3600;
/** Délai maximal d'un résumé/condensation de contexte : sans lui, un fournisseur lent bloquait tout. (#17) */
const TIMEOUT_RESUME_MS = 90_000;
/** Fournisseurs ayant refusé les outils (400) : on n'insiste pas pendant une heure. */
const sansOutils = new Map<string, number>();
export function fournisseurSansOutils(id: string, maintenant = Date.now()): boolean {
  const jusqua = sansOutils.get(id);
  return jusqua !== undefined && jusqua > maintenant;
}
const RE_OUTILS_REFUSES = /tool|function[_ ]call/i;

export const INSTRUCTION_CONTINUATION =
  "Ta réponse précédente a été interrompue par une coupure technique. Reprends EXACTEMENT là où elle s'est arrêtée, " +
  "au caractère près, sans répéter ce qui a déjà été écrit, sans introduction ni commentaire. " +
  "Si la réponse était déjà complète, réponds uniquement par un espace.";

/* ───────────── État des fournisseurs (même format que lib/fournisseurs/etat) ───────────── */

async function lireEtat(kv: KV, id: string, maintenant: number): Promise<EtatFournisseur> {
  const e = await kv.get<EtatFournisseur>(PREFIXE_ETAT + id);
  if (!e) return { statut: "inconnu", majA: 0 };
  if ((e.statut === "epuise" || e.statut === "erreur") && e.reessaiA && e.reessaiA <= maintenant) {
    return { ...e, statut: "disponible", reessaiA: undefined, raison: undefined };
  }
  return e;
}

async function ecrireEtat(kv: KV, id: string, e: EtatFournisseur, maintenant: number) {
  await kv.set(PREFIXE_ETAT + id, { ...e, majA: maintenant }, TTL_ETAT);
}

async function noterEchec(deps: DepsOrchestrateur, f: Fournisseur, e: ErreurClassee, maintenant: number) {
  if (!e.basculer && e.categorie !== "temporaire") return;
  const actuel = await lireEtat(deps.kv, f.id, maintenant);
  await ecrireEtat(
    deps.kv,
    f.id,
    {
      ...actuel,
      statut: e.categorie === "quota" || e.categorie === "credits" ? "epuise" : "erreur",
      reessaiA: e.reessaiA,
      raison: `${e.statut ? `HTTP ${e.statut} · ` : ""}${e.message}`.slice(0, 300),
      derniereErreurA: maintenant,
    },
    maintenant,
  );
}

async function noterReussite(deps: DepsOrchestrateur, f: Fournisseur, enTetes: Headers | Record<string, string> | undefined, maintenant: number) {
  const actuel = await lireEtat(deps.kv, f.id, maintenant);
  const quota = lireQuota(enTetes, maintenant);
  await ecrireEtat(
    deps.kv,
    f.id,
    { ...actuel, statut: "disponible", reessaiA: undefined, raison: undefined, quota: quota ?? actuel.quota, derniereReussiteA: maintenant },
    maintenant,
  );
}

/* ───────────── Ordre des fournisseurs ───────────── */

export interface Candidat {
  f: Fournisseur;
  etat: EtatFournisseur;
}

export async function ordonnerFournisseurs(deps: DepsOrchestrateur, conversationId: string): Promise<{ candidats: Fournisseur[]; indisponibles: Candidat[] }> {
  const maintenant = deps.maintenant?.() ?? Date.now();
  const prefere = deps.ignorerPreference ? null : await deps.kv.get<string>(PREFIXE_CONV + conversationId);
  const ordre = [...deps.fournisseurs];
  if (prefere) {
    const i = ordre.findIndex((f) => f.id === prefere);
    if (i > 0) ordre.unshift(...ordre.splice(i, 1));
  }
  const candidats: Fournisseur[] = [];
  const indisponibles: Candidat[] = [];
  for (const f of ordre) {
    const etat = await lireEtat(deps.kv, f.id, maintenant);
    const dispo = etat.statut !== "epuise" && etat.statut !== "erreur";
    if (!dispo) {
      indisponibles.push({ f, etat });
      continue;
    }
    if (f.payant) {
      const ok = deps.autoriserPayant ? await deps.autoriserPayant(f) : false;
      if (!ok) {
        indisponibles.push({ f, etat: { ...etat, statut: "epuise", raison: "plafond mensuel atteint ou payant désactivé" } });
        continue;
      }
    }
    candidats.push(f);
  }
  return { candidats, indisponibles };
}

/* ───────────── Outils de texte ───────────── */

/** Supprime le chevauchement si la continuation répète la fin du texte déjà émis. */
export function fusionnerContinuation(deja: string, suite: string): string {
  if (!deja || !suite) return suite;
  const max = Math.min(deja.length, suite.length, 400);
  for (let n = max; n >= 5; n--) {
    if (deja.endsWith(suite.slice(0, n))) return suite.slice(n);
  }
  // Répétition totale : la continuation ré-émet un début de réponse déjà présent.
  const debut = suite.trimStart().slice(0, 80);
  if (debut.length >= 40 && deja.includes(debut)) {
    const idx = suite.indexOf(debut);
    const resteDeja = deja.slice(deja.indexOf(debut));
    if (suite.slice(idx).startsWith(resteDeja)) return suite.slice(idx + resteDeja.length);
  }
  return suite;
}

function nomErreur(e: ErreurClassee): string {
  switch (e.categorie) {
    case "quota":
      return "quota ou limite de débit atteint";
    case "credits":
      return "crédits épuisés";
    case "auth":
      return "clé refusée";
    case "temporaire":
      return e.statut ? `erreur ${e.statut}` : "fournisseur injoignable";
    case "contexte":
      return "contexte trop long";
    default:
      return e.message.slice(0, 80);
  }
}

/* ───────────── Résumé (cache KV) ───────────── */

function hashTexte(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

function creerResumeur(deps: DepsOrchestrateur, f: Fournisseur, conversationId: string, signal?: AbortSignal) {
  return async (anciens: ModelMessage[], budgetTokens: number): Promise<string> => {
    const corps = promptResume(anciens);
    const cle = `${PREFIXE_RESUME}${conversationId}:${hashTexte(corps)}`;
    const cache = await deps.kv.get<string>(cle);
    if (cache) return cache;
    // Toujours borner le résumé dans le temps, même quand un signal utilisateur est fourni : on combine
    // les deux (annulation utilisateur OU délai maximal). Un timeout classe « temporaire » (bascule). (#17)
    const delai = AbortSignal.timeout(TIMEOUT_RESUME_MS);
    const abortSignal = signal ? AbortSignal.any([signal, delai]) : delai;
    const r = await generateText({
      model: deps.creerModele(f, { raisonnement: "aucun" }),
      system: INSTRUCTION_RESUME,
      prompt: corps,
      temperature: 0.2,
      maxOutputTokens: Math.max(200, Math.min(budgetTokens, 2000)),
      maxRetries: 0,
      abortSignal,
    });
    const texte = r.text.trim();
    if (!texte) throw new Error("résumé vide");
    await deps.kv.set(cle, texte, TTL_RESUME);
    return texte;
  };
}

/* ───────────── Une tentative sur un fournisseur ───────────── */

interface Tentative {
  /** Texte émis par cette tentative (après fusion). */
  texte: string;
  erreur?: ErreurClassee;
  usage?: { entree: number; sortie: number; total: number };
  cout?: number;
  neurons?: number;
  enTetes?: Headers | Record<string, string>;
  resume: boolean;
  /** Taille estimée de la requête envoyée (tokens), pour recalibrer en cas d'erreur de contexte. */
  tokensEstimes: number;
  /** Raison de fin renvoyée par le fournisseur ("stop", "length", "tool-calls"…). */
  finishReason?: string;
}

const attendre = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Réserve une requête dans le limiteur partagé du fournisseur. Attend si la fenêtre se libère
 * bientôt, sinon renvoie false (le fournisseur est saturé par d'autres requêtes ou tâches).
 */
async function reserverOuAttendre(deps: DepsOrchestrateur, f: Fournisseur, signal?: AbortSignal): Promise<boolean> {
  const max = deps.attenteMaxReessaiMs ?? 15_000;
  for (let essai = 0; essai < 3; essai++) {
    const c = await reserverCreneau(deps.kv, f, deps.maintenant?.() ?? Date.now(), deps.fenetreDebitMs);
    if (c.ok) return true;
    if (c.attenteMs > max || signal?.aborted) return false;
    await attendre(c.attenteMs);
  }
  return false;
}

/** Texte dégénéré : une longue suite du même caractère (ex. « !!!!!!!! »), défaut d'inférence passager. */
export function estDegenere(texte: string): boolean {
  // Signature du défaut passager de NVIDIA/Kimi : une rafale de « ! » (« ```mod!!!!!!… », « OK!!!!… »),
  // qui n'apparaît jamais dans du vrai code, même quand un court préfixe la précède.
  if (/!{16,}/.test(texte)) return true;
  // Jetons internes du modèle recrachés tels quels (« <|close|>think… ») : sortie partie en vrille.
  if (/<\|[a-z_]{2,24}\|>/i.test(texte)) return true;
  // « Salade » multilingue (Kimi K3, cas réel) : des mots chinois éparpillés au milieu de mots latins
  // sans suite logique. Une citation en chinois dans une réponse française ne fait que 1 ou 2 bascules.
  const cjk = texte.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  if (cjk >= 12) {
    const latin = texte.match(/[A-Za-zÀ-ÿ]/g)?.length ?? 0;
    const bascules = texte.match(/[A-Za-zÀ-ÿ][\s\p{P}]*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
    if (latin >= 200 && cjk / (cjk + latin) < 0.5 && bascules >= 8) return true;
  }
  const compact = texte.replace(/\s+/g, "");
  if (compact.length < 20) return false;
  const suites = compact.match(/(.)\1{19,}/gu) ?? [];
  const repetes = suites.reduce((n, x) => n + x.length, 0);
  // Dégénéré seulement si l'ESSENTIEL du texte est une répétition (évite d'effacer du vrai code :
  // bannières « //// », littéraux « 100000000000L », cadres Unicode « ═══ », clôtures « ~~~ »).
  return repetes / compact.length > 0.9;
}

/** Nombre maximal de suites automatiques quand une réponse est coupée par sa limite de tokens. */
export const MAX_SUITES = 4;

/**
 * Choisit le premier fournisseur dont les limites connues (apprises des erreurs Groq) acceptent la
 * requête ; sinon un fournisseur dont seule la sortie est trop petite, avec la sortie plafonnée ;
 * sinon le premier de la liste.
 */
export async function choisirFournisseur(
  deps: DepsOrchestrateur,
  candidats: Fournisseur[],
  entreeEstimee: number,
  maxTokens: number,
): Promise<{ f: Fournisseur; maxTokens: number } | undefined> {
  if (candidats.length === 0) return undefined;
  let repli: { f: Fournisseur; maxTokens: number } | undefined;
  for (const f of candidats) {
    const l = await lireLimites(deps.kv, f.id);
    const entreeOk = !l.itpm || l.itpm >= entreeEstimee;
    const sortieOk = !l.otpm || l.otpm >= maxTokens;
    if (entreeOk && sortieOk) return { f, maxTokens };
    if (entreeOk && !repli && l.otpm) repli = { f, maxTokens: Math.max(64, l.otpm) };
  }
  return repli ?? { f: candidats[0], maxTokens };
}

async function tenter(
  deps: DepsOrchestrateur,
  f: Fournisseur,
  p: ParamsExecution,
  partId: string,
  deja: string,
  continuation: boolean,
  outils?: ToolSet,
): Promise<Tentative> {
  const maintenant = deps.maintenant?.() ?? Date.now();
  const log = deps.log ?? (() => {});
  const messagesBase = continuation
    ? [...p.messages, { role: "assistant", content: deja } as ModelMessage, { role: "user", content: INSTRUCTION_CONTINUATION } as ModelMessage]
    : p.messages;

  // 1. Ajustement au contexte (résumé des anciens messages si nécessaire).
  let ajuste;
  try {
    ajuste = await ajusterAuContexte(
      messagesBase,
      { contexte: f.contexte, maxSortie: p.reglages.maxTokens, systeme: p.reglages.systeme },
      creerResumeur(deps, f, p.conversationId, p.signal),
    );
  } catch (err) {
    return { texte: "", erreur: classerErreur(err, maintenant), resume: false, tokensEstimes: 0 };
  }
  const tokensEstimes =
    ajuste.messages.reduce((s, m) => s + tokensMessage(m), 0) + estimerTokens(ajuste.systeme) + ajuste.maxSortie;
  if (ajuste.tronque) p.writer.write({ type: "data-info", data: { texte: `${f.nom} : message tronqué pour tenir dans le contexte` }, transient: true });

  // 2. Flux avec chien de garde d'inactivité.
  const controleur = new AbortController();
  const onAbort = () => controleur.abort();
  p.signal?.addEventListener("abort", onAbort, { once: true });
  // Kimi K3 (NVIDIA) met souvent près d'une minute avant son premier token (file d'attente,
  // raisonnement) : on lui laisse 2 min pour démarrer, puis 60 s entre deux données comme aux autres.
  const delaiSuivant = deps.delaiInactiviteMs ?? 60_000;
  const delaiPremier = deps.delaiInactiviteMs ?? (f.famille === "nvidia" ? 120_000 : 60_000);
  let delai = delaiPremier; // délai en cours (repris dans le message d'erreur)
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  let inactif = false;
  const armer = (ms: number = delaiSuivant) => {
    delai = ms;
    if (minuteur) clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      inactif = true;
      controleur.abort();
    }, ms);
  };

  let emis = "";
  let tampon = "";
  let tamponFerme = !continuation; // en continuation, on garde ~300 caractères pour ôter le chevauchement
  let usage: Tentative["usage"];
  let cout: number | undefined;
  let neurons: number | undefined;
  let erreur: ErreurClassee | undefined;
  let enTetes: Tentative["enTetes"];
  let finishReason: string | undefined;

  const vider = () => {
    if (!tampon) return;
    const morceau = tamponFerme ? tampon : fusionnerContinuation(deja, tampon);
    tamponFerme = true;
    tampon = "";
    if (morceau) {
      emis += morceau;
      p.writer.write({ type: "text-delta", id: partId, delta: morceau });
    }
  };

  try {
    armer(delaiPremier);
    const avecOutils = outils && Object.keys(outils).length > 0 && !continuation;
    const resultat = streamText({
      model: deps.creerModele(f, { raisonnement: p.reglages.raisonnement }),
      system: ajuste.systeme,
      messages: ajuste.messages,
      temperature: p.reglages.temperature,
      maxOutputTokens: ajuste.maxSortie,
      maxRetries: 0,
      abortSignal: controleur.signal,
      // Au plus deux recherches par réponse, puis une dernière étape SANS outil : sinon un modèle qui
      // enchaîne les recherches (Groq) épuise les étapes et s'arrête sans avoir rien écrit.
      ...(avecOutils
        ? {
            tools: outils,
            stopWhen: stepCountIs(3),
            prepareStep: ({ stepNumber }: { stepNumber: number }) =>
              stepNumber >= 2
                ? { toolChoice: "none" as const, activeTools: [] }
                : stepNumber === 0 && p.outilImpose && outils[p.outilImpose]
                  ? { toolChoice: { type: "tool" as const, toolName: p.outilImpose } }
                  : {},
          }
        : {}),
      onError: () => {}, // les erreurs arrivent aussi dans le flux
    });

    let raisonnementId: string | undefined;
    let verifie = 0; // longueur du texte à la dernière vérification de dégénérescence
    for await (const part of resultat.stream) {
      armer();
      if (part.type === "text-delta") {
        tampon += part.text;
        // Sortie dégénérée (« !!!!… » de Kimi K3, cas réel : 4 min de points d'exclamation au
        // compte-gouttes) : on coupe dès qu'elle se voit, la suite (nouvel essai, bascule) est la
        // même que pour une réponse dégénérée complète.
        const total = emis.length + tampon.length;
        if (total - verifie >= 120) {
          verifie = total;
          if (estDegenere((emis + tampon).slice(-4000))) {
            vider();
            controleur.abort();
            break;
          }
        }
        if (tamponFerme || tampon.length >= 300) vider();
      } else if (part.type === "reasoning-delta") {
        // Raisonnement (si activé dans les réglages) : transmis tel quel, affiché replié côté client.
        if (!raisonnementId) {
          raisonnementId = `${partId}-r`;
          p.writer.write({ type: "reasoning-start", id: raisonnementId });
        }
        p.writer.write({ type: "reasoning-delta", id: raisonnementId, delta: part.text });
      } else if (part.type === "reasoning-end") {
        if (raisonnementId) {
          p.writer.write({ type: "reasoning-end", id: raisonnementId });
          raisonnementId = undefined;
        }
      } else if (part.type === "tool-call") {
        // Recherche web demandée par le modèle : pastille « en cours ».
        vider();
        const entree = part.input as { requete?: string } | undefined;
        p.writer.write({ type: "data-recherche", id: part.toolCallId, data: { requete: entree?.requete ?? "", etat: "en-cours" } });
      } else if (part.type === "tool-result") {
        const sortie = part.output as { requete?: string; moteur?: string; resultats?: Array<{ titre: string; url: string; extrait: string }>; erreur?: string } | undefined;
        p.writer.write({
          type: "data-recherche",
          id: part.toolCallId,
          data: sortie?.erreur
            ? { requete: sortie.requete ?? "", etat: "erreur", erreur: sortie.erreur }
            : { requete: sortie?.requete ?? "", etat: "ok", moteur: sortie?.moteur, resultats: sortie?.resultats ?? [] },
        });
      } else if (part.type === "tool-error") {
        p.writer.write({ type: "data-recherche", id: part.toolCallId, data: { requete: "", etat: "erreur", erreur: String(part.error).slice(0, 200) } });
      } else if (part.type === "error") {
        erreur = classerErreur(part.error, deps.maintenant?.() ?? Date.now());
        break;
      } else if (part.type === "finish") {
        finishReason = part.finishReason;
        usage = {
          entree: part.totalUsage.inputTokens ?? 0,
          sortie: part.totalUsage.outputTokens ?? 0,
          total: part.totalUsage.totalTokens ?? (part.totalUsage.inputTokens ?? 0) + (part.totalUsage.outputTokens ?? 0),
        };
      } else if (part.type === "abort") {
        erreur = classerErreur(new DOMException("aborted", "AbortError"));
        break;
      }
    }
    vider();
    if (raisonnementId) p.writer.write({ type: "reasoning-end", id: raisonnementId });
    if (!erreur) {
      try {
        const rep = await resultat.response;
        enTetes = rep.headers;
        const meta = (await resultat.providerMetadata) as Record<string, { cout?: number; neurons?: number }> | undefined;
        const c = meta?.[f.famille]?.cout;
        if (typeof c === "number") cout = c;
        const n = meta?.[f.famille]?.neurons;
        if (typeof n === "number") neurons = n;
      } catch {
        /* métadonnées facultatives */
      }
    }
  } catch (err) {
    vider();
    erreur = classerErreur(err, deps.maintenant?.() ?? Date.now());
  } finally {
    if (minuteur) clearTimeout(minuteur);
    p.signal?.removeEventListener("abort", onAbort);
  }

  if (inactif && erreur) {
    erreur = { ...erreur, categorie: "temporaire", basculer: true, message: `aucune donnée reçue pendant ${Math.round(delai / 1000)} s` };
  } else if (erreur?.categorie === "abandon" && p.signal?.aborted) {
    // Annulation par l'utilisateur : on s'arrête là.
  }
  if (erreur) log(`[chat] ${f.nom} : ${erreur.categorie} ${erreur.statut ?? ""} ${erreur.message}`);
  return { texte: emis, erreur, usage, cout, neurons, enTetes, resume: ajuste.resume, tokensEstimes, finishReason };
}

/* ───────────── Exécution complète ───────────── */

export async function executerChat(deps: DepsOrchestrateur, params: ParamsExecution): Promise<ResultatExecution> {
  // Le raisonnement des tours précédents n'est jamais renvoyé aux fournisseurs.
  const p: ParamsExecution = { ...params, messages: sansRaisonnement(params.messages) };
  const log = deps.log ?? (() => {});
  const debut = deps.maintenant?.() ?? Date.now();
  const { writer } = p;
  const bascules: Bascule[] = [];
  const meta: MetaMessage = { creeA: debut, bascules };
  let partId = `txt-${debut.toString(36)}-0`;
  let texte = "";
  let regenerations = 0;
  let usageTotal = { entree: 0, sortie: 0, total: 0 };
  let coutTotal = 0;
  let neuronsTotal = 0;
  let aResume = false;
  let precedent: Fournisseur | undefined;
  let continuation = false;
  let continuationEnCours = false; // la tentative courante est une reprise
  const tentes = new Set<string>();
  const reessaisMemeFournisseur = new Set<string>(); // un seul nouvel essai sur place par fournisseur
  let erreurContexte = 0;
  let relance = false; // une seule relance « réponse sans action » par réponse
  const entreeEstimee = p.messages.reduce((s, m) => s + tokensMessage(m), 0) + estimerTokens(p.reglages.systeme);

  writer.write({ type: "text-start", id: partId });

  // Boucle : à chaque tour on recalcule l'ordre (un fournisseur peut redevenir disponible).
  // Chaque fournisseur peut être essayé deux fois (un essai + un nouvel essai sur place), plus une marge :
  // sinon des fournisseurs encore disponibles ne sont jamais atteints après les reprises. (#30)
  for (let tour = 0; tour < deps.fournisseurs.length * 2 + 2; tour++) {
    if (p.signal?.aborted) break;
    const { candidats, indisponibles } = await ordonnerFournisseurs(deps, p.conversationId);
    const choix = await choisirFournisseur(deps, candidats.filter((c) => !tentes.has(c.id)), entreeEstimee, p.reglages.maxTokens);
    const f = choix?.f;
    // Sortie plafonnée à la limite connue du fournisseur (Groq OTPM) si c'est le seul moyen de l'utiliser.
    const pf: ParamsExecution = choix && choix.maxTokens < p.reglages.maxTokens ? { ...p, reglages: { ...p.reglages, maxTokens: choix.maxTokens } } : p;
    if (!f) {
      // Plus rien d'essayable.
      const maintenant = deps.maintenant?.() ?? Date.now();
      const tous = [...indisponibles, ...candidats.map((c) => ({ f: c, etat: { statut: "erreur", majA: maintenant } as EtatFournisseur }))];
      const prochain = tous
        .filter((c) => c.etat.reessaiA)
        .sort((a, b) => (a.etat.reessaiA ?? 0) - (b.etat.reessaiA ?? 0))[0];
      const quand = prochain?.etat.reessaiA
        ? new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: fuseauHoraire() }).format(new Date(prochain.etat.reessaiA))
        : undefined;
      const message = texte
        ? `La réponse a été interrompue : plus aucun fournisseur disponible.${quand ? ` Prochain réessai possible vers ${quand} (${prochain!.f.nom}).` : ""}`
        : `Tous les fournisseurs sont épuisés ou en erreur.${quand ? ` Prochain réessai possible vers ${quand} (${prochain!.f.nom}).` : " Vérifiez la page État."}`;
      writer.write({ type: "data-tous-epuises", data: { message, reessaiA: prochain?.etat.reessaiA, fournisseur: prochain?.f.nom }, transient: true });
      writer.write({ type: "text-end", id: partId });
      meta.usage = usageTotal;
      meta.regenerations = regenerations;
      meta.dureeMs = (deps.maintenant?.() ?? Date.now()) - debut;
      writer.write({ type: "message-metadata", messageMetadata: meta });
      writer.write({ type: "error", errorText: message });
      return { ok: false, texte, meta, erreur: message };
    }
    tentes.add(f.id);

    meta.fournisseur = f.nom;
    meta.fournisseurId = f.id;
    meta.modele = f.modele;
    writer.write({ type: "message-metadata", messageMetadata: { fournisseur: f.nom, fournisseurId: f.id, modele: f.modele } });

    // Limiteur partagé (requêtes/min) : si le fournisseur est saturé par d'autres tâches, on passe au suivant sans le marquer.
    if (!(await reserverOuAttendre(deps, f, p.signal))) {
      log(`[chat] ${f.nom} : limite de requêtes par minute atteinte (partagée), suivant`);
      const autre = candidats.find((c) => !tentes.has(c.id));
      if (autre) {
        const b: Bascule = { de: f.nom, vers: autre.nom, raison: "limite de requêtes par minute atteinte", continuation: texte.length > 0 };
        if (texte.length > 0) {
          continuation = true;
          continuationEnCours = true;
        }
        bascules.push(b);
        writer.write({ type: "data-bascule", data: b, transient: true });
        precedent = f;
        continue;
      }
      // Personne d'autre : on attend la prochaine fenêtre quoi qu'il en coûte.
      const c = await reserverCreneau(deps.kv, f, deps.maintenant?.() ?? Date.now(), deps.fenetreDebitMs);
      if (!c.ok) {
        writer.write({ type: "data-info", data: { texte: `${f.nom} : limite de requêtes par minute, attente ${Math.ceil(c.attenteMs / 1000)} s` }, transient: true });
        await attendre(c.attenteMs);
      }
    }
    const outilsPour = p.outils && !fournisseurSansOutils(f.id) ? p.outils : undefined;
    const cumuler = async (t: Tentative) => {
      texte += t.texte;
      aResume ||= t.resume;
      if (t.usage) {
        usageTotal = { entree: usageTotal.entree + t.usage.entree, sortie: usageTotal.sortie + t.usage.sortie, total: usageTotal.total + t.usage.total };
      }
      if (t.cout) coutTotal += t.cout;
      if (t.neurons) neuronsTotal += t.neurons;
      if (f.payant && t.usage && deps.enregistrerDepense) {
        await deps.enregistrerDepense(f, t.usage, t.cout).catch(() => {});
      }
    };
    let t = await tenter(deps, f, pf, partId, texte, continuation, outilsPour);
    await cumuler(t);
    let maintenant = deps.maintenant?.() ?? Date.now();

    // Réponse coupée par la limite de tokens de sortie : on fait continuer le même fournisseur.
    let suites = 0;
    while (!t.erreur && t.finishReason === "length" && t.texte.length > 0 && !estDegenere(t.texte) && suites < MAX_SUITES && !p.signal?.aborted) {
      suites++;
      writer.write({ type: "data-info", data: { texte: `Réponse longue : suite automatique (${suites}/${MAX_SUITES})` }, transient: true });
      await reserverOuAttendre(deps, f, p.signal);
      t = await tenter(deps, f, pf, partId, texte, true, undefined);
      await cumuler(t);
      maintenant = deps.maintenant?.() ?? Date.now();
      if (!t.erreur) continuation = true;
    }

    // Réponse vide (le raisonnement a tout consommé) ou dégénérée (suite de caractères répétés,
    // défaut passager de certaines infrastructures) : un nouvel essai sur le même fournisseur,
    // puis bascule, sans marquer le fournisseur indisponible.
    // Réponse vide OU blanche (espaces seuls), que l'usage de sortie soit rapporté ou non : on ne
    // l'accepte jamais comme un succès (bulle vide persistée, fournisseur « collant »). (#16)
    const vide = !t.erreur && t.texte.trim().length === 0 && texte.trim().length === 0;
    const degenere = !t.erreur && estDegenere(t.texte);
    if (vide || degenere) {
      const raison = degenere ? "réponse dégénérée (caractères répétés)" : "réponse vide";
      log(`[chat] ${f.nom} : ${raison}, ${t.usage?.sortie ?? 0} tokens de sortie`);
      if (degenere || texte.length > 0) {
        // Le texte dégénéré (ou les espaces émis) ne doivent pas rester affichés : on régénère.
        regenerations++;
        texte = "";
        continuation = false;
        continuationEnCours = false;
        writer.write({ type: "text-end", id: partId });
        writer.write({ type: "data-regeneration", data: { raison: `${raison} chez ${f.nom}` } });
        partId = `txt-${debut.toString(36)}-${regenerations}`;
        writer.write({ type: "text-start", id: partId });
      }
      if (!reessaisMemeFournisseur.has(f.id)) {
        reessaisMemeFournisseur.add(f.id);
        tentes.delete(f.id);
        writer.write({ type: "data-info", data: { texte: `${raison} : nouvel essai chez ${f.nom}` }, transient: true });
        continue;
      }
      const autre = candidats.find((c) => !tentes.has(c.id));
      if (autre) {
        precedent = f;
        const b: Bascule = { de: f.nom, vers: autre.nom, raison, continuation: false };
        bascules.push(b);
        writer.write({ type: "data-bascule", data: b, transient: true });
        continue;
      }
      t = { ...t, erreur: { categorie: "temporaire", message: raison, reessaiA: maintenant, basculer: true } };
    }

    // Réponse qui annonce le travail sans le faire (« je corrige… », « je vais vérifier… ») : une
    // relance sur place, sans outil, pour obtenir les fichiers dans la même réponse.
    const consigne = !t.erreur && !relance && !p.signal?.aborted ? p.relance?.(texte) : null;
    if (consigne) {
      relance = true;
      log(`[chat] ${f.nom} : réponse sans action, relance`);
      writer.write({ type: "data-info", data: { texte: "Aucun fichier modifié : l'application demande les modifications" }, transient: true });
      const sep = texte.endsWith("\n") ? "\n" : "\n\n";
      writer.write({ type: "text-delta", id: partId, delta: sep });
      texte += sep;
      const messagesRelance: ModelMessage[] = [...pf.messages, { role: "assistant", content: texte.trim() }, { role: "user", content: consigne }];
      const t2 = await tenter(deps, f, { ...pf, messages: messagesRelance, outilImpose: undefined }, partId, "", false, undefined);
      if (!t2.erreur && !estDegenere(t2.texte)) {
        await cumuler(t2);
        t = { ...t2, texte: t.texte + sep + t2.texte };
      } else {
        log(`[chat] ${f.nom} : relance sans résultat (${t2.erreur?.message ?? "réponse dégénérée"}), première réponse gardée`);
      }
      maintenant = deps.maintenant?.() ?? Date.now();
    }

    if (!t.erreur) {
      await noterReussite(deps, f, t.enTetes, maintenant);
      await deps.kv.set(PREFIXE_CONV + p.conversationId, f.id, TTL_CONV);
      writer.write({ type: "text-end", id: partId });
      meta.usage = usageTotal;
      if (coutTotal) meta.cout = coutTotal;
      if (neuronsTotal) meta.neurons = Math.round(neuronsTotal * 10) / 10;
      meta.regenerations = regenerations;
      meta.resume = aResume || undefined;
      meta.dureeMs = maintenant - debut;
      writer.write({ type: "message-metadata", messageMetadata: meta });
      return { ok: true, texte, meta };
    }

    const e = t.erreur;
    if (outilsPour && e.categorie === "requete" && e.statut === 400 && RE_OUTILS_REFUSES.test(e.message)) {
      // Ce fournisseur ne prend pas les outils : on le note et on retente sans, immédiatement.
      sansOutils.set(f.id, maintenant + 3_600_000);
      (deps.log ?? (() => {}))(`[chat] ${f.nom} refuse les outils, nouvel essai sans recherche web`);
      tentes.delete(f.id);
      continue;
    }
    if (e.categorie === "abandon" && p.signal?.aborted) {
      writer.write({ type: "text-end", id: partId });
      meta.usage = usageTotal;
      meta.dureeMs = maintenant - debut;
      writer.write({ type: "message-metadata", messageMetadata: meta });
      return { ok: false, texte, meta, erreur: "annulé" };
    }

    if (e.categorie === "trop-grand") {
      if (await apprendreLimites(deps.kv, f.id, e.message)) log(`[chat] ${f.nom} : limites mémorisées (${e.message.slice(0, 80)}…)`);
      const autre = candidats.find((c) => !tentes.has(c.id));
      if (!autre && erreurContexte < 3) {
        // Personne d'autre : on réduit le contexte et on retente ici (résumé des anciens messages).
        erreurContexte++;
        tentes.delete(f.id);
        const reduit = { ...f, contexte: Math.max(1024, Math.floor(Math.min(f.contexte, t.tokensEstimes || f.contexte) * 0.6)) };
        deps = { ...deps, fournisseurs: deps.fournisseurs.map((x) => (x.id === f.id ? reduit : x)) };
        continue;
      }
      // Un autre fournisseur peut prendre la requête entière : on ne marque pas celui-ci épuisé
      // (il reste valable pour des requêtes plus petites), on bascule simplement.
      if (autre) {
        precedent = f;
        const b: Bascule = { de: f.nom, vers: autre.nom, raison: "requête trop grande pour sa fenêtre de débit", continuation: texte.length > 0 };
        if (texte.length > 0) {
          continuation = true;
          continuationEnCours = true;
        }
        bascules.push(b);
        writer.write({ type: "data-bascule", data: b, transient: true });
        continue;
      }
    }

    if (e.categorie === "contexte" && erreurContexte < 3) {
      // Le fournisseur juge le contexte trop long malgré notre estimation : on retente sur le
      // même fournisseur avec une fenêtre recalibrée à 60 % de la requête qui vient d'échouer.
      erreurContexte++;
      tentes.delete(f.id);
      const reduit = { ...f, contexte: Math.max(1024, Math.floor(Math.min(f.contexte, t.tokensEstimes || f.contexte) * 0.6)) };
      deps = { ...deps, fournisseurs: deps.fournisseurs.map((x) => (x.id === f.id ? reduit : x)) };
      continue;
    }

    // Limite de débit courte (par minute, sans quota journalier) : mieux vaut attendre quelques
    // secondes et retenter sur place que de basculer vers un fournisseur plus faible.
    const delaiReessai = e.reessaiA - maintenant;
    if (e.categorie === "quota" && delaiReessai > 0 && delaiReessai <= 60_000 && !reessaisMemeFournisseur.has(f.id) && !p.signal?.aborted) {
      reessaisMemeFournisseur.add(f.id);
      const attente = Math.max(1_000, Math.min(delaiReessai, deps.attenteMaxReessaiMs ?? 15_000));
      writer.write({ type: "data-info", data: { texte: `${f.nom} : limite de débit, nouvel essai dans ${Math.ceil(attente / 1000)} s` }, transient: true });
      await new Promise<void>((r) => setTimeout(r, attente));
      tentes.delete(f.id);
      continue;
    }

    await noterEchec(deps, f, e, maintenant);

    if (!e.basculer) {
      const message = `Le fournisseur ${f.nom} a refusé la requête : ${e.message}`;
      writer.write({ type: "text-end", id: partId });
      meta.usage = usageTotal;
      meta.dureeMs = maintenant - debut;
      writer.write({ type: "message-metadata", messageMetadata: meta });
      writer.write({ type: "error", errorText: message });
      return { ok: false, texte, meta, erreur: message };
    }

    // Bascule.
    precedent = f;
    const texteEmisParCetteTentative = t.texte.length > 0;
    if (texte.length > 0 && !(continuationEnCours && !texteEmisParCetteTentative)) {
      // Du texte est affiché : le suivant doit continuer à la suite.
      continuation = true;
      continuationEnCours = true;
    } else if (texte.length > 0) {
      // La reprise a échoué sans rien produire : on régénère tout.
      regenerations++;
      texte = "";
      continuation = false;
      continuationEnCours = false;
      writer.write({ type: "text-end", id: partId });
      writer.write({ type: "data-regeneration", data: { raison: `reprise impossible chez ${f.nom}` } });
      partId = `txt-${debut.toString(36)}-${regenerations}`;
      writer.write({ type: "text-start", id: partId });
    }
    const suivant = (await ordonnerFournisseurs(deps, p.conversationId)).candidats.find((c) => !tentes.has(c.id));
    const b: Bascule = { de: precedent.nom, vers: suivant?.nom ?? "—", raison: nomErreur(e), continuation };
    bascules.push(b);
    writer.write({ type: "data-bascule", data: b, transient: true });
  }

  const message = texte ? "La réponse a été interrompue." : "Aucun fournisseur n'a pu répondre.";
  writer.write({ type: "text-end", id: partId });
  meta.usage = usageTotal;
  meta.dureeMs = (deps.maintenant?.() ?? Date.now()) - debut;
  writer.write({ type: "message-metadata", messageMetadata: meta });
  writer.write({ type: "error", errorText: message });
  return { ok: false, texte, meta, erreur: message };
}

/**
 * Génération simple (non diffusée) avec rotation : utilisée pour condenser les pages lues.
 * Essaie les fournisseurs disponibles dans l'ordre ; note les épuisés comme pour le chat.
 */
export async function genererAvecRotation(
  deps: DepsOrchestrateur,
  p: { systeme: string; prompt: string; maxTokens: number; conversationId: string; signal?: AbortSignal },
): Promise<string> {
  const { candidats } = await ordonnerFournisseurs(deps, p.conversationId);
  let derniere: ErreurClassee | undefined;
  for (const f of candidats) {
    const maintenant = deps.maintenant?.() ?? Date.now();
    try {
      const r = await generateText({
        model: deps.creerModele(f, { raisonnement: "aucun" }),
        system: p.systeme,
        prompt: p.prompt,
        temperature: 0.2,
        maxOutputTokens: p.maxTokens,
        maxRetries: 0,
        abortSignal: p.signal ?? AbortSignal.timeout(90_000),
      });
      await noterReussite(deps, f, r.response.headers, maintenant);
      if (f.payant && deps.enregistrerDepense) {
        const meta = r.providerMetadata as Record<string, { cout?: number }> | undefined;
        await deps.enregistrerDepense(f, { entree: r.usage.inputTokens ?? 0, sortie: r.usage.outputTokens ?? 0 }, meta?.[f.famille]?.cout).catch(() => {});
      }
      if (r.text.trim()) return r.text;
      derniere = { categorie: "temporaire", message: "réponse vide", reessaiA: maintenant, basculer: true };
    } catch (err) {
      derniere = classerErreur(err, maintenant);
      if (derniere.categorie === "abandon") throw err;
      await noterEchec(deps, f, derniere, maintenant);
      if (!derniere.basculer && derniere.categorie !== "contexte") throw err;
    }
  }
  throw new Error(derniere?.message ?? "aucun fournisseur disponible");
}

export { texteDe };
