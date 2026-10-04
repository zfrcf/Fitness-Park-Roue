import { NextResponse } from "next/server";
import {
  NOM_COOKIE,
  creerJeton,
  egalConstant,
  optionsCookie,
} from "@/lib/auth/session";
import {
  enregistrerEchec,
  ipDepuisRequete,
  reinitialiser,
  tentativesRestantes,
} from "@/lib/auth/tentatives";

export async function POST(req: Request) {
  const attendu = process.env.APP_PASSWORD;
  if (!attendu) {
    return NextResponse.json(
      { erreur: "APP_PASSWORD n'est pas configuré sur le serveur.", code: "config" },
      { status: 500 },
    );
  }

  const ip = ipDepuisRequete(req);
  const etat = await tentativesRestantes(ip);
  if (etat.restantes === 0) {
    return NextResponse.json(
      {
        erreur: "Trop de tentatives. Réessayez plus tard.",
        code: "verrouille",
        reessaiDans: etat.reessaiDans,
      },
      { status: 429, headers: { "Retry-After": String(etat.reessaiDans) } },
    );
  }

  let motDePasse = "";
  try {
    const corps = (await req.json()) as { motDePasse?: unknown };
    motDePasse = typeof corps.motDePasse === "string" ? corps.motDePasse : "";
  } catch {
    return NextResponse.json({ erreur: "Requête invalide.", code: "invalide" }, { status: 400 });
  }

  if (!egalConstant(motDePasse, attendu)) {
    const apres = await enregistrerEchec(ip);
    return NextResponse.json(
      {
        erreur:
          apres.restantes > 0
            ? `Mot de passe incorrect. ${apres.restantes} tentative${apres.restantes > 1 ? "s" : ""} restante${apres.restantes > 1 ? "s" : ""}.`
            : "Mot de passe incorrect. Compte verrouillé temporairement.",
        code: "incorrect",
        restantes: apres.restantes,
        reessaiDans: apres.reessaiDans,
      },
      { status: 401 },
    );
  }

  await reinitialiser(ip);
  const reponse = NextResponse.json({ ok: true });
  reponse.cookies.set(NOM_COOKIE, await creerJeton(), optionsCookie());
  return reponse;
}
