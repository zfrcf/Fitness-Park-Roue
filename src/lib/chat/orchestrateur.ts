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
import { generateText, streamText, type LanguageModel, type ModelMessage, type UIMessageStreamWriter } from "ai";
import type { KV } from "@/lib/kv";
import { lireQuota } from "@/lib/fournisseurs/entetes";
import { classerErreur, type ErreurClassee } from "@/lib/fournisseurs/erreurs";
import type { EtatFournisseur, Fournisseur, NiveauRaisonnement } from "@/lib/fournisseurs/types";
import { ajusterAuContexte, estimerTokens, INSTRUCTION_RESUME, promptResume, texteDe, tokensMessage } from "./contexte";
import type { Bascule, MessageUI, MetaMessage, Reglages } from "./types";

export interface DepsOrchestrateur {
  fournisseurs: Fournisseur[];
  kv: KV;
  creerModele: (f: Fournisseur, opts: { raisonnement: NiveauRaisonnement }) => LanguageModel;
  maintenant?: () => number;
  /** Délai sans aucun octet reçu avant de considérer le fournisseur en panne. */
  delaiInactiviteMs?: number;
  /** Autorise-t-on un fournisseur payant maintenant ? (plafond mensuel, étape 8) */
  autoriserPayant?: (f: Fournisseur) => Promise<boolean>;
  /** Journalisation (désactivée en test). */
  log?: (message: string) => void;
}

export interface ParamsExecution {
  writer: UIMessageStreamWriter<MessageUI>;
  messages: ModelMessage[];
  reglages: Reglages;
  conversationId: string;
  signal?: AbortSignal;
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
  const prefere = await deps.kv.get<string>(PREFIXE_CONV + conversationId);
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
    const r = await generateText({
      model: deps.creerModele(f, { raisonnement: "aucun" }),
      system: INSTRUCTION_RESUME,
      prompt: corps,
      temperature: 0.2,
      maxOutputTokens: Math.max(200, Math.min(budgetTokens, 2000)),
      maxRetries: 0,
      abortSignal: signal,
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
  enTetes?: Headers | Record<string, string>;
  resume: boolean;
  /** Taille estimée de la requête envoyée (tokens), pour recalibrer en cas d'erreur de contexte. */
  tokensEstimes: number;
}

async function tenter(
  deps: DepsOrchestrateur,
  f: Fournisseur,
  p: ParamsExecution,
  partId: string,
  deja: string,
  continuation: boolean,
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
    ajuste.messages.reduce((s, m) => s + tokensMessage(m), 0) + estimerTokens(ajuste.systeme) + p.reglages.maxTokens;

  // 2. Flux avec chien de garde d'inactivité.
  const controleur = new AbortController();
  const onAbort = () => controleur.abort();
  p.signal?.addEventListener("abort", onAbort, { once: true });
  const delai = deps.delaiInactiviteMs ?? 60_000;
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  let inactif = false;
  const armer = () => {
    if (minuteur) clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      inactif = true;
      controleur.abort();
    }, delai);
  };

  let emis = "";
  let tampon = "";
  let tamponFerme = !continuation; // en continuation, on garde ~300 caractères pour ôter le chevauchement
  let usage: Tentative["usage"];
  let cout: number | undefined;
  let erreur: ErreurClassee | undefined;
  let enTetes: Tentative["enTetes"];

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
    armer();
    const resultat = streamText({
      model: deps.creerModele(f, { raisonnement: p.reglages.raisonnement }),
      system: ajuste.systeme,
      messages: ajuste.messages,
      temperature: p.reglages.temperature,
      maxOutputTokens: p.reglages.maxTokens,
      maxRetries: 0,
      abortSignal: controleur.signal,
      onError: () => {}, // les erreurs arrivent aussi dans le flux
    });

