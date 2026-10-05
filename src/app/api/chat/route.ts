import { createUIMessageStreamResponse } from "ai";
import { executerTour } from "@/lib/chat/tour";
import type { CorpsRequeteChat } from "@/lib/chat/types";

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
  const conversationId = typeof corps.conversationId === "string" && corps.conversationId ? corps.conversationId : "sans-id";
  const r = await executerTour({
    conversationId,
    messages: corps.messages,
    reglagesClient: corps.reglages,
    rechercheWeb: corps.rechercheWeb === true,
    signal: req.signal,
  });
  if (!r.ok) return Response.json({ erreur: r.erreur }, { status: r.statut });
  return createUIMessageStreamResponse({ stream: r.stream });
}
