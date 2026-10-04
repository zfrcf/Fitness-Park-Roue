import { describe, expect, it } from "vitest";
import { getKV } from "@/lib/kv";
import { blocContexteMinecraft, detecterDemandeMod, versionsMinecraft } from "./contexte";

describe("detecterDemandeMod", () => {
  it("détecte une demande de mod et la version", () => {
    expect(detecterDemandeMod("Fais-moi un mod Minecraft 1.21.11 qui ajoute une épée")).toEqual({ mod: true, version: "1.21.11" });
    expect(detecterDemandeMod("un mod fabric pour la 26.3")).toEqual({ mod: true, version: "26.3" });
    expect(detecterDemandeMod("Explique la version 1.21 de Minecraft")).toEqual({ mod: false, version: "1.21" });
    expect(detecterDemandeMod("Rédige un email")).toEqual({ mod: false, version: undefined });
  });
});

describe("versionsMinecraft", () => {
  const faux = ((entree: RequestInfo | URL) => {
    const url = String(entree);
    const rep = (o: unknown) => new Response(typeof o === "string" ? o : JSON.stringify(o), { status: 200 });
    if (url.includes("/versions/game")) return rep([{ version: "26.4-snapshot-1", stable: false }, { version: "26.3", stable: true }]);
    if (url.includes("/versions/loader/")) return rep([{ loader: { version: "0.19.5", stable: true } }]);
    if (url.includes("modrinth")) return rep([{ version_number: "0.161.0+26.3" }]);
    if (url.includes("maven-metadata")) return rep("<metadata><versioning><release>1.18.2</release></versioning></metadata>");
    if (url.includes("neoforged")) return rep({ version: "21.11.45" });
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;

  it("agrège les sources et met en cache", async () => {
    const v = await versionsMinecraft(undefined, { fetch: faux, kv: getKV() });
    expect(v).toMatchObject({ jeu: "26.3", loader: "0.19.5", fabricApi: "0.161.0+26.3", loom: "1.18.2", neoforge: "21.11.45", java: 25 });
    const v2 = await versionsMinecraft(undefined, { fetch: (() => Promise.reject(new Error("réseau"))) as unknown as typeof fetch, kv: getKV() });
    expect(v2.jeu).toBe("26.3"); // cache
    const v3 = await versionsMinecraft("1.21.11", { fetch: faux });
    expect(v3.java).toBe(21);
    const bloc = blocContexteMinecraft(v);
    expect(bloc).toContain("Minecraft 26.3");
    expect(bloc).toContain("```groovy build.gradle");
    expect(bloc).toContain("release = 25");
  });
  it("replie sur des valeurs sûres si tout échoue", async () => {
    const v = await versionsMinecraft("1.21.4", { fetch: (() => Promise.reject(new Error("réseau"))) as unknown as typeof fetch });
    expect(v).toMatchObject({ jeu: "1.21.4", loader: "0.19.5", fabricApi: "*", java: 21 });
  });
});
