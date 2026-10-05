/**
 * Ménage des branches `compilation/*` restées sur le dépôt. Chaque compilation supprime sa
 * branche quand elle se termine (voir suivi.ts), mais une suppression peut échouer (réseau,
 * proxy, run abandonné) ou une branche peut être poussée à la main : on balaie périodiquement
 * les branches trop vieilles (un build dure au plus ~40 min, donc > 2 h = terminé ou abandonné).
 */
import { depotCompilation, github as githubReel } from "./api";

type GitHubFn = typeof githubReel;

export interface ResultatMenage {
  examinees: number;
  supprimees: string[];
  erreurs: number;
}

interface BrancheGitHub {
  name: string;
  commit: { sha: string };
}
interface CommitGitHub {
  commit: { committer?: { date?: string }; author?: { date?: string } };
}

export async function nettoyerBranchesCompilation(opts: { maintenant?: number; ageMaxMs?: number; max?: number; github?: GitHubFn } = {}): Promise<ResultatMenage> {
  const g = opts.github ?? githubReel;
  const maintenant = opts.maintenant ?? Date.now();
  const ageMax = opts.ageMaxMs ?? 2 * 3_600_000;
  const max = opts.max ?? 30;
  const { proprietaire, nom } = depotCompilation();
  const base = `/repos/${proprietaire}/${nom}`;

  const branches = await g<BrancheGitHub[]>(`${base}/branches?per_page=100`);
  const compil = branches.filter((b) => b.name.startsWith("compilation/")).slice(0, max);
  const supprimees: string[] = [];
  let erreurs = 0;
  for (const b of compil) {
    try {
      const c = await g<CommitGitHub>(`${base}/commits/${b.commit.sha}`);
      const date = c.commit.committer?.date ?? c.commit.author?.date;
      const age = date ? maintenant - new Date(date).getTime() : Infinity;
      if (age < ageMax) continue;
      await g(`${base}/git/refs/heads/${b.name}`, { method: "DELETE" });
      supprimees.push(b.name);
    } catch {
      erreurs++;
    }
  }
  return { examinees: compil.length, supprimees, erreurs };
}
