import { describe, expect, it } from "vitest";
import {
  estimerReessai,
  lireQuota,
  parserDelaiDansMessage,
  parserDureeGo,
  parserRetryAfter,
  prochainMinuitUTC,
} from "./entetes";

const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);

describe("parserDureeGo", () => {
  it("lit les formats Go", () => {
    expect(parserDureeGo("2m59.56s")).toBeCloseTo(179_560, 0);
    expect(parserDureeGo("7.66s")).toBeCloseTo(7_660, 0);
    expect(parserDureeGo("285ms")).toBe(285);
    expect(parserDureeGo("1h2m")).toBe(3_720_000);
    expect(parserDureeGo("12")).toBe(12_000);
    expect(parserDureeGo(undefined)).toBeUndefined();
  });
});

describe("parserRetryAfter", () => {
  it("accepte secondes et date HTTP", () => {
    expect(parserRetryAfter("2", T0)).toBe(2000);
    expect(parserRetryAfter(new Date(T0 + 90_000).toUTCString(), T0)).toBe(90_000);
    expect(parserRetryAfter("n'importe quoi", T0)).toBeUndefined();
  });
});

describe("lireQuota", () => {
  it("lit les en-têtes Groq", () => {
    const q = lireQuota(
      new Headers({
        "x-ratelimit-limit-requests": "1000",
        "x-ratelimit-remaining-requests": "999",
        "x-ratelimit-limit-tokens": "8000",
        "x-ratelimit-remaining-tokens": "7962",
        "x-ratelimit-reset-requests": "1m26.4s",
        "x-ratelimit-reset-tokens": "285ms",
      }),
      T0,
    );
    expect(q).toMatchObject({ requetesLimite: 1000, requetesRestantes: 999, tokensLimite: 8000, tokensRestants: 7962 });
    expect(q?.resetRequetesA).toBeCloseTo(T0 + 86_400, 0);
    expect(q?.resetTokensA).toBe(T0 + 285);
  });
  it("lit les en-têtes OpenRouter (epoch ms)", () => {
    const q = lireQuota({ "X-RateLimit-Limit": "20", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(T0 + 30_000) }, T0);
    expect(q).toMatchObject({ requetesLimite: 20, requetesRestantes: 0, resetRequetesA: T0 + 30_000 });
  });
  it("renvoie undefined sans en-tête", () => {
    expect(lireQuota(new Headers(), T0)).toBeUndefined();
  });
});

describe("estimerReessai", () => {
  it("privilégie Retry-After", () => {
    expect(estimerReessai({ statut: 429, enTetes: { "retry-after": "45", "x-ratelimit-reset-tokens": "10m" } }, T0)).toBe(T0 + 45_000);
  });
  it("utilise le reset de la dimension épuisée (Groq tokens)", () => {
    const r = estimerReessai(
      { statut: 429, code: "tokens", message: "Rate limit reached … (TPM)", enTetes: { "x-ratelimit-reset-tokens": "9m38.016s", "x-ratelimit-reset-requests": "1m" } },
      T0,
    );
    expect(r).toBeCloseTo(T0 + 578_016, 0);
  });
  it("lit le délai dans le message", () => {
    expect(estimerReessai({ statut: 429, message: "Please try again in 9m38.016s" }, T0)).toBeCloseTo(T0 + 578_016, 0);
    expect(parserDelaiDansMessage("x")).toBeUndefined();
  });
  it("attend minuit UTC pour un quota journalier (OpenRouter), au plus une heure pour Cloudflare", () => {
    expect(estimerReessai({ statut: 429, code: 3036, message: "daily free allocation" }, T0)).toBe(Math.min(prochainMinuitUTC(T0), T0 + 3_600_000));
    expect(estimerReessai({ statut: 429, code: 4006, message: "you have used up your daily free allocation of 10,000 neurons" }, T0)).toBe(Math.min(prochainMinuitUTC(T0), T0 + 3_600_000));
    expect(estimerReessai({ statut: 429, message: "Rate limit exceeded: free-models-per-day" }, T0)).toBe(prochainMinuitUTC(T0));
  });
  it("#29 : un délai explicite dans un message de quota journalier fait foi (pas minuit UTC)", () => {
    expect(estimerReessai({ statut: 429, message: "daily limit reached, please try again in 2h3m" }, T0)).toBeCloseTo(T0 + (2 * 3600 + 3 * 60) * 1000, 0);
  });
  it("replis par statut", () => {
    expect(estimerReessai({ statut: 402 }, T0)).toBe(T0 + 24 * 3_600_000);
    expect(estimerReessai({ statut: 429 }, T0)).toBe(T0 + 60_000);
    expect(estimerReessai({ statut: 503 }, T0)).toBe(T0 + 120_000);
    expect(estimerReessai({ statut: 401 }, T0)).toBe(T0 + 3_600_000);
  });
});
