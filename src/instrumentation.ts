/**
 * Exécuté une fois au démarrage du serveur Next.js.
 * En mode atelier (application locale), il n'y a ni cron Vercel ni QStash : on relance donc
 * nous-mêmes, chaque minute, les tâches de fond dues ou interrompues.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { modeLocal } = await import("@/lib/mode");
  if (!modeLocal()) return;
  const { reveillerTaches } = await import("@/lib/taches");
  const reveiller = () => void reveillerTaches().catch((e) => console.warn("[atelier] réveil des tâches :", e instanceof Error ? e.message : e));
  setTimeout(reveiller, 5_000);
  setInterval(reveiller, 60_000).unref?.();
}
