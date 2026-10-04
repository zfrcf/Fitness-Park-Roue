import { Entete } from "@/components/coque/entete";
import { FenetreChat } from "@/components/chat/fenetre-chat";

export default function Accueil() {
  return (
    <main className="flex h-dvh flex-col">
      <Entete />
      <FenetreChat conversationId="brouillon" />
    </main>
  );
}
