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
import { normaliserEmail } from "@/lib/comptes/email";
import { verifierMotDePasse } from "@/lib/comptes/motdepasse";
import { courrielDisponible } from "@/lib/comptes/courriel";
import { majUtilisateur, utilisateurParEmail } from "@/lib/db/utilisateurs";

/** Hachage valide d'un mot de passe aléatoire : sert à égaliser le temps de réponse. */
const HACHAGE_LEURRE = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

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
  let email = "";
  try {
    const corps = (await req.json()) as { motDePasse?: unknown; email?: unknown };
    motDePasse = typeof corps.motDePasse === "string" ? corps.motDePasse.slice(0, 300) : "";
    email = typeof corps.email === "string" ? corps.email.trim().slice(0, 254) : "";
  } catch {
    return NextResponse.json({ erreur: "Requête invalide.", code: "invalide" }, { status: 400 });
  }

  // Compte inscrit (adresse e-mail + mot de passe).
  if (email) {
    const u = await utilisateurParEmail(normaliserEmail(email)).catch(() => null);
    // Hachage calculé même sans compte : le temps de réponse ne révèle pas si l'adresse existe.
    const bon = await verifierMotDePasse(motDePasse, u?.hash ?? HACHAGE_LEURRE);
    if (!u || !bon) {
      const apres = await enregistrerEchec(ip);
      return NextResponse.json(
        {
          erreur: apres.restantes > 0 ? `Adresse ou mot de passe incorrect. ${apres.restantes} tentative${apres.restantes > 1 ? "s" : ""} restante${apres.restantes > 1 ? "s" : ""}.` : "Trop d'échecs : connexion bloquée temporairement.",
          code: "incorrect",
          restantes: apres.restantes,
          reessaiDans: apres.reessaiDans,
        },
        { status: 401 },
      );
    }
    await reinitialiser(ip);
    if (u.statut === "en_attente") {
      return NextResponse.json({ erreur: courrielDisponible() ? "Compte pas encore activé : cliquez sur le lien reçu par e-mail." : "Compte en attente de validation par l'administrateur.", code: "en_attente" }, { status: 403 });
    }
    if (u.statut !== "actif") return NextResponse.json({ erreur: "Ce compte est désactivé.", code: "bloque" }, { status: 403 });
    await majUtilisateur(u.id, { derniereConnexion: new Date() }).catch(() => null);
    const reponse = NextResponse.json({ ok: true });
    reponse.cookies.set(NOM_COOKIE, await creerJeton({ uid: u.id, role: "membre" }), optionsCookie());
    return reponse;
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
