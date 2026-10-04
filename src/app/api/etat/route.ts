import { NextResponse } from "next/server";
import { fournisseurs, versPublic } from "@/lib/fournisseurs/registre";
import { etatComplet } from "@/lib/fournisseurs/quota";
import { getKV } from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function GET() {
  const liste = fournisseurs();
  const etats = await Promise.all(liste.map((f) => etatComplet(f)));
  return NextResponse.json({
    fournisseurs: liste.map((f, i) => ({ ...versPublic(f), etat: etats[i] })),
    stockage: { kv: getKV().type },
    plafondMensuel: Number(process.env.PAID_MONTHLY_CAP ?? 0) || 0,
    maintenant: Date.now(),
  });
}
