import { NextResponse } from "next/server";
import { creerJeton, NOM_COOKIE, optionsCookie } from "@/lib/auth/session";
import { oublierCompte } from "@/lib/auth/utilisateur";
import { consommerJetonVerification } from "@/lib/comptes/inscription";
import { lireUtilisateur, majUtilisateur } from "@/lib/db/utilisateurs";

export const dynamic = "force-dynamic";

/** Lien reçu par e-mail : active le compte et ouvre la session. */
export async function GET(req: Request) {
  const jeton = new URL(req.url).searchParams.get("jeton") ?? "";
  const uid = await consommerJetonVerification(jeton);
  const u = uid ? await lireUtilisateur(uid) : null;
  if (!u || u.statut === "bloque") return NextResponse.redirect(new URL("/connexion?activation=invalide", req.url));
  if (u.statut === "en_attente") await majUtilisateur(u.id, { statut: "actif" });
  await oublierCompte(u.id);
  const reponse = NextResponse.redirect(new URL("/", req.url));
  reponse.cookies.set(NOM_COOKIE, await creerJeton({ uid: u.id, role: "membre" }), optionsCookie());
  return reponse;
}
