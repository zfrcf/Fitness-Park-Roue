/** Accès à l'API GitHub pour le dépôt de compilation (GITHUB_REPO, GITHUB_TOKEN). */

export function depotCompilation(env: Record<string, string | undefined> = process.env): { proprietaire: string; nom: string } {
  const brut = env.GITHUB_REPO?.trim() || "zfrcf/Fitness-Park-Roue";
  const [proprietaire, nom] = brut.split("/");
  if (!proprietaire || !nom) throw new Error("GITHUB_REPO doit être de la forme proprietaire/depot");
  return { proprietaire, nom };
}

export class ErreurGitHub extends Error {
  constructor(
    public statut: number,
    message: string,
  ) {
    super(message);
  }
}

export async function github<T = unknown>(
  chemin: string,
  init: RequestInit & { brut?: boolean } = {},
  env: Record<string, string | undefined> = process.env,
  f: typeof fetch = fetch,
): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "chat-ia-compilation",
    ...(init.headers as Record<string, string> | undefined),
  };
  const token = env.GITHUB_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
  const r = await f(chemin.startsWith("http") ? chemin : `https://api.github.com${chemin}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    let detail = "";
    try {
      const j = (await r.json()) as { message?: string };
      detail = j.message ?? "";
    } catch {
      /* corps non JSON */
    }
    // Limite de débit (403/429 « rate limit », limite secondaire, « abuse ») : pas un problème de jeton. (#21)
    if ((r.status === 403 || r.status === 429) && /rate limit|secondary|abuse|too many requests/i.test(detail)) {
      throw new ErreurGitHub(r.status, `GitHub limite temporairement le débit (${r.status}) : ${detail || "réessayez dans un instant"}`.trim());
    }
    if (r.status === 401 || r.status === 403) {
      throw new ErreurGitHub(r.status, `GitHub refuse l'accès (${r.status}) : vérifiez GITHUB_TOKEN (permissions Contents et Actions sur le dépôt). ${detail}`.trim());
    }
    throw new ErreurGitHub(r.status, `GitHub : HTTP ${r.status} ${detail}`.trim());
  }
  if (init.brut) return r as unknown as T;
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}
