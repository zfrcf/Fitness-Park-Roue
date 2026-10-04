import { NextResponse } from "next/server";
import type { Reglages } from "@/lib/chat/types";
import { ecrireReglages, lireReglages } from "@/lib/db/reglages";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ reglages: await lireReglages() });
}

export async function PUT(req: Request) {
  const corps = (await req.json().catch(() => ({}))) as Partial<Reglages>;
  return NextResponse.json({ reglages: await ecrireReglages(corps) });
}
