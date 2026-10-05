import type { NextRequest } from "next/server";

const HOTES_LOCAUX = new Set(["127.0.0.1", "localhost", "[::1]"]);

function nomHote(hote: string | null): string | null {
  if (!hote) return null;
  const m = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(hote.trim().toLowerCase());
  return m ? m[1] : null;
}

/** Atelier local : la requête vient-elle bien de l'application elle-même, sur cette machine ? */
export function requeteLocaleSure(request: Pick<NextRequest, "headers" | "method">): boolean {
  const hote = nomHote(request.headers.get("host"));
  if (!hote || !HOTES_LOCAUX.has(hote)) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origine = request.headers.get("origin");
  if (origine && origine !== "null") {
    try {
      if (new URL(origine).host.toLowerCase() !== request.headers.get("host")?.toLowerCase()) return false;
    } catch {
      return false;
    }
  } else if (origine === "null" && !["GET", "HEAD"].includes(request.method)) {
    return false;
  }
  return true;
}
