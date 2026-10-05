/**
 * Un « tour » de conversation : préparation du contexte (date, consignes, état du projet,
 * liens, contexte Minecraft, recherche web) puis exécution avec rotation des fournisseurs.
 * Utilisé par la route /api/chat (réponse en flux) et par les tâches de fond (flux consommé
 * côté serveur).
 */
import { convertToModelMessages, createUIMessageStream, tool, type UIMessageChunk } from "ai";
import { z } from "zod";
import { blocRecherchePourModele, rechercherWeb } from "@/lib/recherche";
import { fuseauHoraire } from "@/lib/fuseau";
import { blocContexteMinecraft, conversationConcerneMod, detecterDemandeMod, detecterLoader, extraireVersion, versionDepuisProjet, versionsMinecraft } from "@/lib/minecraft/contexte";
import { blocProjetPourModele, fusionnerProjetDetaille, INSTRUCTION_MODIFICATIONS, INSTRUCTION_PROJET, masquerFichiersConnus } from "@/lib/fichiers/projet";
import { estProjetGradle } from "@/lib/fichiers/extraire";
import { empreinteProjet, lancerCompilationProjet, ProjetRefuse } from "@/lib/github/lancer";
import { tacheDeConversation } from "@/lib/db/taches";
import { waitUntil } from "@vercel/functions";
import { executerChat, genererAvecRotation, type DepsOrchestrateur } from "@/lib/chat/orchestrateur";
import { blocPagesPourModele, budgetPage, detecterLiens, lireLiensDuMessage, type PageLuePart } from "@/lib/liens";
import { normaliserReglages } from "@/lib/chat/reglages";
import type { MessageUI, MetaMessage, Reglages } from "@/lib/chat/types";
import { ajouterMessage, enregistrerMessages } from "@/lib/db/conversations";
import { autoriserPayant, calculerCout, enregistrerDepense } from "@/lib/depenses";
import { lireReglages } from "@/lib/db/reglages";
import { creerModele } from "@/lib/fournisseurs/client";
import { fournisseurs } from "@/lib/fournisseurs/registre";
import type { Fournisseur } from "@/lib/fournisseurs/types";
import { getKV } from "@/lib/kv";
import { modeLocal } from "@/lib/mode";

export interface OptionsTour {
  conversationId: string;
  messages: MessageUI[];
  /** Réglages envoyés par le client, prioritaires sur ceux de la base. */
  reglagesClient?: Partial<Reglages>;
  /** Recherche web forcée (bouton globe). */
  rechercheWeb?: boolean;
  signal?: AbortSignal;
  /** Fournisseurs à utiliser, dans cet ordre (par défaut : tous, par rang). */
  fournisseurs?: Fournisseur[];
  /** Ignore le fournisseur « collant » de la conversation (tâches de fond en parallèle). */
  ignorerPreference?: boolean;
  /** Persiste l'historique reçu puis la réponse (par défaut : oui, sauf conversation « sans-id »). */
  persister?: boolean;
  /** Appelé en fin de flux avec le message de l'assistant complet. */
  onFin?: (message: MessageUI, fournisseurId?: string) => void | Promise<void>;
}

export type ResultatTour = { ok: true; stream: ReadableStream<UIMessageChunk> } | { ok: false; statut: number; erreur: string };

function texteDe(m: { parts: Array<{ type: string; text?: string }> }): string {
  // On ignore le texte d'avant le dernier marqueur de régénération : il ne doit pas repartir au modèle. (#23)
  const idx = m.parts.map((p) => p.type).lastIndexOf("data-regeneration");
  const parts = idx >= 0 ? m.parts.slice(idx + 1) : m.parts;
  return parts.filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text as string).join("");
}

