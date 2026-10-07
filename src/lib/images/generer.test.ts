import { describe, expect, it, vi } from "vitest";
import type { Fournisseur } from "@/lib/fournisseurs/types";
import { demandeImage, genererImage, urlCloudflareFlux } from "./generer";

const CF: Fournisseur = { id: "2-cf", rang: 2, nom: "Cloudflare", baseUrl: "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1", apiKey: "jeton", modele: "@cf/qwen", contexte: 1000, payant: false, famille: "cloudflare" };

describe("génération d'images", () => {
  it("déduit l'URL FLUX du fournisseur Cloudflare du chat", () => {
    expect(urlCloudflareFlux(CF.baseUrl)).toBe("https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/@cf/black-forest-labs/flux-1-schnell");
    expect(urlCloudflareFlux("https://api.groq.com/openai/v1")).toBeNull();
  });
  it("utilise Cloudflare avec la clé existante", async () => {
    const fetcher = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ result: { image: "QUJD" } }), { status: 200 }));
    const r = await genererImage("une pomme", { fournisseurs: [CF], fetcher: fetcher as unknown as typeof fetch });
    expect(r).toEqual({ url: "data:image/jpeg;base64,QUJD", source: "cloudflare" });
    expect(fetcher.mock.calls[0][0]).toContain("/ai/run/@cf/black-forest-labs/flux-1-schnell");
  });
  it("passe à Pollinations quand le quota Cloudflare est épuisé", async () => {
    const image = new Uint8Array(2000).fill(7);
    const fetcher = vi.fn(async (url: string) =>
      url.includes("cloudflare")
        ? new Response(JSON.stringify({ errors: [{ message: "you have used up your daily free allocation of 10,000 neurons" }] }), { status: 429 })
        : new Response(image, { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
    const r = await genererImage("une pomme", { fournisseurs: [CF], fetcher: fetcher as unknown as typeof fetch, graine: 1 });
    expect(r.source).toBe("pollinations");
    expect(r.url.startsWith("data:image/jpeg;base64,")).toBe(true);
  });
  it("reconnaît les demandes explicites d'image", () => {
    expect(demandeImage("Génère une image d'un chat qui code")).toBe(true);
    expect(demandeImage("dessine-moi un logo pour ma salle de sport")).toBe(true);
    expect(demandeImage("/image coucher de soleil")).toBe(true);
    expect(demandeImage("Crée un mod Fabric qui ajoute une commande")).toBe(false);
    expect(demandeImage("ajoute une image de fond au site")).toBe(false);
  });
});
