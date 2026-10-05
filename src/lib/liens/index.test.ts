import { describe, expect, it } from "vitest";
import type { KV } from "@/lib/kv";
import { lireLiensDuMessage } from "./index";

/** KV qui échoue toujours : simule une panne d'Upstash. */
const kvCassee: KV = {
  type: "memoire",
  get: async () => {
    throw new Error("KV indisponible");
  },
  set: async () => {
    throw new Error("KV indisponible");
  },
  del: async () => {},
  incr: async () => 1,
  ttl: async () => -2,
  keys: async () => [],
};

describe("lireLiensDuMessage (#28 : tolérance aux pannes)", () => {
  it("une erreur du cache KV ne fait pas échouer la lecture (le lien est signalé, pas d'exception)", async () => {
    const pages = await lireLiensDuMessage("Regarde http://localhost/secret stp", {
      kv: kvCassee,
      resumer: async (t) => t,
      budgetParPage: 1000,
    });
    expect(pages).toHaveLength(1);
    expect(pages[0].ok).toBe(false); // bloqué par l'anti-SSRF, mais sans planter malgré le cache cassé
    expect(pages[0].url).toContain("localhost");
  });
});
