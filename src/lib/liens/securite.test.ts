import { describe, expect, it } from "vitest";
import { detecterLiens } from "./detecter";
import { adressePublique, verifierUrl } from "./securite";

describe("detecterLiens", () => {
  it("extrait, nettoie et dédoublonne", () => {
    const t = "Lis https://example.com/a, puis https://example.com/a#x et (https://fr.wikipedia.org/wiki/Bordeaux_(homonymie)) merci. http://autre.fr/page?x=1.";
    expect(detecterLiens(t)).toEqual(["https://example.com/a", "https://fr.wikipedia.org/wiki/Bordeaux_(homonymie)", "http://autre.fr/page?x=1"]);
  });
  it("limite à 5 liens", () => {
    const t = Array.from({ length: 8 }, (_, i) => `https://e.com/${i}`).join(" ");
    expect(detecterLiens(t)).toHaveLength(5);
  });
  it("ignore les textes sans lien", () => {
    expect(detecterLiens("bonjour example.com sans schéma")).toEqual([]);
  });
});

describe("adressePublique", () => {
  it("rejette les plages privées et locales", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "100.64.0.1"]) {
      expect(adressePublique(ip), ip).toBe(false);
    }
  });
  it("accepte les adresses publiques", () => {
    expect(adressePublique("93.184.216.34")).toBe(true);
    expect(adressePublique("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
  });
});

describe("verifierUrl", () => {
  it("refuse les schémas, ports, hôtes et IP interdits", async () => {
    await expect(verifierUrl("ftp://example.com")).rejects.toThrow(/http/);
    await expect(verifierUrl("http://localhost:3000")).rejects.toThrow(/port|locale/);
    await expect(verifierUrl("http://localhost")).rejects.toThrow(/locale/);
    await expect(verifierUrl("http://127.0.0.1")).rejects.toThrow(/privée/);
    await expect(verifierUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/privée/);
    await expect(verifierUrl("http://[::1]/")).rejects.toThrow(/privée/);
    await expect(verifierUrl("http://user:pass@example.com")).rejects.toThrow(/identifiants/);
    await expect(verifierUrl("http://example.com:22")).rejects.toThrow(/port/);
    await expect(verifierUrl("pas une url")).rejects.toThrow(/invalide/);
  });
  it("autorise le privé en mode test", async () => {
    expect((await verifierUrl("http://127.0.0.1:8080/x", { autoriserPrive: true })).hostname).toBe("127.0.0.1");
  });
});
