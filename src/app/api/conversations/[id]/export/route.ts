import { lireConversation, versMarkdown } from "@/lib/db/conversations";
import { avecAcces, exigerConversation, exigerUtilisateur } from "@/lib/auth/utilisateur";

export const dynamic = "force-dynamic";

function nomFichier(titre: string, ext: string) {
  const base = titre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "conversation";
  return `${base}.${ext}`;
}

export const GET = avecAcces(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await exigerConversation(await exigerUtilisateur(req), id);
  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "md";
  const r = await lireConversation(id);
  if (!r) return Response.json({ erreur: "Conversation introuvable." }, { status: 404 });
  if (format === "json") {
    return new Response(JSON.stringify(r, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${nomFichier(r.conversation.titre, "json")}"`,
      },
    });
  }
  return new Response(versMarkdown(r.conversation, r.messages), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${nomFichier(r.conversation.titre, "md")}"`,
    },
  });
});
