/**
 * Pièces jointes (logique pure, testable) : quels fichiers garder, sous quels chemins, dans quelles
 * limites. La lecture des fichiers (images réduites, archives, PDF) se fait dans le navigateur.
 */
import type { FichierJoint, MessageUI } from "@/lib/chat/types";

/** Limite de Vercel : 4,5 Mo par requête. On garde une marge pour l'historique et le JSON. */
export const LIMITE_ENVOI_OCTETS = 3_500_000;
export const LIMITE_FICHIER_TEXTE = 512 * 1024;
export const LIMITE_FICHIERS_ARCHIVE = 400;
export const LIMITE_IMAGES = 4;
/** Texte d'un PDF gardé pour le modèle (le reste est tronqué). */
export const LIMITE_DOCUMENT = 120_000;

/** Dossiers et fichiers d'une archive qui ne servent jamais au modèle (sorties, dépendances, métadonnées). */
const RE_IGNORE =
  /(^|\/)(__MACOSX|\.git|\.svn|\.hg|node_modules|\.gradle|\.idea|\.vscode|\.next|\.venv|venv|__pycache__|\.pytest_cache|\.mypy_cache|build|dist|out|target|bin|obj|\.cache)(\/|$)|(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$|\.(class|jar|war|o|obj|so|dll|dylib|exe|pyc|pyo|png|jpe?g|gif|webp|bmp|ico|icns|mp3|ogg|wav|mp4|mov|zip|gz|tgz|7z|rar|pdf|ttf|otf|woff2?|psd|blend|nbt|schem|litematic)$/i;

/** Normalise un chemin d'archive ou de fichier ; null s'il est dangereux (absolu, « .. »). */
export function cheminSur(brut: string): string | null {
  let c = brut.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
  if (!c || c.startsWith("/") || /^[a-z]:/i.test(c)) return null;
  if (c.split("/").some((s) => s === ".." || s === ".")) return null;
  c = c.replace(/\/$/, "");
  return c.length <= 240 ? c : null;
}

export function doitIgnorer(chemin: string): boolean {
  return RE_IGNORE.test(chemin);
}

/** Fichier binaire : octet nul dans les 8 premiers Ko, ou UTF-8 invalide. */
export function estBinaire(octets: Uint8Array): boolean {
  const debut = octets.subarray(0, 8192);
  if (debut.includes(0)) return true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(debut.length === octets.length ? octets : tronquerUtf8(debut));
    return false;
  } catch {
    return true;
  }
}

/** Coupe un extrait sans casser un caractère multi-octets à la fin. */
function tronquerUtf8(o: Uint8Array): Uint8Array {
  const fin = o.length;
  for (let i = 1; i <= 3 && fin - i >= 0; i++) {
    const b = o[fin - i];
    if ((b & 0xc0) === 0xc0) return o.subarray(0, fin - i); // début de séquence coupée
    if ((b & 0x80) === 0) break;
  }
  return o;
}

/** Retire le dossier racine commun (« projet/src/… » → « src/… ») d'une archive. */
export function retirerRacineCommune(chemins: string[]): string[] {
  if (chemins.length < 2 && !chemins[0]?.includes("/")) return chemins;
  const premier = chemins[0]?.split("/")[0];
  if (premier && chemins.every((c) => c.startsWith(`${premier}/`))) return chemins.map((c) => c.slice(premier.length + 1));
  return chemins;
}

export interface EntreeArchive {
  chemin: string;
  octets: Uint8Array;
}

