/**
 * Génération d'images sans aucune configuration supplémentaire :
 * 1. Cloudflare Workers AI (FLUX.1 schnell) avec le compte et le jeton du fournisseur Cloudflare
 *    déjà déclaré pour le chat (quota gratuit quotidien partagé) ;
 * 2. à défaut (quota épuisé, pas de Cloudflare), Pollinations, gratuit et sans clé (petit filigrane).
 */
import type { Fournisseur } from "@/lib/fournisseurs/types";

export interface ImageGeneree {
  /** data:image/…;base64,… */
  url: string;
  source: "cloudflare" | "pollinations";
}

type Fetch = typeof fetch;
const DELAI_MS = 90_000;

/** URL « run » de Workers AI déduite de l'URL OpenAI-compatible du fournisseur Cloudflare. */
export function urlCloudflareFlux(baseUrl: string): string | null {
  const m = /^(https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/ai)\/v1\/?$/.exec(baseUrl.trim());
  return m ? `${m[1]}/run/@cf/black-forest-labs/flux-1-schnell` : null;
}

function signal(externe?: AbortSignal): AbortSignal {
  const delai = AbortSignal.timeout(DELAI_MS);
  return externe ? AbortSignal.any([externe, delai]) : delai;
}

async function viaCloudflare(f: Fournisseur, prompt: string, fetcher: Fetch, externe?: AbortSignal): Promise<ImageGeneree> {
  const url = urlCloudflareFlux(f.baseUrl);
  if (!url) throw new Error("URL Cloudflare inattendue");
  const r = await fetcher(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${f.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: prompt.slice(0, 2048), steps: 4 }),
    signal: signal(externe),
  });
  const j = (await r.json().catch(() => null)) as { result?: { image?: string }; errors?: Array<{ message?: string }> } | null;
  if (!r.ok || !j?.result?.image) throw new Error(j?.errors?.[0]?.message?.slice(0, 200) ?? `Cloudflare ${r.status}`);
  return { url: `data:image/jpeg;base64,${j.result.image}`, source: "cloudflare" };
}

async function viaPollinations(prompt: string, fetcher: Fetch, externe?: AbortSignal, graine = 0): Promise<ImageGeneree> {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 1500))}?width=1024&height=1024&nologo=true&seed=${graine}`;
  const r = await fetcher(url, { signal: signal(externe) });
  const type = r.headers.get("content-type") ?? "";
  if (!r.ok || !type.startsWith("image/")) throw new Error(`Pollinations ${r.status}`);
  const octets = Buffer.from(await r.arrayBuffer());
  if (octets.length < 1000) throw new Error("Pollinations : image vide");
  return { url: `data:${type.split(";")[0]};base64,${octets.toString("base64")}`, source: "pollinations" };
}

export async function genererImage(
  prompt: string,
  o: { fournisseurs: Fournisseur[]; signal?: AbortSignal; fetcher?: Fetch; graine?: number; log?: (m: string) => void },
): Promise<ImageGeneree> {
  const fetcher = o.fetcher ?? fetch;
  const erreurs: string[] = [];
  for (const f of o.fournisseurs.filter((x) => x.famille === "cloudflare")) {
    try {
      return await viaCloudflare(f, prompt, fetcher, o.signal);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      erreurs.push(`Cloudflare : ${m}`);
      o.log?.(`[image] Cloudflare indisponible : ${m}`);
    }
  }
  try {
    return await viaPollinations(prompt, fetcher, o.signal, o.graine ?? Math.floor(Math.random() * 1e6));
  } catch (e) {
    erreurs.push(e instanceof Error ? e.message : String(e));
  }
  throw new Error(erreurs.join(" ; "));
}

/** Demande explicite d'image dans un message (« génère une image de… », « dessine-moi… »). */
export function demandeImage(texte: string): boolean {
  return /\b(g[ée]n[èeé]re|cr[ée]e|dessine|fais|produis|imagine|r[ée]alise|montre)[-\s]*(moi|nous)?\s+(une|des|l['’]|un|deux|trois|quelques)?\s*(image|illustration|dessin|logo|photo|ic[ôo]ne|visuel|affiche|fond d['’][ée]cran|wallpaper|portrait|banni[èe]re)s?\b/i.test(
    texte,
  ) || /^\s*\/image\b/i.test(texte);
}
