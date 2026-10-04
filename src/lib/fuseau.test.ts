import { afterEach, describe, expect, it } from "vitest";
import { fuseauHoraire } from "./fuseau";

const tz = process.env.TZ;
afterEach(() => {
  if (tz === undefined) delete process.env.TZ;
  else process.env.TZ = tz;
  delete process.env.APP_TZ;
});

describe("fuseauHoraire", () => {
  it("nettoie la valeur Vercel « :UTC » et retombe sur Paris", () => {
    process.env.TZ = ":UTC";
    expect(fuseauHoraire()).toBe("Europe/Paris");
    expect(() => new Intl.DateTimeFormat("fr-FR", { timeZone: fuseauHoraire() })).not.toThrow();
  });
  it("accepte un fuseau valide et ignore un fuseau invalide", () => {
    process.env.APP_TZ = "America/Montreal";
    expect(fuseauHoraire()).toBe("America/Montreal");
    process.env.APP_TZ = "Pays/Imaginaire";
    expect(fuseauHoraire()).toBe("Europe/Paris");
  });
});
