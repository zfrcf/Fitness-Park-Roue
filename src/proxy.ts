import { NextResponse, type NextRequest } from "next/server";
import { NOM_COOKIE, verifierJeton } from "@/lib/auth/session";
import { modeLocal } from "@/lib/mode";
import { requeteLocaleSure } from "@/lib/auth/local";

/** Chemins accessibles sans session. */
// /api/taches/executer vérifie son jeton interne ; /api/taches/reveiller est idempotent, verrouillé, et exige REVEIL_TOKEN si défini.
const PUBLICS = new Set(["/connexion", "/api/connexion", "/api/taches/executer", "/api/taches/reveiller"]);

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

  const connecte = await verifierJeton(request.cookies.get(NOM_COOKIE)?.value);

  if (PUBLICS.has(pathname)) {
    // Déjà connecté : pas besoin de revoir la page de connexion.
    if (connecte && pathname === "/connexion") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (connecte) return NextResponse.next();

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
