/**
 * Mode « atelier local » : l'application tourne sur l'ordinateur de l'utilisateur (lancée par
 * « atelier ui »), au lieu de Vercel. Effets : compilation avec gradle build sur la machine
 * (pas GitHub Actions), accès sans mot de passe (serveur lié à 127.0.0.1), réveil des tâches
 * par un minuteur interne.
 *
 * NEXT_PUBLIC_ATELIER_LOCAL est fixé à la construction (« atelier ui » construit l'application
 * localement) : la valeur est donc connue aussi côté navigateur.
 */
export const LOCAL = process.env.NEXT_PUBLIC_ATELIER_LOCAL === "1";

/** Côté serveur : vrai si l'application a été construite OU lancée en mode local. */
export function modeLocal(): boolean {
  // Garde-fou : jamais sur Vercel (l'accès sans mot de passe n'a de sens que sur 127.0.0.1).
  if (process.env.VERCEL) return false;
  return LOCAL || process.env.ATELIER_LOCAL === "1";
}
