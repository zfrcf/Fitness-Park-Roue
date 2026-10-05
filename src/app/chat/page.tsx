import { FenetreChat } from "@/components/chat/fenetre-chat";
import { Coque } from "@/components/coque/coque";

export const dynamic = "force-dynamic";

function nouvelId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

/** Nouvelle conversation ; le premier message éventuel est lu depuis sessionStorage (posé par l'accueil). */
export default function PageNouvelleConversation() {
  const id = nouvelId();
  return (
    <Coque>
      <FenetreChat key={id} conversationId={id} />
    </Coque>
  );
}
