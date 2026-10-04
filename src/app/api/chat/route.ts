import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, tool } from "ai";
import { z } from "zod";
import { blocRecherchePourModele, rechercherWeb } from "@/lib/recherche";
import { executerChat, genererAvecRotation } from "@/lib/chat/orchestrateur";
import { blocPagesPourModele, budgetPage, detecterLiens, lireLiensDuMessage, type PageLuePart } from "@/lib/liens";
import { normaliserReglages } from "@/lib/chat/reglages";
import type { CorpsRequeteChat, MessageUI } from "@/lib/chat/types";
import { ajouterMessage, enregistrerMessages } from "@/lib/db/conversations";
import { autoriserPayant, calculerCout, enregistrerDepense } from "@/lib/depenses";
import { lireReglages } from "@/lib/db/reglages";
import { creerModele } from "@/lib/fournisseurs/client";
import { fournisseurs } from "@/lib/fournisseurs/registre";
import { getKV } from "@/lib/kv";

// Node.js + Fluid Compute : 300 s est le maximum du plan Hobby (800 s en Pro).
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let corps: CorpsRequeteChat;
  try {
    corps = (await req.json()) as CorpsRequeteChat;
  } catch {
    return Response.json({ erreur: "Corps de requête invalide." }, { status: 400 });
  }
  if (!Array.isArray(corps.messages) || corps.messages.length === 0) {
    return Response.json({ erreur: "Aucun message." }, { status: 400 });
  }
  const conversationId = typeof corps.conversationId === "string" && corps.conversationId ? corps.conversationId.slice(0, 64) : "sans-id";
  // Réglages : ceux de la base, surchargés par ceux envoyés par le client.
  let reglages;
  try {
    reglages = normaliserReglages({ ...(await lireReglages()), ...(corps.reglages ?? {}) });
  } catch {
    reglages = normaliserReglages(corps.reglages);
  }
  // Le modèle ne connaît pas la date : on la lui donne, avec la consigne sur la recherche web.
  const dateDuJour = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeZone: process.env.TZ || "Europe/Paris" }).format(new Date());
  reglages = {
    ...reglages,
    systeme:
      `${reglages.systeme}\n\nNous sommes le ${dateDuJour}. Tes connaissances s'arrêtent avant cette date : ` +
      "pour tout ce qui est récent (versions de logiciels ou de jeux, actualités, prix, événements, personnes), " +
      (reglages.rechercheAuto
        ? "utilise l'outil recherche_web avant d'affirmer qu'une chose n'existe pas, puis cite tes sources en liens Markdown."
        : "précise que tu n'as pas pu vérifier et invite l'utilisateur à activer la recherche web (bouton globe)."),
  };

  const liste = fournisseurs();
  if (liste.length === 0) {
    return Response.json({ erreur: "Aucun fournisseur configuré (variables PROVIDER_n_*)." }, { status: 503 });
  }

  // Historique pour le modèle : parties texte uniquement ; les pages lues aux tours précédents
  // (parties data-page-lue des réponses) sont réinjectées dans le message utilisateur qui les a demandées.
  const messagesUI: MessageUI[] = [];
  for (let i = 0; i < corps.messages.length; i++) {
    const m = corps.messages[i];
    const texte = m.parts.filter((p) => p.type === "text").map((p) => p.text).join("");
    let supplement = "";
    if (m.role === "user") {
      const suivant = corps.messages[i + 1];
      const pages = (suivant?.role === "assistant" ? suivant.parts : [])
        .filter((p) => p.type === "data-page-lue")
        .map((p) => p.data as PageLuePart);
      if (pages.length) supplement = blocPagesPourModele(pages);
    }
    messagesUI.push({ ...m, parts: [{ type: "text", text: texte + supplement }] });
  }
  const dernier = corps.messages.at(-1);
  const texteDernier = dernier?.role === "user" ? dernier.parts.filter((p) => p.type === "text").map((p) => p.text).join("") : "";
  const liensAlire = detecterLiens(texteDernier);

  // L'historique envoyé par le client fait foi (édition, régénération) : on le persiste tel quel.
  if (conversationId !== "sans-id") {
    try {
      await enregistrerMessages(conversationId, corps.messages);
    } catch (e) {
      console.warn("[chat] persistance impossible :", e instanceof Error ? e.message : e);
    }
  }

  const rechercheForcee = corps.rechercheWeb === true && texteDernier.trim().length > 0;

  let fournisseurUtilise: string | undefined;
  const deps = {
    fournisseurs: liste,
    kv: getKV(),
    creerModele,
    log: (m: string) => console.warn(m),
    autoriserPayant,
    enregistrerDepense: (f: (typeof liste)[number], usage: { entree: number; sortie: number }, cout?: number) =>
      enregistrerDepense(f.id, usage, calculerCout(f, usage, cout)),
  };
  const stream = createUIMessageStream<MessageUI>({
    originalMessages: corps.messages,
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
            genererAvecRotation(deps, { systeme: consigne, prompt: texte, maxTokens, conversationId, signal: req.signal }),
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
                  "Recherche sur le web (DuckDuckGo) et renvoie des résultats avec titres, URL, extraits et le contenu des premières pages. " +
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
      const r = await executerChat(deps, { writer, messages, reglages, conversationId, signal: req.signal, outils });
      fournisseurUtilise = r.meta.fournisseurId;
    },
    onError: (e) => (e instanceof Error ? e.message : String(e)),
    onEnd: async ({ responseMessage }) => {
      if (conversationId === "sans-id") return;
      try {
        await ajouterMessage(conversationId, responseMessage, fournisseurUtilise);
      } catch (e) {
        console.warn("[chat] persistance de la réponse impossible :", e instanceof Error ? e.message : e);
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}
