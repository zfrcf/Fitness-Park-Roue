/** Destination interne sûre après connexion : refuse les redirections ouvertes (//evil, https://…). */
export function destinationSure(suivant: string | null): string {
  if (!suivant) return "/";
  try {
    const origine = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const u = new URL(suivant, origine);
    if (u.origin !== origine || u.pathname === "/connexion") return "/";
    return u.pathname + u.search;
  } catch {
    return "/";
  }
}