    let raisonnementId: string | undefined;
    for await (const part of resultat.stream) {
      armer();
      if (part.type === "text-delta") {
        tampon += part.text;
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
      } else if (part.type === "error") {
        erreur = classerErreur(part.error, deps.maintenant?.() ?? Date.now());
        break;
      } else if (part.type === "finish") {
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
        const meta = (await resultat.providerMetadata) as Record<string, { cout?: number }> | undefined;
        const c = meta?.[f.famille]?.cout;
        if (typeof c === "number") cout = c;
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
  return { texte: emis, erreur, usage, cout, enTetes, resume: ajuste.resume, tokensEstimes };
}

/* ───────────── Exécution complète ───────────── */

export async function executerChat(deps: DepsOrchestrateur, p: ParamsExecution): Promise<ResultatExecution> {
  const debut = deps.maintenant?.() ?? Date.now();
  const { writer } = p;
  const bascules: Bascule[] = [];
  const meta: MetaMessage = { creeA: debut, bascules };
  let partId = `txt-${debut.toString(36)}-0`;
  let texte = "";
  let regenerations = 0;
  let usageTotal = { entree: 0, sortie: 0, total: 0 };
  let coutTotal = 0;
  let aResume = false;
  let precedent: Fournisseur | undefined;
  let continuation = false;
  let continuationEnCours = false; // la tentative courante est une reprise
  const tentes = new Set<string>();
  let erreurContexte = 0;

  writer.write({ type: "text-start", id: partId });

  // Boucle : à chaque tour on recalcule l'ordre (un fournisseur peut redevenir disponible).
  for (let tour = 0; tour < deps.fournisseurs.length + 2; tour++) {
    if (p.signal?.aborted) break;
    const { candidats, indisponibles } = await ordonnerFournisseurs(deps, p.conversationId);
    const f = candidats.find((c) => !tentes.has(c.id));
    if (!f) {
      // Plus rien d'essayable.
      const maintenant = deps.maintenant?.() ?? Date.now();
      const tous = [...indisponibles, ...candidats.map((c) => ({ f: c, etat: { statut: "erreur", majA: maintenant } as EtatFournisseur }))];
      const prochain = tous
        .filter((c) => c.etat.reessaiA)
        .sort((a, b) => (a.etat.reessaiA ?? 0) - (b.etat.reessaiA ?? 0))[0];
      const quand = prochain?.etat.reessaiA
        ? new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: process.env.TZ || "Europe/Paris" }).format(new Date(prochain.etat.reessaiA))
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

    const t = await tenter(deps, f, p, partId, texte, continuation);
    const maintenant = deps.maintenant?.() ?? Date.now();
    texte += t.texte;
    aResume ||= t.resume;
    if (t.usage) {
      usageTotal = { entree: usageTotal.entree + t.usage.entree, sortie: usageTotal.sortie + t.usage.sortie, total: usageTotal.total + t.usage.total };
    }
    if (t.cout) coutTotal += t.cout;

    if (!t.erreur) {
      await noterReussite(deps, f, t.enTetes, maintenant);
      await deps.kv.set(PREFIXE_CONV + p.conversationId, f.id, TTL_CONV);
      writer.write({ type: "text-end", id: partId });
      meta.usage = usageTotal;
      if (coutTotal) meta.cout = coutTotal;
      meta.regenerations = regenerations;
      meta.resume = aResume || undefined;
      meta.dureeMs = maintenant - debut;
      writer.write({ type: "message-metadata", messageMetadata: meta });
      return { ok: true, texte, meta };
    }

    const e = t.erreur;
    if (e.categorie === "abandon" && p.signal?.aborted) {
      writer.write({ type: "text-end", id: partId });
      meta.usage = usageTotal;
      meta.dureeMs = maintenant - debut;
      writer.write({ type: "message-metadata", messageMetadata: meta });
      return { ok: false, texte, meta, erreur: "annulé" };
    }

    if (e.categorie === "trop-grand") {
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
