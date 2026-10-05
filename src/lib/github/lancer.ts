/**
 * Lancement d'une compilation GitHub pour l'état d'un projet : validation locale, enregistrement
 * en base puis envoi sur une branche compilation/<id>. Partagé par le bouton « Compiler », la
 * compilation automatique en fin de réponse et le moteur des tâches de fond.
 */
import { createHash } from "node:crypto";
import { creerCompilation, majCompilation, type Compilation } from "@/lib/db/compilations";
import { nomArchive } from "@/lib/fichiers/extraire";
import { creerBranche, resumerJournal, retirerReserves, validerFichiers } from "./compilation";
import { brancheLocale, lancerCompilationLocale } from "@/lib/compilation/locale";
import { modeLocal } from "@/lib/mode";

export interface FichierSimple {
  chemin: string;
  contenu: string;
}

/** Empreinte stable du projet (sha256 des fichiers triés) : détecte un projet strictement inchangé. */
export function empreinteProjet(fichiers: FichierSimple[]): string {
  const h = createHash("sha256");
  for (const f of [...fichiers].sort((a, b) => a.chemin.localeCompare(b.chemin))) h.update(f.chemin + "\0" + f.contenu + "\0");
  return h.digest("hex");
}

export class ProjetRefuse extends Error {
  constructor(public readonly raisons: string[]) {
    super(`Projet refusé : ${raisons.join(" ; ")}`);
    this.name = "ProjetRefuse";
  }
}

/**
 * Valide puis lance la compilation. Lève ProjetRefuse si la validation locale échoue (aucun run
 * GitHub consommé). En cas d'échec d'envoi, la compilation est enregistrée en « erreur » et
 * l'erreur est relancée.
 */
export async function lancerCompilationProjet(p: { conversationId: string; messageId: string; fichiers: FichierSimple[] }): Promise<Compilation> {
  const fichiers = retirerReserves(p.fichiers.map(({ chemin, contenu }) => ({ chemin, contenu })));
  const erreurs = validerFichiers(fichiers);
  if (erreurs.length) throw new ProjetRefuse(erreurs);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const nom = nomArchive(fichiers, "projet");
  let c = await creerCompilation({
    id,
    conversationId: p.conversationId.slice(0, 64),
    messageId: p.messageId.slice(0, 64),
    nom,
    branche: modeLocal() ? brancheLocale(id) : `compilation/${id}`,
    nbFichiers: fichiers.length,
  });
  if (modeLocal()) {
    // Atelier local : gradle build sur cette machine, en arrière-plan (l'état évolue en base).
    void lancerCompilationLocale(c, fichiers, { resumer: (j) => resumerJournal(j) });
    return c;
  }
  try {
    const b = await creerBranche(id, fichiers, nom);
    c = (await majCompilation(id, { brancheUrl: b.url })) ?? c;
  } catch (e) {
    await majCompilation(id, { statut: "erreur", erreur: e instanceof Error ? e.message : "échec de l'envoi sur GitHub" });
    throw e;
  }
  return c;
}