/** Fichiers texte d'une archive, chemins normalisés ; la liste des fichiers écartés (avec la raison). */
export function filtrerArchive(entrees: EntreeArchive[], origine: string): { fichiers: FichierJoint[]; ignores: string[] } {
  const ignores: string[] = [];
  const gardees: EntreeArchive[] = [];
  for (const e of entrees) {
    const c = cheminSur(e.chemin);
    if (!c) {
      ignores.push(`${e.chemin} (chemin refusé)`);
      continue;
    }
    if (doitIgnorer(c)) continue; // bruit attendu : pas la peine de le signaler
    if (e.octets.length > LIMITE_FICHIER_TEXTE) {
      ignores.push(`${c} (trop gros)`);
      continue;
    }
    if (estBinaire(e.octets)) {
      ignores.push(`${c} (binaire)`);
      continue;
    }
    gardees.push({ chemin: c, octets: e.octets });
  }
  if (gardees.length > LIMITE_FICHIERS_ARCHIVE) {
    ignores.push(`${gardees.length - LIMITE_FICHIERS_ARCHIVE} fichier(s) au-delà de ${LIMITE_FICHIERS_ARCHIVE}`);
    gardees.length = LIMITE_FICHIERS_ARCHIVE;
  }
  const chemins = retirerRacineCommune(gardees.map((g) => g.chemin));
  const decodeur = new TextDecoder();
  const fichiers = gardees.map((g, i) => ({ chemin: chemins[i], contenu: decodeur.decode(g.octets), taille: g.octets.length, genre: "code" as const, origine }));
  return { fichiers, ignores };
}

/** Taille approximative (octets) d'un message une fois sérialisé en JSON. */
export function tailleEnvoi(m: unknown): number {
  return new TextEncoder().encode(JSON.stringify(m)).length;
}

/** Marqueur d'une image retirée par le navigateur (le serveur la reprend en base). */
export const URL_ALLEGEE = "atelier:allege";

/**
 * Historique à envoyer au serveur : le contenu lourd (images, fichiers joints, images générées)
 * n'est envoyé qu'avec le DERNIER message ; pour les autres, le serveur le reprend en base. Sans
 * cela, quelques images suffiraient à dépasser la limite de 4,5 Mo de Vercel.
 */
export function allegerHistorique(messages: MessageUI[]): MessageUI[] {
  return messages.map((m, i) => {
    if (i === messages.length - 1) return m;
    let change = false;
    const parts = m.parts.map((p) => {
      if (p.type === "file" && !p.url.startsWith(URL_ALLEGEE)) {
        change = true;
        return { ...p, url: URL_ALLEGEE };
      }
      if (p.type === "data-fichiers-joints" && !p.data.allege) {
        change = true;
        return { ...p, data: { ...p.data, allege: true, fichiers: p.data.fichiers.map((f) => ({ ...f, contenu: "" })) } };
      }
      if (p.type === "data-image" && !p.data.allege && p.data.url) {
        change = true;
        return { ...p, data: { ...p.data, allege: true, url: "" } };
      }
      return p;
    });
    return change ? { ...m, parts } : m;
  });
}

/**
 * Remet en place, depuis les messages enregistrés, le contenu retiré par allegerHistorique
 * (même message, même rang parmi les parties du même type). Ce qui est introuvable est retiré.
 */
export function rehydraterHistorique(messages: MessageUI[], enBase: MessageUI[]): MessageUI[] {
  const parId = new Map(enBase.map((m) => [m.id, m]));
  return messages.map((m) => {
    if (!m.parts.some((p) => (p.type === "file" && p.url === URL_ALLEGEE) || ((p.type === "data-fichiers-joints" || p.type === "data-image") && p.data.allege))) return m;
    const source = parId.get(m.id);
    const rang = new Map<string, number>();
    const parts = m.parts.flatMap((p) => {
      const n = rang.get(p.type) ?? 0;
      rang.set(p.type, n + 1);
      const allege = (p.type === "file" && p.url === URL_ALLEGEE) || ((p.type === "data-fichiers-joints" || p.type === "data-image") && p.data.allege);
      if (!allege) return [p];
      const original = source?.parts.filter((q) => q.type === p.type)[n];
      return original ? [original] : [];
    });
    return { ...m, parts };
  });
}
