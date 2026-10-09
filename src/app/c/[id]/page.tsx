import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FenetreChat } from "@/components/chat/fenetre-chat";
import { Coque } from "@/components/coque/coque";
import { lireConversation, proprietaireConversation } from "@/lib/db/conversations";
import { proprietaire, utilisateurServeur } from "@/lib/auth/utilisateur";

/** La conversation est-elle visible par le compte connecté ? (une inexistante : oui, elle sera la sienne) */
async function accessible(id: string): Promise<boolean> {
  const u = await utilisateurServeur();
  if (!u) return false;
  const c = await proprietaireConversation(id).catch(() => ({ existe: false, proprietaire: null }));
  return !c.existe || c.proprietaire === proprietaire(u);
}
import { tacheDeConversation, versPublic } from "@/lib/db/taches";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!(await accessible(id))) return { title: "Conversation" };
  const r = await lireConversation(id).catch(() => null);
  return { title: r?.conversation.titre ?? "Conversation" };
}

export default async function PageConversation({ params }: Props) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) notFound();
  if (!(await accessible(id))) notFound();
  const [r, tache] = await Promise.all([lireConversation(id).catch(() => null), tacheDeConversation(id).catch(() => null)]);
  // Conversation inconnue en base (par ex. créée mais pas encore de réponse) : on démarre vide avec cet id.
  return (
    <Coque>
      <FenetreChat key={id} conversationId={id} messagesInitiaux={r?.messages ?? []} tacheInitiale={tache ? versPublic(tache) : undefined} />
    </Coque>
  );
}
