import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { executerChat } from "@/lib/chat/orchestrateur";
import { normaliserReglages } from "@/lib/chat/reglages";
import type { CorpsRequeteChat, MessageUI } from "@/lib/chat/types";
import { ajouterMessage, enregistrerMessages } from "@/lib/db/conversations";
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

  // Seules les parties texte comptent pour le modèle (les parties de données servent à l'affichage).
  const messagesUI = corps.messages.map((m) => ({
    ...m,
    parts: m.parts.filter((p) => p.type === "text"),
  })) as MessageUI[];
  const messages = await convertToModelMessages(messagesUI);

  const liste = fournisseurs();
  if (liste.length === 0) {
    return Response.json({ erreur: "Aucun fournisseur configuré (variables PROVIDER_n_*)." }, { status: 503 });
  }

  // L'historique envoyé par le client fait foi (édition, régénération) : on le persiste tel quel.
  if (conversationId !== "sans-id") {
    try {
      await enregistrerMessages(conversationId, corps.messages);
    } catch (e) {
      console.warn("[chat] persistance impossible :", e instanceof Error ? e.message : e);
    }
  }

  let fournisseurUtilise: string | undefined;
  const stream = createUIMessageStream<MessageUI>({
    originalMessages: corps.messages,
    execute: async ({ writer }) => {
      const r = await executerChat(
        { fournisseurs: liste, kv: getKV(), creerModele, log: (m) => console.warn(m) },
        { writer, messages, reglages, conversationId, signal: req.signal },
      );
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
