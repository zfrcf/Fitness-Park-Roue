import { afterAll, describe, expect, it } from "vitest";
import { destinationSure } from "./destination";

const avant = (globalThis as { window?: unknown }).window;
Object.defineProperty(globalThis, "window", { value: { location: { origin: "https://app.test" } }, configurable: true });
afterAll(() => Object.defineProperty(globalThis, "window", { value: avant, configurable: true }));

describe("destinationSure", () => {
  it("refuse les redirections externes et les boucles de connexion", () => {
    expect(destinationSure("//evil.com/x")).toBe("/");
    expect(destinationSure("/\\evil.com")).toBe("/");
    expect(destinationSure("https://evil.com")).toBe("/");
    expect(destinationSure("/connexion")).toBe("/");
    expect(destinationSure(null)).toBe("/");
  });
  it("garde les destinations internes", () => {
    expect(destinationSure("/c/abc?x=1")).toBe("/c/abc?x=1");
    expect(destinationSure("/taches")).toBe("/taches");
  });
});
