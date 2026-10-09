import { NextResponse, type NextRequest } from "next/server";
import { lireJeton, NOM_COOKIE } from "@/lib/auth/session";
import { COOKIE_APPAREIL, DUREE_APPAREIL_SECONDES } from "@/lib/comptes/appareil";
import { modeLocal } from "@/lib/mode";
import { requeteLocaleSure } from "@/lib/auth/local";

/** Chemins accessibles sans session. */
// /api/taches/executer vérifie son jeton interne ; /api/taches/reveiller est idempotent, verrouillé, et exige REVEIL_TOKEN si défini.
const PUBLICS = new Set(["/connexion", "/inscription", "/api/connexion", "/api/inscription", "/api/verification", "/api/taches/executer", "/api/taches/reveiller"]);
/** Pages et API réservées à l'administrateur. */
const RE_ADMIN = /^\/(etat|admin)(\/|$)|^\/api\/(etat\/(test|reinitialiser)|admin)(\/|$)/;

/** Identifiant d'appareil posé une fois (httpOnly) : sert à refuser les doubles comptes. */
function avecAppareil(request: NextRequest, reponse: NextResponse): NextResponse {
  if (!request.cookies.get(COOKIE_APPAREIL) && !request.nextUrl.pathname.startsWith("/api/")) {
    reponse.cookies.set(COOKIE_APPAREIL, crypto.randomUUID().replace(/-/g, ""), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: DUREE_APPAREIL_SECONDES,
    });
  }
  return reponse;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Atelier local : application personnelle lancée par « atelier ui », serveur lié à 127.0.0.1
  // uniquement. Pas de mot de passe (la page de connexion renvoie à l'accueil).
  // Sans mot de passe, il faut empêcher un site ouvert dans le navigateur de piloter l'application
  // (une compilation exécute du code) : hôte local exigé (anti-rebinding DNS) et requêtes
  // intersites refusées (anti-CSRF).
  if (modeLocal()) {
    if (!requeteLocaleSure(request)) return new NextResponse("Requête refusée (atelier local).", { status: 403 });
    return pathname === "/connexion" ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }

  const identite = await lireJeton(request.cookies.get(NOM_COOKIE)?.value);
  const connecte = identite !== null;

  if (PUBLICS.has(pathname)) {
    // Déjà connecté : pas besoin de revoir la page de connexion ni d'inscription.
    if (connecte && (pathname === "/connexion" || pathname === "/inscription")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return avecAppareil(request, NextResponse.next());
  }

  if (connecte) {
    if (identite.role !== "admin" && RE_ADMIN.test(pathname)) {
      return pathname.startsWith("/api/")
        ? NextResponse.json({ erreur: "Réservé à l'administrateur.", code: "acces_refuse" }, { status: 403 })
        : NextResponse.redirect(new URL("/", request.url));
    }
    return avecAppareil(request, NextResponse.next());
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { erreur: "Non authentifié", code: "non_authentifie" },
      { status: 401 },
    );
  }

  const url = new URL("/connexion", request.url);
  // Uniquement un chemin interne simple (pas //evil ni /\evil) pour éviter une redirection ouverte.
  if (/^\/(?![/\\])/.test(pathname) && pathname !== "/") {
    url.searchParams.set("suivant", pathname + request.nextUrl.search);
  }
  return NextResponse.redirect(url);
}

export const config = {
  // Tout sauf les ressources statiques de Next et le favicon. L'exemption par extension ne
  // s'applique PAS sous /api/ : sinon /api/taches/x.txt passerait sans session. (#46)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|(?!api/).*\\.(?:png|svg|ico|webp|txt|xml)$).*)"],
};
