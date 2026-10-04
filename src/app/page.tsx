import { FenetreChat } from "@/components/chat/fenetre-chat";
import { Coque } from "@/components/coque/coque";

export const dynamic = "force-dynamic";

function nouvelId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export default function Accueil() {
  return (
    <Coque>
      <FenetreChat key={nouvelId()} conversationId={nouvelId()} />
    </Coque>
  );
}