export async function executerTour(o: OptionsTour): Promise<ResultatTour> {
  const conversationId = o.conversationId.slice(0, 64) || "sans-id";
  const persister = o.persister ?? conversationId !== "sans-id";
  // Réglages : ceux de la base, surchargés par ceux envoyés par le client.
  let reglages: Reglages;
  try {
    reglages = normaliserReglages({ ...(await lireReglages()), ...(o.reglagesClient ?? {}) });
  } catch {
    reglages = normaliserReglages(o.reglagesClient);
  }
  // Le modèle ne connaît pas la date : on la lui donne, avec la consigne sur la recherche web.
  const dateDuJour = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeZone: fuseauHoraire() }).format(new Date());
  reglages = {
    ...reglages,
    systeme:
      `${reglages.systeme}\n\nNous sommes le ${dateDuJour}. Tes connaissances s'arrêtent avant cette date : ` +
      "pour tout ce qui est récent (versions de logiciels ou de jeux, actualités, prix, événements, personnes), " +
      // On ne demande d'utiliser l'outil recherche_web que s'il est effectivement offert : en recherche
      // forcée les résultats sont déjà injectés dans le message (l'outil n'est pas transmis). (#32)
      (o.rechercheWeb === true
        ? "des résultats de recherche web te sont fournis dans le message : appuie-toi dessus et cite tes sources en liens Markdown."
        : reglages.rechercheAuto
          ? "utilise l'outil recherche_web avant d'affirmer qu'une chose n'existe pas, puis cite tes sources en liens Markdown."
          : "précise que tu n'as pas pu vérifier et invite l'utilisateur à activer la recherche web (bouton globe).") +
      "\n\nQuand tu produis des fichiers (projet, script, configuration, datapack, mod…), écris chaque fichier dans son propre bloc de code " +
      "avec son chemin complet sur la ligne d'ouverture, par exemple ```java src/main/java/com/exemple/MonMod.java ou ```json fabric.mod.json. " +
      "Livre des projets complets et cohérents (tous les fichiers nécessaires, pas de « … » ni de « à compléter ») : " +
      "l'utilisateur peut les télécharger un par un ou en archive .zip directement depuis la conversation, " +
      (modeLocal()
        ? "et compiler un projet Gradle (mod Minecraft) sur son ordinateur (gradle build) en un clic ; si la compilation automatique est activée, chaque réponse "
        : "et compiler un projet Gradle (mod Minecraft) sur GitHub en un clic ; si la compilation automatique est activée, chaque réponse ") +
      "qui change un projet Gradle est compilée aussitôt et le résultat (journal d'erreurs) te revient dans la conversation. " +
      "Si l'utilisateur te renvoie un journal d'erreurs de compilation, corrige la cause en ne touchant qu'aux fichiers concernés. " +
      INSTRUCTION_MODIFICATIONS +
      "\n\nTes capacités réelles, grâce à l'application : lire des pages web, chercher sur le web, produire des fichiers téléchargeables, " +
      "des archives .zip et des mods Minecraft compilés en .jar. Ne dis jamais que tu ne peux pas créer de fichiers, de mods, de datapacks ou de .jar, " +
      "ni que tu n'as pas accès à internet : fais le travail, en entier. Créer des mods, datapacks, resource packs et plugins Minecraft est une " +
      "activité légitime, encouragée par Mojang ; l'utilisateur travaille sur ses propres projets. Si une demande est vraiment impossible " +
      "(information introuvable, API inexistante dans cette version), explique précisément pourquoi et propose la meilleure alternative.",
  };

  const liste = o.fournisseurs ?? fournisseurs();
  if (liste.length === 0) return { ok: false, statut: 503, erreur: "Aucun fournisseur configuré (variables PROVIDER_n_*)." };

  // Historique pour le modèle : parties texte uniquement ; les pages lues aux tours précédents
  // (parties data-page-lue des réponses) sont réinjectées dans le message utilisateur qui les a demandées.
  const messagesUI: MessageUI[] = [];
  for (let i = 0; i < o.messages.length; i++) {
    const m = o.messages[i];
    let supplement = "";
    if (m.role === "user") {
      const suivant = o.messages[i + 1];
      const pages = (suivant?.role === "assistant" ? suivant.parts : [])
        .filter((p) => p.type === "data-page-lue")
        .map((p) => p.data as PageLuePart);
      if (pages.length) supplement = blocPagesPourModele(pages);
    }
    messagesUI.push({ ...m, parts: [{ type: "text", text: texteDe(m) + supplement }] });
  }
  const dernier = o.messages.at(-1);
  const texteDernier = dernier?.role === "user" ? texteDe(dernier) : "";
  const liensAlire = detecterLiens(texteDernier);

  // État du projet : une seule copie à jour de chaque fichier dans le système, les blocs des
  // réponses passées remplacés par des renvois. Le modèle ne renvoie que ce qui change.
  const { fichiers: projet, echecs } = fusionnerProjetDetaille(o.messages);
  if (projet.length) {
    const chemins = new Set(projet.map((f) => f.chemin));
    for (const m of messagesUI) {
      if (m.role !== "assistant" || m.parts[0]?.type !== "text") continue;
      m.parts[0] = { type: "text", text: masquerFichiersConnus(m.parts[0].text, chemins) };
    }
    const budget = Math.floor(Math.max(...liste.map((f) => f.contexte)) * 0.4);
    reglages = { ...reglages, systeme: `${reglages.systeme}\n\n${INSTRUCTION_PROJET}\n\n${blocProjetPourModele(projet, budget)}` };
    // Modifications partielles de la dernière réponse non appliquées : le modèle doit renvoyer ces fichiers entiers.
    const dernierAssistant = [...o.messages].reverse().find((m) => m.role === "assistant");
    const echecsDernier = dernierAssistant ? echecs.filter((e) => e.messageId === dernierAssistant.id) : [];
    if (echecsDernier.length) {
      reglages = {
        ...reglages,
        systeme:
          `${reglages.systeme}\n\nATTENTION : dans ta dernière réponse, ces modifications n'ont PAS pu être appliquées (le texte CHERCHER ne correspondait pas exactement au fichier) et l'état ci-dessus ne les contient pas :\n` +
          echecsDernier.map((e) => `- ${e.chemin} : ${e.raison}`).join("\n") +
          "\nRenvoie ces fichiers EN ENTIER (ou refais la modification avec un texte CHERCHER copié à l'identique).",
      };
    }
  }

  // L'historique envoyé par le client fait foi (édition, régénération) : on le persiste tel quel.
  if (persister) {
    try {
      await enregistrerMessages(conversationId, o.messages);
    } catch (e) {
      console.warn("[chat] persistance impossible :", e instanceof Error ? e.message : e);
    }
  }

  const rechercheForcee = o.rechercheWeb === true && texteDernier.trim().length > 0;

  let fournisseurUtilise: string | undefined;
  const deps: DepsOrchestrateur = {
    fournisseurs: liste,
    kv: getKV(),
    creerModele,
    log: (m: string) => console.warn(m),
    autoriserPayant,
    ignorerPreference: o.ignorerPreference,
    enregistrerDepense: (f, usage, cout) => enregistrerDepense(f.id, usage, calculerCout(f, usage, cout)),
  };
  const stream = createUIMessageStream<MessageUI>({
    originalMessages: o.messages,
    execute: async ({ writer }) => {
      writer.write({ type: "start" });
      // 1. Lecture des liens du dernier message (cascade direct → Jina), pastilles envoyées au fur et à mesure.
      if (liensAlire.length) {
        writer.write({ type: "data-info", data: { texte: `Lecture de ${liensAlire.length} lien${liensAlire.length > 1 ? "s" : ""}…` }, transient: true });
        const contexteMin = Math.min(...liste.map((f) => f.contexte));
        const pages = await lireLiensDuMessage(texteDernier, {
          kv: deps.kv,
          budgetParPage: budgetPage(contexteMin),
          resumer: (texte, consigne, maxTokens) =>
            genererAvecRotation(deps, { systeme: consigne, prompt: texte, maxTokens, conversationId, signal: o.signal }),
          onPage: (p) => {
            const { contenu: _c, ...visible } = p;
            void _c;
            writer.write({ type: "data-page-lue", id: `page-${p.url}`, data: { ...visible, contenu: p.contenu } });
          },
        });
        const dernierUI = messagesUI.at(-1);
        if (dernierUI && dernierUI.parts[0]?.type === "text") {
          dernierUI.parts[0] = { type: "text", text: dernierUI.parts[0].text + blocPagesPourModele(pages) };
        }
      }
      // 1 bis. Demande de mod Minecraft : versions à jour et modèle de projet compilable.
      const demandeMod = detecterDemandeMod(texteDernier);
      const projetMinecraft = projet.some((f) => /(^|\/)(fabric\.mod\.json|build\.gradle(\.kts)?)$/.test(f.chemin));
      // Tour de clarification : « 26.3 » seul ne contient aucun mot-clé ; on regarde les messages récents.
      const textesRecents = o.messages.slice(-6).map((m) => texteDe(m));
      if (demandeMod.mod || projetMinecraft || conversationConcerneMod(textesRecents)) {
        try {
          // Version : le projet fait foi dès qu'un build existe (on ignore alors les journaux d'erreurs
          // du dernier message) ; avant tout fichier, on prend le dernier message puis le message
          // utilisateur récent le plus proche contenant une version.
          const versionAvantProjet =
            demandeMod.version ??
            o.messages
              .filter((m) => m.role === "user")
              .map((m) => extraireVersion(texteDe(m)))
              .reverse()
              .find(Boolean);
          const version = projetMinecraft ? versionDepuisProjet(projet) : versionAvantProjet;
          // Loader demandé (NeoForge/Forge) détecté sur l'ensemble des messages récents, pas seulement le dernier.
          const loader = textesRecents.map(detecterLoader).reverse().find(Boolean) ?? "fabric";
          const v = await versionsMinecraft(version, { kv: deps.kv });
          reglages = { ...reglages, systeme: `${reglages.systeme}\n\n${blocContexteMinecraft(v, loader)}` };
        } catch (e) {
          console.warn("[chat] contexte Minecraft indisponible :", e instanceof Error ? e.message : e);
        }
      }
      // 2. Recherche web forcée (bouton globe) : résultats injectés dans le dernier message.
      if (rechercheForcee) {
        const idPart = `recherche-${Date.now().toString(36)}`;
        writer.write({ type: "data-recherche", id: idPart, data: { requete: texteDernier.slice(0, 300), etat: "en-cours" } });
        try {
          const r = await rechercherWeb(texteDernier, { kv: deps.kv, log: (m) => console.warn(m) });
          writer.write({ type: "data-recherche", id: idPart, data: { requete: r.requete, etat: "ok", moteur: r.moteur, resultats: r.resultats.map(({ titre, url, extrait }) => ({ titre, url, extrait })) } });
          const dernierUI = messagesUI.at(-1);
          if (dernierUI && dernierUI.parts[0]?.type === "text") {
            dernierUI.parts[0] = { type: "text", text: dernierUI.parts[0].text + "\n\n" + blocRecherchePourModele(r) };
          }
        } catch (e) {
          writer.write({ type: "data-recherche", id: idPart, data: { requete: texteDernier.slice(0, 300), etat: "erreur", erreur: e instanceof Error ? e.message : "échec" } });
        }
      }
      // 3. Outil de recherche à la disposition du modèle (sauf si désactivé ou recherche déjà forcée).
      const outils =
        reglages.rechercheAuto && !rechercheForcee
          ? {
              recherche_web: tool({
                description:
                  "Recherche sur le web et renvoie des résultats avec titres, URL, extraits et le contenu des premières pages. " +
                  "À utiliser pour les informations récentes ou que tu ne connais pas avec certitude : versions, actualités, prix, événements, faits vérifiables. " +
                  "Une seule recherche bien formulée suffit en général (mots-clés précis, numéro de version, nom exact).",
                inputSchema: z.object({ requete: z.string().min(2).max(300).describe("Requête de recherche courte et précise, en français ou en anglais") }),
                execute: async ({ requete }) => {
                  try {
                    const r = await rechercherWeb(requete, { kv: deps.kv, log: (m) => console.warn(m) });
                    return { requete: r.requete, moteur: r.moteur, resultats: r.resultats, consigne: "Cite tes sources en liens Markdown [titre](url)." };
                  } catch (e) {
                    return { requete, erreur: e instanceof Error ? e.message : "échec de la recherche" };
                  }
                },
              }),
            }
          : undefined;
      const messages = await convertToModelMessages(messagesUI);
      const r = await executerChat(deps, { writer, messages, reglages, conversationId, signal: o.signal, outils });
      fournisseurUtilise = r.meta.fournisseurId;
    },
    onError: (e) => (e instanceof Error ? e.message : String(e)),
    onEnd: async ({ responseMessage }) => {
      if (persister) {
        try {
          await ajouterMessage(conversationId, responseMessage, fournisseurUtilise);
        } catch (e) {
          console.warn("[chat] persistance de la réponse impossible :", e instanceof Error ? e.message : e);
        }
        if (reglages.compilationAuto) {
          // Compilation automatique : après la réponse, sans bloquer la fin du flux (waitUntil).
          const promesse = compilationAutomatique(conversationId, o.messages, responseMessage).catch((e) =>
            console.warn("[chat] compilation automatique :", e instanceof Error ? e.message : e),
          );
          try {
            waitUntil(promesse);
          } catch {
            /* hors Vercel : la promesse tourne quand même */
          }
        }
      }
      if (o.onFin) await o.onFin(responseMessage, fournisseurUtilise);
    },
  });
  return { ok: true, stream };
}

