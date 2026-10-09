import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ipDepuisRequete } from "@/lib/auth/tentatives";
import { creerJeton, NOM_COOKIE, optionsCookie } from "@/lib/auth/session";
import { envoyerCourriel } from "@/lib/comptes/courriel";
import { creerJetonVerification, inscrire, inscriptionsTentees, RefusInscription } from "@/lib/comptes/inscription";
import { COOKIE_APPAREIL } from "@/lib/comptes/appareil";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (process.env.INSCRIPTIONS_FERMEES === "1") return NextResponse.json({ erreur: "Les inscriptions sont fermées." }, { status: 403 });
  const ip = ipDepuisRequete(req);
  if ((await inscriptionsTentees(ip)) > 10) {
    return NextResponse.json({ erreur: "Trop de tentatives d'inscription : réessayez dans une heure." }, { status: 429 });
  }
  const corps = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const texte = (k: string) => (typeof corps[k] === "string" ? (corps[k] as string) : "");
  // Champ piège invisible : un humain le laisse vide, un robot le remplit.
  if (texte("site")) return NextResponse.json({ ok: true, mode: "admin" });
  const appareilCookie = (await cookies()).get(COOKIE_APPAREIL)?.value ?? "";
  try {
    const { utilisateur, mode } = await inscrire({
      nom: texte("nom"),
      email: texte("email"),
      motDePasse: texte("motDePasse").slice(0, 300),
      appareils: [appareilCookie, texte("appareil")],
      ip,
    });
    if (mode === "email") {
      const jeton = await creerJetonVerification(utilisateur.id);
      const base = process.env.APP_URL || new URL(req.url).origin;
      const lien = `${base}/api/verification?jeton=${encodeURIComponent(jeton)}`;
      try {
        await envoyerCourriel({
          a: utilisateur.email,
          sujet: "Activez votre compte Chat IA",
          texte: `Bonjour ${utilisateur.nom},\n\nPour activer votre compte, ouvrez ce lien (valable 48 h) :\n${lien}\n\nSi vous n'êtes pas à l'origine de cette inscription, ignorez ce message.`,
          html: `<p>Bonjour ${utilisateur.nom.replace(/[<>&"]/g, "")},</p><p>Pour activer votre compte, cliquez sur ce lien (valable 48 h) :</p><p><a href="${lien}">Activer mon compte</a></p><p>Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message.</p>`,
        });
      } catch (e) {
        console.warn("[inscription] e-mail non envoyé :", e instanceof Error ? e.message : e);
        return NextResponse.json({ ok: true, mode: "admin", info: "L'e-mail d'activation n'a pas pu partir : l'administrateur validera votre compte." }, { status: 201 });
      }
    }
    const reponse = NextResponse.json({ ok: true, mode }, { status: 201 });
    if (mode === "aucune") reponse.cookies.set(NOM_COOKIE, await creerJeton({ uid: utilisateur.id, role: "membre" }), optionsCookie());
    return reponse;
  } catch (e) {
    if (e instanceof RefusInscription) return NextResponse.json({ erreur: e.message, code: e.code }, { status: e.statut });
    console.warn("[inscription] échec :", e instanceof Error ? e.message : e);
    return NextResponse.json({ erreur: "Inscription impossible pour le moment (base de données indisponible)." }, { status: 503 });
  }
}
