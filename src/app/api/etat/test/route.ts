import { NextResponse } from "next/server";
import { fournisseurParId } from "@/lib/fournisseurs/registre";
import { testerFournisseur } from "@/lib/fournisseurs/test";
import { etatComplet } from "@/lib/fournisseurs/quota";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  const f = id ? fournisseurParId(id) : undefined;
  if (!f) return NextResponse.json({ erreur: "Fournisseur inconnu." }, { status: 404 });
  const resultat = await testerFournisseur(f);
  return NextResponse.json({ resultat, etat: await etatComplet(f) });
}
