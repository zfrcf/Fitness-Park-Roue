import { describe, expect, it } from "vitest";
import { getKV } from "@/lib/kv";
import { creneauxUtilises, reserverCreneau, rpmDe } from "./debit";

describe("limiteur de débit partagé", () => {
  it("accorde rpm-1 créneaux par fenêtre puis renvoie l'attente jusqu'à la suivante", async () => {
    const kv = getKV();
    const f = { id: "lim-a", famille: "generique" as const, rpm: 3 };
    const t0 = 1_000_000;
    expect((await reserverCreneau(kv, f, t0, 1000)).ok).toBe(true);
    expect((await reserverCreneau(kv, f, t0 + 10, 1000)).ok).toBe(true);
    const refus = await reserverCreneau(kv, f, t0 + 400, 1000);
    expect(refus.ok).toBe(false);
    if (!refus.ok) expect(refus.attenteMs).toBe(600 + 250);
    expect(await creneauxUtilises(kv, f, t0 + 500, 1000)).toEqual({ utilise: 3, limite: 2 });
    // Fenêtre suivante : repart de zéro.
    expect((await reserverCreneau(kv, f, t0 + 1000, 1000)).ok).toBe(true);
  });
  it("sans limite connue, laisse passer", async () => {
    const kv = getKV();
    expect(rpmDe({ famille: "generique" })).toBeUndefined();
    expect(rpmDe({ famille: "nvidia" })).toBe(40);
    expect(rpmDe({ famille: "nvidia", rpm: 10 })).toBe(10);
    expect((await reserverCreneau(kv, { id: "lim-b", famille: "generique" }, 0, 1000)).ok).toBe(true);
  });
});
