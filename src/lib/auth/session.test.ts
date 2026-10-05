import { afterEach, describe, expect, it } from "vitest";
import { creerJeton, verifierJeton } from "./session";

const motDePasseInitial = process.env.APP_PASSWORD;
const secretInitial = process.env.SESSION_SECRET;
afterEach(() => {
  process.env.APP_PASSWORD = motDePasseInitial;
  process.env.SESSION_SECRET = secretInitial;
});

describe("session (#35 : révocable au changement de mot de passe)", () => {
  it("un jeton reste valide avec le même secret et mot de passe", async () => {
    process.env.SESSION_SECRET = "secret-de-test-assez-long";
    process.env.APP_PASSWORD = "motdepasse1";
    const jeton = await creerJeton();
    expect(await verifierJeton(jeton)).toBe(true);
  });
  it("changer APP_PASSWORD invalide les jetons existants même avec un SESSION_SECRET fixe", async () => {
    process.env.SESSION_SECRET = "secret-de-test-assez-long";
    process.env.APP_PASSWORD = "motdepasse1";
    const jeton = await creerJeton();
    process.env.APP_PASSWORD = "motdepasse2";
    expect(await verifierJeton(jeton)).toBe(false);
  });
});
