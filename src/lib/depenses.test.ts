import { beforeAll, describe, expect, it } from "vitest";
import type { Fournisseur } from "@/lib/fournisseurs/types";
import { autoriserPayant, calculerCout, depenseDuMois, enregistrerDepense, moisCourant, plafondMensuel } from "./depenses";

const payant: Fournisseur = { id: "9-payant", rang: 9, nom: "Payant", baseUrl: "https://x", apiKey: "k", modele: "m", contexte: 1000, payant: true, famille: "generique", prixEntree: 1, prixSortie: 3 };

beforeAll(() => {
  delete process.env.DATABASE_URL;
});

describe("dépenses", () => {
  it("calcule le coût", () => {
    expect(calculerCout(payant, { entree: 1_000_000, sortie: 1_000_000 })).toBe(4);
    expect(calculerCout(payant, { entree: 10, sortie: 10 }, 0.5)).toBe(0.5);
    expect(calculerCout({}, { entree: 10, sortie: 10 })).toBe(0);
  });
  it("cumule par mois et applique le plafond", async () => {
    process.env.PAID_MONTHLY_CAP = "1";
    expect(plafondMensuel()).toBe(1);
    expect(await autoriserPayant(payant)).toBe(true);
    await enregistrerDepense(payant.id, { entree: 100, sortie: 50 }, 0.4);
    await enregistrerDepense(payant.id, { entree: 100, sortie: 50 }, 0.4);
    expect(await depenseDuMois(payant.id)).toBeCloseTo(0.8);
    expect(await autoriserPayant(payant)).toBe(true);
    await enregistrerDepense(payant.id, { entree: 100, sortie: 50 }, 0.3);
    expect(await autoriserPayant(payant)).toBe(false);
    expect(await depenseDuMois(payant.id, "1999-01")).toBe(0);
    process.env.PAID_MONTHLY_CAP = "0";
    expect(await autoriserPayant(payant)).toBe(false);
    expect(await autoriserPayant({ ...payant, payant: false })).toBe(true);
    expect(moisCourant(new Date(Date.UTC(2026, 0, 5)))).toBe("2026-01");
  });
});
