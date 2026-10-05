import { describe, expect, it } from "vitest";
import { chargerFournisseurs, detecterFamille } from "./registre";

const base = {
  PROVIDER_1_NAME: "Groq",
  PROVIDER_1_BASE_URL: "https://api.groq.com/openai/v1/",
  PROVIDER_1_API_KEY: "k1",
  PROVIDER_1_MODEL: "qwen/qwen3.8-27b",
  PROVIDER_1_CONTEXT: "131072",
  PROVIDER_2_NAME: "Cloudflare",
  PROVIDER_2_BASE_URL: "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1",
  PROVIDER_2_API_KEY: "k2",
  PROVIDER_2_MODEL: "@cf/qwen/qwen3.8-27b",
  PROVIDER_2_CONTEXT: "262144",
  PROVIDER_3_NAME: "OpenRouter",
  PROVIDER_3_BASE_URL: "https://openrouter.ai/api/v1",
  PROVIDER_3_API_KEY: "k3",
  PROVIDER_3_MODEL: "qwen/qwen3.8-27b:free",
  PROVIDER_3_CONTEXT: "262144",
};

describe("chargerFournisseurs", () => {
  it("détecte les rangs, ignore les incomplets et normalise l'URL", () => {
    const l = chargerFournisseurs({ ...base, NODE_ENV: "test" });
    expect(l.map((f) => f.rang)).toEqual([1, 3]); // le 2 a encore <ACCOUNT_ID>
    expect(l[0].baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(l[0].id).toBe("1-groq");
    expect(l[0].famille).toBe("groq");
    expect(l[1].famille).toBe("openrouter");
  });
  it("s'arrête au premier rang absent", () => {
    const l = chargerFournisseurs({ ...base, PROVIDER_2_NAME: undefined, PROVIDER_2_BASE_URL: undefined, NODE_ENV: "test" });
    expect(l.map((f) => f.rang)).toEqual([1]);
  });
  it("place les payants en dernier", () => {
    const l = chargerFournisseurs({
      ...base,
      PROVIDER_1_PAID: "true",
      PROVIDER_2_BASE_URL: "https://api.cloudflare.com/client/v4/accounts/abc/ai/v1",
      NODE_ENV: "test",
    });
    expect(l.map((f) => f.rang)).toEqual([2, 3, 1]);
    expect(l[2].payant).toBe(true);
  });
  it("détecte la famille", () => {
    expect(detecterFamille("https://api.cloudflare.com/client/v4/accounts/x/ai/v1")).toBe("cloudflare");
    expect(detecterFamille("https://example.com/v1")).toBe("generique");
    expect(detecterFamille("pas une url")).toBe("generique");
  });
});

describe("famille NVIDIA", () => {
  it("reconnaît integrate.api.nvidia.com", async () => {
    const { detecterFamille } = await import("./registre");
    expect(detecterFamille("https://integrate.api.nvidia.com/v1")).toBe("nvidia");
  });
});
