import { NextResponse, type NextRequest } from "next/server";
import { NOM_COOKIE, verifierJeton } from "@/lib/auth/session";

/** Chemins accessibles sans session. */
// /api/taches/executer vérifie lui-même son jeton interne ; /api/taches/reveiller est idempotent et sans donnée.
const PUBLICS = new Set(["/connexion", "/api/connexion", "/api/taches/executer", "/api/taches/reveiller"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
  const suivant = pathname + request.nextUrl.search;
  if (suivant !== "/") url.searchParams.set("suivant", suivant);
  return NextResponse.redirect(url);
}

export const config = {
  // Tout sauf les ressources statiques de Next et le favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webp|txt|xml)$).*)"],
};
