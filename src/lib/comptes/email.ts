/**
 * Adresses e-mail : normalisation (une même boîte = une seule forme, contre les doubles comptes),
 * refus des adresses jetables et des domaines sans serveur de messagerie.
 */

/** Domaines dont la partie locale ignore les points et le « +suffixe » (même boîte de réception). */
const SANS_POINTS = new Set(["gmail.com", "googlemail.com"]);
/** Domaines équivalents ramenés à une forme unique. */
const ALIAS_DOMAINE: Record<string, string> = { "googlemail.com": "gmail.com" };

const RE_EMAIL = /^[^\s@"<>()[\],;:]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function emailValide(email: string): boolean {
  return email.length <= 254 && RE_EMAIL.test(email.trim());
}

/**
 * Forme canonique d'une adresse : minuscules, « +suffixe » retiré (alias de la même boîte chez
 * presque tous les fournisseurs), points retirés chez Gmail, googlemail.com → gmail.com.
 */
export function normaliserEmail(email: string): string {
  const propre = email.trim().toLowerCase();
  const at = propre.lastIndexOf("@");
  if (at < 1) return propre;
  let local = propre.slice(0, at);
  let domaine = propre.slice(at + 1).replace(/\.$/, "");
  domaine = ALIAS_DOMAINE[domaine] ?? domaine;
  local = local.split("+")[0];
  if (SANS_POINTS.has(domaine)) local = local.replace(/\./g, "");
  return `${local}@${domaine}`;
}

/** Fournisseurs d'adresses jetables les plus courants (liste volontairement large). */
const JETABLES = new Set(
  (
    "mailinator.com yopmail.com yopmail.fr yopmail.net 10minutemail.com 10minutemail.net 20minutemail.com guerrillamail.com " +
    "guerrillamail.net guerrillamail.org guerrillamail.biz guerrillamailblock.com sharklasers.com grr.la spam4.me pokemail.net " +
    "temp-mail.org temp-mail.io tempmail.com tempmail.net tempmail.dev tempmailo.com tempr.email tmpmail.org tmpmail.net " +
    "throwawaymail.com trashmail.com trashmail.de trashmail.net trash-mail.com getnada.com nada.email dispostable.com maildrop.cc " +
    "mohmal.com emailondeck.com fakeinbox.com mailnesia.com mintemail.com mytemp.email spamgourmet.com mailcatch.com " +
    "jetable.org jetable.fr.nf mail-temporaire.fr mail-temporaire.com cool.fr.nf courriel.fr.nf moncourrier.fr.nf monemail.fr.nf " +
    "monmail.fr.nf speed.1s.fr 33mail.com anonaddy.me burnermail.io emailfake.com fakemail.net mailpoof.com inboxkitten.com " +
    "1secmail.com 1secmail.net 1secmail.org esiix.com wwjmp.com xojxe.com yoggm.com mailtm.com mail.tm tempinbox.com " +
    "discard.email discardmail.com discardmail.de spambox.us spamfree24.org mailexpire.com tempemail.net tempomail.fr " +
    "harakirimail.com mvrht.com byom.de emltmp.com tmail.ws tmails.net linshiyouxiang.net minuteinbox.com moakt.com " +
    "dropmail.me 10mail.org emailtemporanea.net correotemporal.org mailforspam.com bugmenot.com deadaddress.com " +
    "spambog.com spambog.de wegwerfmail.de wegwerfmail.net einrot.com cuvox.de dayrep.com fleckens.hu gustr.com jourrapide.com " +
    "rhyta.com superrito.com teleworm.us armyspy.com"
  ).split(/\s+/),
);

export function estJetable(email: string): boolean {
  const domaine = normaliserEmail(email).split("@")[1] ?? "";
  if (JETABLES.has(domaine)) return true;
  // Sous-domaines des services jetables (ex. x.mailinator.com).
  return [...JETABLES].some((d) => domaine.endsWith(`.${d}`));
}

/**
 * Le domaine reçoit-il du courrier ? (enregistrement MX, ou A à défaut, comme le prévoit la norme.)
 * En cas de panne DNS (délai, serveur injoignable) on ne bloque pas l'inscription.
 */
export async function domaineRecoitCourrier(email: string, delaiMs = 4000): Promise<boolean> {
  const domaine = normaliserEmail(email).split("@")[1];
  if (!domaine) return false;
  const { promises: dns } = await import("node:dns");
  const avecDelai = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, ko) => setTimeout(() => ko(Object.assign(new Error("délai"), { code: "DELAI" })), delaiMs))]);
  const absent = (e: unknown) => ["ENOTFOUND", "ENODATA", "ENOTIMP", "EREFUSED_DOMAIN"].includes((e as { code?: string })?.code ?? "");
  try {
    const mx = await avecDelai(dns.resolveMx(domaine));
    if (mx.some((m) => m.exchange && m.exchange !== ".")) return true;
  } catch (e) {
    if (!absent(e)) return true; // panne DNS : on laisse passer
  }
  try {
    const a = await avecDelai(dns.resolve4(domaine));
    return a.length > 0;
  } catch (e) {
    return !absent(e);
  }
}