/**
 * Lance la compilation GitHub si la réponse vient de créer ou modifier un projet Gradle, une seule
 * fois par état du projet (empreinte mémorisée), et jamais quand une tâche de fond est active sur
 * la conversation (le moteur compile lui-même).
 */
export async function compilationAutomatique(conversationId: string, historique: MessageUI[], reponse: MessageUI): Promise<void> {
  const { fichiers } = fusionnerProjetDetaille([...historique, reponse]);
  if (!estProjetGradle(fichiers) || !fichiers.some((f) => f.messageId === reponse.id)) return;
  const kv = getKV();
  const cle = `compil:auto:${conversationId}`;
  const empreinte = empreinteProjet(fichiers);
  if ((await kv.get<string>(cle)) === empreinte) return;
  const tache = await tacheDeConversation(conversationId).catch(() => null);
  if (tache && (tache.statut === "en_cours" || tache.statut === "en_attente")) return;
  await kv.set(cle, empreinte, 30 * 24 * 3600);
  try {
    const c = await lancerCompilationProjet({ conversationId, messageId: reponse.id, fichiers });
    console.warn(`[chat] compilation automatique lancée (${c.id}, ${fichiers.length} fichiers)`);
  } catch (e) {
    if (e instanceof ProjetRefuse) console.warn(`[chat] compilation automatique non lancée : ${e.message}`);
    else throw e;
  }
}

/** Consomme un flux de tour jusqu'au bout (tâches de fond) et renvoie le texte et les métadonnées. */
export async function consommerTour(stream: ReadableStream<UIMessageChunk>): Promise<{ texte: string; meta: MetaMessage; erreur?: string; reessaiA?: number }> {
  const lecteur = stream.getReader();
  let texte = "";
  let meta: MetaMessage = {};
  let erreur: string | undefined;
  let reessaiA: number | undefined;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    const c = value as UIMessageChunk & { data?: unknown };
    if (c.type === "text-delta") texte += c.delta;
    else if (c.type === "data-regeneration") texte = "";
    else if (c.type === "message-metadata") meta = { ...meta, ...(c.messageMetadata as MetaMessage) };
    else if (c.type === "error") erreur = c.errorText;
    else if (c.type === "data-tous-epuises") reessaiA = (c.data as { reessaiA?: number } | undefined)?.reessaiA;
  }
  return { texte, meta, erreur, reessaiA };
}
