/**
 * Envoi d'e-mails (lien de vérification) par Resend, seulement si RESEND_API_KEY est configurée.
 * Sans clé, les nouveaux comptes sont validés par l'administrateur (voir modeVerification).
 */
export function courrielDisponible(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.RESEND_API_KEY;
}

export async function envoyerCourriel(m: { a: string; sujet: string; texte: string; html: string }, fetcher: typeof fetch = fetch): Promise<void> {
  const cle = process.env.RESEND_API_KEY;
  if (!cle) throw new Error("Aucun service d'e-mail configuré (RESEND_API_KEY).");
  const r = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${cle}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_EXPEDITEUR || "Chat IA <onboarding@resend.dev>", to: [m.a], subject: m.sujet, text: m.texte, html: m.html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Envoi de l'e-mail impossible (HTTP ${r.status}) : ${(await r.text().catch(() => "")).slice(0, 200)}`);
}
