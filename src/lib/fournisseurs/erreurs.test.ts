import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { classerErreur } from "./erreurs";

const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);

function api(statusCode: number, body: unknown, headers: Record<string, string> = {}) {
  return new APICallError({
    message: "x",
    url: "https://x",
    requestBodyValues: {},
    statusCode,
    responseHeaders: headers,
    responseBody: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("classerErreur", () => {
  it("429 Groq tokens → quota, réessai selon reset tokens", () => {
    const e = classerErreur(
      api(429, { error: { message: "Rate limit reached … Please try again in 9m38.016s", type: "tokens", code: "rate_limit_exceeded" } }, { "retry-after": "578" }),
      T0,
    );
    expect(e.categorie).toBe("quota");
    expect(e.basculer).toBe(true);
    expect(e.reessaiA).toBe(T0 + 578_000);
  });
  it("402 OpenRouter → crédits", () => {
    const e = classerErreur(api(402, { error: { code: 402, message: "insufficient credits" } }), T0);
    expect(e.categorie).toBe("credits");
    expect(e.basculer).toBe(true);
  });
  it("Cloudflare 3036 → quota jusqu'à minuit UTC", () => {
    const e = classerErreur(api(429, { success: false, errors: [{ code: 3036, message: "Account limited: daily free allocation" }] }), T0);
    expect(e.categorie).toBe("quota");
    expect(e.reessaiA).toBe(Date.UTC(2026, 9, 5));
  });
  it("chunk d'erreur en plein flux (OpenRouter)", () => {
    const e = classerErreur({ code: 502, message: "Provider returned error", metadata: {} }, T0);
    expect(e.categorie).toBe("temporaire");
    expect(e.statut).toBe(502);
    expect(e.basculer).toBe(true);
  });
  it("413 Groq ITPM → trop-grand, bascule", () => {
    const e = classerErreur(api(413, { error: { message: "Request too large for model on input tokens per minute (ITPM): Limit 7000, Requested 12069, please reduce your message size", type: "tokens", code: "rate_limit_exceeded" } }), T0);
    expect(e.categorie).toBe("trop-grand");
    expect(e.basculer).toBe(true);
  });
  it("400 contexte trop long → contexte, pas de bascule", () => {
    const e = classerErreur(api(400, { error: { message: "This model's maximum context length is 32768 tokens" } }), T0);
    expect(e.categorie).toBe("contexte");
    expect(e.basculer).toBe(false);
  });
  it("400 autre → requête, pas de bascule", () => {
    const e = classerErreur(api(400, { error: { message: "'n' must be 1" } }), T0);
    expect(e.categorie).toBe("requete");
    expect(e.basculer).toBe(false);
  });
  it("401 → auth, bascule", () => {
    expect(classerErreur(api(401, { error: { message: "Invalid API Key" } }), T0)).toMatchObject({ categorie: "auth", basculer: true });
  });
  it("abandon et timeout", () => {
    const a = new Error("The operation was aborted");
    a.name = "AbortError";
    expect(classerErreur(a, T0).categorie).toBe("abandon");
    const t = new Error("x");
    t.name = "TimeoutError";
    expect(classerErreur(t, T0)).toMatchObject({ categorie: "temporaire", basculer: true });
  });
  it("réseau", () => {
    expect(classerErreur(new TypeError("fetch failed"), T0)).toMatchObject({ categorie: "temporaire", basculer: true });
  });
});
