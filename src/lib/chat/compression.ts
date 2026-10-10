/**
 * Compression gzip du corps des requêtes de chat : les fichiers et le texte importés compressent
 * très bien (code, JSON, Markdown : souvent 5 à 10×). On peut ainsi importer beaucoup plus de
 * contenu tout en restant sous la limite de 4,5 Mo par requête de Vercel.
 *
 * Le navigateur compresse (CompressionStream), le serveur décompresse (DecompressionStream).
 * Marqué par l'en-tête `x-corps-encodage: gzip` (en-tête propre, pour ne pas interférer avec le
 * décodage automatique des proxys).
 */
export const ENTETE_ENCODAGE = "x-corps-encodage";
/** En dessous, la compression ne vaut pas le coût (petits messages). */
export const SEUIL_COMPRESSION = 48 * 1024;
/** Plafond réseau : le corps COMPRESSÉ doit rester sous la limite de Vercel (marge sous 4,5 Mo). */
export const LIMITE_CORPS_RESEAU = 4_000_000;

async function passerParFlux(donnees: Uint8Array | ArrayBuffer, transform: "gzip" | "gunzip"): Promise<Uint8Array> {
  const flux = transform === "gzip" ? new CompressionStream("gzip") : new DecompressionStream("gzip");
  // Les flux Node exigent une vue typée (TypedArray), pas un ArrayBuffer brut.
  const vue = donnees instanceof Uint8Array ? donnees : new Uint8Array(donnees);
  const ecrivain = flux.writable.getWriter();
  // Sur un gzip invalide, ces promesses rejettent : on les neutralise ici (l'erreur est aussi levée
  // par la boucle de lecture ci-dessous, et remonte proprement à l'appelant) pour éviter un
  // « unhandledRejection » qui planterait le processus.
  ecrivain.write(vue as unknown as Uint8Array<ArrayBuffer>).catch(() => {});
  ecrivain.close().catch(() => {});
  const morceaux: Uint8Array[] = [];
  const lecteur = flux.readable.getReader();
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    if (value) morceaux.push(value);
  }
  const total = morceaux.reduce((n, m) => n + m.length, 0);
  const sortie = new Uint8Array(total);
  let decalage = 0;
  for (const m of morceaux) {
    sortie.set(m, decalage);
    decalage += m.length;
  }
  return sortie;
}

export async function gzipTexte(texte: string): Promise<Uint8Array> {
  return passerParFlux(new TextEncoder().encode(texte), "gzip");
}

export async function gunzipVersTexte(octets: Uint8Array | ArrayBuffer): Promise<string> {
  return new TextDecoder().decode(await passerParFlux(octets, "gunzip"));
}

export function compressionDisponible(): boolean {
  return typeof CompressionStream !== "undefined";
}

/**
 * `fetch` qui gzippe un corps texte volumineux et pose l'en-tête d'encodage. À passer au transport
 * du chat. En cas d'indisponibilité ou d'erreur de compression, repli transparent sur l'envoi brut.
 */
export async function fetchCompresse(entree: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const corps = init?.body;
  if (typeof corps === "string" && corps.length >= SEUIL_COMPRESSION && compressionDisponible()) {
    try {
      const gz = await gzipTexte(corps);
      const entetes = new Headers(init?.headers);
      entetes.set(ENTETE_ENCODAGE, "gzip");
      entetes.set("content-type", "application/json");
      return fetch(entree, { ...init, body: gz as unknown as BodyInit, headers: entetes });
    } catch {
      /* repli : envoi non compressé */
    }
  }
  return fetch(entree, init);
}
