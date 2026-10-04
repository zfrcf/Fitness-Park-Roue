import { NextResponse } from "next/server";
import { listerConversations } from "@/lib/db/conversations";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? undefined;
  try {
    return NextResponse.json({ conversations: await listerConversations(q) });
  } catch (e) {
    return NextResponse.json({ erreur: e instanceof Error ? e.message : "Base de données indisponible." }, { status: 500 });
  }
}
