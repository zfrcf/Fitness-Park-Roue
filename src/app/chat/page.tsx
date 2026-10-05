import { FenetreChat } from "@/components/chat/fenetre-chat";
import { Coque } from "@/components/coque/coque";

export const dynamic = "force-dynamic";

function nouvelId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

/** Nouvelle conversation ; `?q=` envoie un premier message dès l'arrivée (depuis l'accueil). */
export default async function PageNouvelleConversation({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  const messageInitial = typeof q === "string" ? q.slice(0, 20_000) : undefined;
  const id = nouvelId();
  return (
    <Coque>
      <FenetreChat key={id} conversationId={id} messageInitial={messageInitial} />
    </Coque>
  );
}
