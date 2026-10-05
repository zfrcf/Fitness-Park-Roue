import { describe, expect, it } from "vitest";
import { requeteLocaleSure } from "./local";

function req(entetes: Record<string, string>, method = "GET") {
  return { method, headers: new Headers(entetes) };
}

describe("atelier local : requêtes acceptées", () => {
  it("navigation et appels de l'application elle-même", () => {
    expect(requeteLocaleSure(req({ host: "127.0.0.1:3210" }))).toBe(true);
    expect(requeteLocaleSure(req({ host: "localhost:3210", origin: "http://localhost:3210", "sec-fetch-site": "same-origin" }, "POST"))).toBe(true);
    expect(requeteLocaleSure(req({ host: "[::1]:3210" }))).toBe(true);
    // Chaînage interne des tâches (fetch côté serveur : ni Origin ni Sec-Fetch-Site).
    expect(requeteLocaleSure(req({ host: "127.0.0.1:3210" }, "POST"))).toBe(true);
  });
});

describe("atelier local : requêtes refusées", () => {
  it("rebinding DNS (hôte non local)", () => {
    expect(requeteLocaleSure(req({ host: "evil.example:3210" }))).toBe(false);
    expect(requeteLocaleSure(req({}))).toBe(false);
  });
  it("requête intersite (CSRF)", () => {
    expect(requeteLocaleSure(req({ host: "127.0.0.1:3210", origin: "https://evil.example" }, "POST"))).toBe(false);
    expect(requeteLocaleSure(req({ host: "127.0.0.1:3210", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(requeteLocaleSure(req({ host: "127.0.0.1:3210", origin: "http://127.0.0.1:9999" }, "POST"))).toBe(false);
    expect(requeteLocaleSure(req({ host: "127.0.0.1:3210", origin: "null" }, "POST"))).toBe(false);
  });
});
