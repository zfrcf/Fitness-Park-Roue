import { convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { executerChat } from "@/lib/chat/orchestrateur";
import { normaliserReglages } from "@/lib/chat/reglages";
import type { CorpsRequeteChat, MessageUI } from "@/lib/chat/types";
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
  const reglages = normaliserReglages(corps.reglages);

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

  const stream = createUIMessageStream<MessageUI>({
    execute: async ({ writer }) => {
      await executerChat(
        { fournisseurs: liste, kv: getKV(), creerModele, log: (m) => console.warn(m) },
        { writer, messages, reglages, conversationId, signal: req.signal },
      );
    },
    onError: (e) => (e instanceof Error ? e.message : String(e)),
  });

  return createUIMessageStreamResponse({ stream });
}
