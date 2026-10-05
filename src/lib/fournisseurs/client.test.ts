import { describe, expect, it } from "vitest";
import { adapterCorps } from "./client";
import type { Fournisseur } from "./types";

const f = (famille: Fournisseur["famille"]): Fournisseur => ({ id: "x", rang: 1, nom: "X", baseUrl: "http://x", apiKey: "k", modele: "m", contexte: 1000, payant: false, famille });

describe("adapterCorps", () => {
  it("NVIDIA : réflexion coupée sans outils, gardée avec outils, effort high/max", () => {
    expect(adapterCorps(f("nvidia"), { messages: [] }, { raisonnement: "aucun" })).toMatchObject({ chat_template_kwargs: { thinking: false } });
    const avecOutils = adapterCorps(f("nvidia"), { messages: [], tools: [{ type: "function" }] }, { raisonnement: "aucun" });
    expect(avecOutils).toMatchObject({ chat_template_kwargs: { thinking: true } });
    expect(avecOutils).not.toHaveProperty("reasoning_effort");
    expect(adapterCorps(f("nvidia"), { messages: [] }, { raisonnement: "faible" })).toMatchObject({ chat_template_kwargs: { thinking: true } });
    expect(adapterCorps(f("nvidia"), { messages: [] }, { raisonnement: "moyen" })).toMatchObject({ chat_template_kwargs: { thinking: true }, reasoning_effort: "high" });
    expect(adapterCorps(f("nvidia"), { messages: [] }, { raisonnement: "eleve" })).toMatchObject({ reasoning_effort: "max" });
  });
  it("Groq et Cloudflare : reasoning_effort selon la famille", () => {
    expect(adapterCorps(f("groq"), {}, { raisonnement: "aucun" })).toMatchObject({ reasoning_effort: "none" });
    expect(adapterCorps(f("cloudflare"), {}, { raisonnement: "aucun" })).toMatchObject({ reasoning_effort: "low", max_tokens: 4096 });
    expect(adapterCorps(f("openrouter"), {}, { raisonnement: "aucun" })).toMatchObject({ reasoning: { enabled: false } });
  });
  it("retire reasoning_content de l'historique sauf chez NVIDIA (#31)", () => {
    const msg = [{ role: "assistant", content: "x", reasoning_content: "y" }];
    const generique = adapterCorps(f("generique"), { messages: [...msg] }, { raisonnement: "aucun" });
    expect((generique.messages as Array<Record<string, unknown>>)[0]).toEqual({ role: "assistant", content: "x" });
    // NVIDIA/Kimi K3 : le raisonnement intermédiaire est conservé pour la boucle d'outils.
    const nvidia = adapterCorps(f("nvidia"), { messages: [...msg] }, { raisonnement: "aucun" });
    expect((nvidia.messages as Array<Record<string, unknown>>)[0]).toHaveProperty("reasoning_content", "y");
  });
});
