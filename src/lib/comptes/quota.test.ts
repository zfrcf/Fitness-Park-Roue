import { describe, expect, it } from "vitest";
import { getKV } from "@/lib/kv";
import { compterMessage, compterTokens, depassement, limitesQuota, lireQuota } from "./quota";

describe("quota quotidien par compte", () => {
  it("compte les messages et les tokens, par jour", async () => {
    const kv = getKV();
    const midi = Date.UTC(2026, 9, 9, 10, 0);
    await compterMessage(kv, "u-quota", midi);
    await compterMessage(kv, "u-quota", midi);
    await compterTokens(kv, "u-quota", 1500, midi);
    const q = await lireQuota(kv, "u-quota", midi);
    expect(q).toMatchObject({ messages: 2, tokens: 1500, jour: "2026-10-09" });
    // Le lendemain (heure de Paris), tout repart de zéro.
    expect((await lireQuota(kv, "u-quota", midi + 24 * 3600_000)).messages).toBe(0);
  });

  it("signale le dépassement ; 0 = illimité", () => {
    const base = { messages: 0, tokens: 0, limiteMessages: 3, limiteTokens: 100, jour: "j" };
    expect(depassement(base)).toBeNull();
    expect(depassement({ ...base, messages: 3 })).toMatch(/3 messages/);
    expect(depassement({ ...base, tokens: 150 })).toMatch(/100 tokens/);
    expect(depassement({ ...base, messages: 99, limiteMessages: 0, tokens: 0 })).toBeNull();
    expect(limitesQuota({ QUOTA_MESSAGES_JOUR: "10", QUOTA_TOKENS_JOUR: "abc" })).toEqual({ messages: 10, tokens: 600_000 });
  });
});
