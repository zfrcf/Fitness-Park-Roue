/** Fuseau horaire d'affichage. Vercel définit TZ=":UTC", valeur refusée par Intl : on la nettoie. */
export function fuseauHoraire(): string {
  const brut = (process.env.APP_TZ || process.env.TZ || "").replace(/^:/, "");
  const candidat = brut && brut !== "UTC" ? brut : "Europe/Paris";
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: candidat });
    return candidat;
  } catch {
    return "Europe/Paris";
  }
}
