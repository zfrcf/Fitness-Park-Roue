import { NextResponse } from "next/server";
import { fournisseurs, versPublic } from "@/lib/fournisseurs/registre";
import { etatComplet } from "@/lib/fournisseurs/quota";
import { getKV } from "@/lib/kv";
import { depensesDuMois, moisCourant, plafondMensuel } from "@/lib/depenses";

export const dynamic = "force-dynamic";

export async function GET() {
  const liste = fournisseurs();
  const [etats, depenses] = await Promise.all([Promise.all(liste.map((f) => etatComplet(f))), depensesDuMois().catch(() => [])]);
  return NextResponse.json({
    fournisseurs: liste.map((f, i) => ({ ...versPublic(f), etat: etats[i], depense: depenses.find((d) => d.fournisseurId === f.id) ?? null })),
    stockage: { kv: getKV().type },
    plafondMensuel: plafondMensuel(),
    mois: moisCourant(),
    depenseTotale: depenses.reduce((s, d) => s + d.montant, 0),
    maintenant: Date.now(),
  });
}
