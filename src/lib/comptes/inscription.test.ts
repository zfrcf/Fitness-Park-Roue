import { beforeEach, describe, expect, it } from "vitest";
import { inscrire, modeVerification, RefusInscription } from "./inscription";

const ok = async () => true;
let n = 0;
const appareil = () => `appareil-de-test-${(++n).toString().padStart(6, "0")}`;
const base = () => ({ nom: "Camille", motDePasse: "cheval-batterie-agrafe", appareils: [appareil()], ip: `10.0.0.${n}` });

describe("inscription et anti-doublons", () => {
  beforeEach(() => {
    process.env.INSCRIPTION_VERIFICATION = "aucune";
    delete process.env.INSCRIPTIONS_PAR_IP;
  });

  it("crée un compte actif sans vérification, haché, adresse normalisée", async () => {
    const { utilisateur, mode } = await inscrire({ ...base(), email: "Camille.Dupont+chat@gmail.com" }, { verifierDomaine: ok });
    expect(mode).toBe("aucune");
    expect(utilisateur.statut).toBe("actif");
    expect(utilisateur.emailNormalise).toBe("camilledupont@gmail.com");
    expect(utilisateur.hash).toMatch(/^scrypt\$/);
  });

  it("refuse une variante de la même adresse (points, +suffixe, majuscules)", async () => {
    await expect(inscrire({ ...base(), email: "c.a.m.i.l.l.e.dupont@GMAIL.com" }, { verifierDomaine: ok })).rejects.toMatchObject({ code: "doublon_email" });
  });

  it("refuse un second compte depuis le même appareil, même avec une autre adresse et une autre IP", async () => {
    const meme = appareil();
    await inscrire({ ...base(), appareils: [meme], email: "premier@exemple.fr" }, { verifierDomaine: ok });
    await expect(inscrire({ ...base(), appareils: ["autre-appareil-000000", meme], email: "second@exemple.fr", ip: "10.9.9.9" }, { verifierDomaine: ok })).rejects.toMatchObject({ code: "doublon_appareil" });
  });

  it("limite les comptes par connexion internet (réglable)", async () => {
    await inscrire({ ...base(), ip: "192.0.2.50", email: "ip1@exemple.fr" }, { verifierDomaine: ok });
    await expect(inscrire({ ...base(), ip: "192.0.2.50", email: "ip2@exemple.fr" }, { verifierDomaine: ok })).rejects.toMatchObject({ code: "doublon_ip" });
    process.env.INSCRIPTIONS_PAR_IP = "3";
    await expect(inscrire({ ...base(), ip: "192.0.2.50", email: "ip3@exemple.fr" }, { verifierDomaine: ok })).resolves.toBeTruthy();
  });

  it("refuse adresses jetables, domaines muets, mots de passe faibles", async () => {
    await expect(inscrire({ ...base(), email: "x@yopmail.com" }, { verifierDomaine: ok })).rejects.toThrow(/jetables/);
    await expect(inscrire({ ...base(), email: "x@domaine-inexistant.fr" }, { verifierDomaine: async () => false })).rejects.toThrow(/ne reçoit pas/);
    await expect(inscrire({ ...base(), email: "y@exemple.fr", motDePasse: "court" }, { verifierDomaine: ok })).rejects.toBeInstanceOf(RefusInscription);
  });

  it("vérification : e-mail si Resend est configuré, sinon validation par l'administrateur", () => {
    expect(modeVerification({ RESEND_API_KEY: "re_x" })).toBe("email");
    expect(modeVerification({})).toBe("admin");
    expect(modeVerification({ INSCRIPTION_VERIFICATION: "email" })).toBe("admin");
    expect(modeVerification({ INSCRIPTION_VERIFICATION: "aucune", RESEND_API_KEY: "re_x" })).toBe("aucune");
  });
});
