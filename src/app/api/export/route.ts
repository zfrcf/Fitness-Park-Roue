import { toutExporter } from "@/lib/db/conversations";

export const dynamic = "force-dynamic";

/** Export complet de l'historique (JSON). */
export async function GET() {
  const tout = await toutExporter();
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify({ exporteLe: new Date().toISOString(), conversations: tout }, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="chat-ia-export-${date}.json"`,
    },
  });
}
