/**
 * Garde anti-SSRF : seules les adresses publiques en http(s) sur les ports standard sont autorisées.
 */
import { promises as dns } from "node:dns";
import ipaddr from "ipaddr.js";

const PORTS_AUTORISES = new Set(["", "80", "443", "8080", "8443"]);
const HOTES_INTERDITS = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|.*\.corp|metadata\.google\.internal)$/i;
const PLAGES_INTERDITES = new Set([
  "unspecified",
  "loopback",
  "private",
  "linkLocal",
  "uniqueLocal",
  "carrierGradeNat",
  "broadcast",
  "multicast",
  "reserved",
  "benchmarking",
  "amt",
  "as112",
  "deprecated",
  "orchid2",
  "6to4", // IPv6 → IPv4 encapsulé
  "teredo",
]);

export function adressePublique(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let a = ipaddr.parse(ip);
  if (a.kind() === "ipv6" && (a as ipaddr.IPv6).isIPv4MappedAddress()) a = (a as ipaddr.IPv6).toIPv4Address();
  const plage = a.range();
  return !PLAGES_INTERDITES.has(plage);
}

export interface OptionsSecurite {
  /** Tests uniquement : autoriser 127.0.0.1 et les adresses privées. */
  autoriserPrive?: boolean;
}

/** Vérifie une URL (syntaxe, schéma, port, hôte) et résout son adresse. Lève une erreur explicite sinon. */
export async function verifierUrl(brut: string, opts: OptionsSecurite = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(brut);
  } catch {
    throw new Error("adresse invalide");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("seuls http et https sont acceptés");
  if (url.username || url.password) throw new Error("identifiants dans l'URL refusés");
  const hote = url.hostname.replace(/^\[|\]$/g, "");
  if (opts.autoriserPrive) return url;
  if (!PORTS_AUTORISES.has(url.port)) throw new Error(`port ${url.port} refusé`);
  if (HOTES_INTERDITS.test(hote)) throw new Error("adresse locale refusée");
  if (ipaddr.isValid(hote)) {
    if (!adressePublique(hote)) throw new Error("adresse IP privée refusée");
    return url;
  }
  let adresses: Array<{ address: string }>;
  try {
    adresses = await dns.lookup(hote, { all: true, verbatim: true });
  } catch {
    throw new Error("nom de domaine introuvable");
  }
  if (adresses.length === 0) throw new Error("nom de domaine introuvable");
  for (const a of adresses) {
    if (!adressePublique(a.address)) throw new Error("le domaine pointe vers une adresse privée");
  }
  return url;
}
