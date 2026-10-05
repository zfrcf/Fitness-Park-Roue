import { NextResponse } from "next/server";
import { ajouterMessage, enregistrerMessages, lireConversation, titreDepuisTexte } from "@/lib/db/conversations";
import { creerTache, listerTaches, versPublic } from "@/lib/db/taches";
import { reveillerTaches } from "@/lib/taches";
import { planificateurHTTP } from "@/lib/taches/planificateur";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    // Chaque consultation relance aussi les tâches dues (filet si aucun cron n'est configuré).
    const relancees = await reveillerTaches().catch(() => [] as string[]);
    const liste = (await listerTaches()).map(versPublic);
    return NextResponse.json({ taches: liste, relancees, maintenant: Date.now() });
  } catch (e) {
    return NextResponse.json({ erreur: e instanceof Error ? e.message : "base indisponible" }, { status: 503 });
  }
}

interface Corps {
  objectif?: string;
  conversationId?: string;
  /** Message utilisateur ajouté en fin de conversation existante (ex. demande de correction). */
  messageInitial?: string;
  compiler?: boolean;
  auto?: boolean;
  maxCycles?: number;
}

export async function POST(req: Request) {
  const corps = ((await req.json().catch(() => null)) as Corps | null) ?? {};
  const objectif = typeof corps.objectif === "string" ? corps.objectif.trim() : "";
  const compiler = corps.compiler !== false;
  const auto = corps.auto === true;
  const maxCycles = Math.min(20, Math.max(1, Math.round(Number(corps.maxCycles) || 8)));
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    let conversationId = typeof corps.conversationId === "string" ? corps.conversationId.slice(0, 64) : "";
    let titre: string;
    if (conversationId) {
      const conv = await lireConversation(conversationId);
      if (!conv) return NextResponse.json({ erreur: "Conversation introuvable." }, { status: 404 });
      titre = conv.conversation.titre;
      // Seul messageInitial ajoute un message ; objectif ne sert qu'au titre de la tâche.
      const message = typeof corps.messageInitial === "string" ? corps.messageInitial.trim() : "";
      if (message) {
        await ajouterMessage(conversationId, { id: `tache-${id}`, role: "user", parts: [{ type: "text", text: message }] });
      }
    } else {
      if (objectif.length < 3) return NextResponse.json({ erreur: "Décrivez l'objectif de la tâche." }, { status: 400 });
      conversationId = `t${id.replace("-", "")}`.slice(0, 20);
      titre = titreDepuisTexte(objectif);
      await enregistrerMessages(conversationId, [{ id: `u-${id}`, role: "user", parts: [{ type: "text", text: objectif }] }]);
    }
    const t = await creerTache({
      id,
      conversationId,
      titre,
      objectif: objectif || corps.messageInitial?.slice(0, 500) || titre,
      compiler: compiler ? 1 : 0,
      auto: auto ? 1 : 0,
      maxCycles,
      statut: "en_attente",
      etape: "en attente de démarrage",
      journal: [{ a: Date.now(), texte: "tâche créée" }],
    });
    await planificateurHTTP.programmer(id, 0);
    return NextResponse.json({ tache: versPublic(t) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ erreur: e instanceof Error ? e.message : "base indisponible" }, { status: 503 });
  }
}
