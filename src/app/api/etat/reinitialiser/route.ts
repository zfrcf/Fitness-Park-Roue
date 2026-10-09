import { NextResponse } from "next/server";
import { avecAcces, exigerAdmin } from "@/lib/auth/utilisateur";
import { reinitialiserEtat } from "@/lib/fournisseurs/etat";
import { fournisseurParId } from "@/lib/fournisseurs/registre";

export const POST = avecAcces(async (req: Request) => {
  await exigerAdmin(req);
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  const f = id ? fournisseurParId(id) : undefined;
  if (!f) return NextResponse.json({ erreur: "Fournisseur inconnu." }, { status: 404 });
  await reinitialiserEtat(f.id);
  return NextResponse.json({ ok: true });
});
