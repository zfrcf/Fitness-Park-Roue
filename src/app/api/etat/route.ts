import { NextResponse } from "next/server";
import { fournisseurs, versPublic } from "@/lib/fournisseurs/registre";
import { etatComplet } from "@/lib/fournisseurs/quota";
import { lireLimites } from "@/lib/fournisseurs/limites";
import { creneauxUtilises, rpmDe } from "@/lib/fournisseurs/debit";
import { getKV } from "@/lib/kv";
import { depensesDuMois, moisCourant, plafondMensuel } from "@/lib/depenses";

export const dynamic = "force-dynamic";

export async function GET() {
  const liste = fournisseurs();
  const kv = getKV();
  const maintenant = Date.now();
  const [etats, depenses, extras] = await Promise.all([
    Promise.all(liste.map((f) => etatComplet(f))),
    depensesDuMois().catch(() => []),
    Promise.all(
      liste.map(async (f) => ({
        limites: await lireLimites(kv, f.id).catch(() => ({})),
        debit: await creneauxUtilises(kv, f, maintenant).catch(() => ({ utilise: 0, limite: rpmDe(f) })),
        occupePar: (await kv.get<string>(`tache:fournisseur:${f.id}`).catch(() => null)) ?? null,
      })),
    ),
  ]);
  return NextResponse.json({
    fournisseurs: liste.map((f, i) => ({
      ...versPublic(f),
      etat: etats[i],
      depense: depenses.find((d) => d.fournisseurId === f.id) ?? null,
      limites: extras[i].limites,
      debit: extras[i].debit,
      occupe: !!extras[i].occupePar,
    })),
    stockage: { kv: kv.type },
    plafondMensuel: plafondMensuel(),
    mois: moisCourant(),
    depenseTotale: depenses.reduce((s, d) => s + d.montant, 0),
    maintenant,
  });
}
