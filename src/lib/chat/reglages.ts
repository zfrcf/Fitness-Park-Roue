import { REGLAGES_DEFAUT, type Reglages } from "./types";

const NIVEAUX = new Set(["aucun", "faible", "moyen", "eleve"]);

/** Valide et borne des réglages partiels venant du client. */
export function normaliserReglages(partiel: Partial<Reglages> | undefined): Reglages {
  const r = { ...REGLAGES_DEFAUT };
  if (!partiel) return r;
  if (typeof partiel.systeme === "string") r.systeme = partiel.systeme.slice(0, 20_000);
  if (typeof partiel.temperature === "number" && Number.isFinite(partiel.temperature)) {
    r.temperature = Math.min(2, Math.max(0, partiel.temperature));
  }
  if (typeof partiel.maxTokens === "number" && Number.isFinite(partiel.maxTokens)) {
    r.maxTokens = Math.min(200_000, Math.max(64, Math.round(partiel.maxTokens)));
  }
  if (typeof partiel.raisonnement === "string" && NIVEAUX.has(partiel.raisonnement)) {
    r.raisonnement = partiel.raisonnement;
  }
  if (typeof partiel.rechercheAuto === "boolean") r.rechercheAuto = partiel.rechercheAuto;
  return r;
}
