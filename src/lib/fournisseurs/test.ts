import { generateText } from "ai";
import { creerModele } from "./client";
import { lireQuota } from "./entetes";
import { classerErreur } from "./erreurs";
import { enregistrerTest, marquerEpuise, marquerErreur, marquerReussite } from "./etat";
import type { EtatFournisseur, Fournisseur } from "./types";

export type ResultatTest = NonNullable<EtatFournisseur["dernierTest"]>;

/** Appel réel minimal pour vérifier qu'un fournisseur répond, et mettre à jour son état. */
export async function testerFournisseur(f: Fournisseur): Promise<ResultatTest> {
  const debut = Date.now();
  try {
    const r = await generateText({
      model: creerModele(f, { raisonnement: "aucun" }),
      system: "Tu es un assistant. Réponds uniquement par le mot OK.",
      prompt: "Test de connexion.",
      maxOutputTokens: 16,
      temperature: 0,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(45_000),
    });
    const latenceMs = Date.now() - debut;
    const quota = lireQuota(r.response.headers);
    await marquerReussite(f.id, quota);
    const res: ResultatTest = {
      a: Date.now(),
      ok: true,
      latenceMs,
      message: `Réponse : « ${r.text.trim().slice(0, 40) || "(vide)"} »`,
      tokens: { entree: r.usage.inputTokens ?? 0, sortie: r.usage.outputTokens ?? 0 },
    };
    await enregistrerTest(f.id, res);
    return res;
  } catch (err) {
    const e = classerErreur(err);
    if (e.categorie === "quota" || e.categorie === "credits") {
      await marquerEpuise(f.id, e.reessaiA, e.message);
    } else if (e.categorie !== "abandon") {
      await marquerErreur(f.id, e.reessaiA, e.message);
    }
    const res: ResultatTest = {
      a: Date.now(),
      ok: false,
      latenceMs: Date.now() - debut,
      message: `${e.statut ? `HTTP ${e.statut} · ` : ""}${e.message}`.slice(0, 300),
    };
    await enregistrerTest(f.id, res);
    return res;
  }
}
