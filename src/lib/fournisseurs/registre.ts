import type { FamilleAPI, Fournisseur, FournisseurPublic } from "./types";

function slug(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function detecterFamille(baseUrl: string): FamilleAPI {
  let hote = "";
  try {
    hote = new URL(baseUrl).hostname;
  } catch {
    return "generique";
  }
  if (hote.endsWith("groq.com")) return "groq";
  if (hote.endsWith("openrouter.ai")) return "openrouter";
  if (hote.endsWith("cloudflare.com")) return "cloudflare";
  return "generique";
}

function lire(env: NodeJS.ProcessEnv, n: number, cle: string) {
  return env[`PROVIDER_${n}_${cle}`]?.trim() || undefined;
}

/**
 * Lit PROVIDER_n_* pour n = 1, 2, … jusqu'au premier rang absent.
 * Un rang est considéré présent dès que NAME ou BASE_URL est défini.
 */
export function chargerFournisseurs(env: NodeJS.ProcessEnv = process.env): Fournisseur[] {
  const liste: Fournisseur[] = [];
  const problemes: string[] = [];
  for (let n = 1; n <= 50; n++) {
    const nom = lire(env, n, "NAME");
    const baseUrl = lire(env, n, "BASE_URL");
    if (!nom && !baseUrl) break;
    const apiKey = lire(env, n, "API_KEY");
    const modele = lire(env, n, "MODEL");
    const contexte = Number(lire(env, n, "CONTEXT") ?? "");
    const manquants = [
      !nom && "NAME",
      !baseUrl && "BASE_URL",
      !apiKey && "API_KEY",
      !modele && "MODEL",
      !(contexte > 0) && "CONTEXT",
    ].filter(Boolean);
    if (manquants.length) {
      problemes.push(`PROVIDER_${n}_{${manquants.join(", ")}} manquant`);
      continue;
    }
    if (baseUrl!.includes("<") || baseUrl!.includes("VOTRE_")) {
      problemes.push(`PROVIDER_${n}_BASE_URL contient encore un espace réservé`);
      continue;
    }
    const payant = /^(1|true|oui|yes)$/i.test(lire(env, n, "PAID") ?? "");
    liste.push({
      id: `${n}-${slug(nom!)}`,
      rang: n,
      nom: nom!,
      baseUrl: baseUrl!.replace(/\/+$/, ""),
      apiKey: apiKey!,
      modele: modele!,
      contexte,
      payant,
      famille: detecterFamille(baseUrl!),
    });
  }
  if (problemes.length && process.env.NODE_ENV !== "test") {
    console.warn(`[fournisseurs] ignorés : ${problemes.join(" ; ")}`);
  }
  // Les gratuits d'abord (ordre des rangs), les payants en dernier.
  return liste.sort((a, b) => Number(a.payant) - Number(b.payant) || a.rang - b.rang);
}

let cache: Fournisseur[] | null = null;
export function fournisseurs(): Fournisseur[] {
  if (!cache) cache = chargerFournisseurs();
  return cache;
}

export function fournisseurParId(id: string): Fournisseur | undefined {
  return fournisseurs().find((f) => f.id === id);
}

export function versPublic(f: Fournisseur): FournisseurPublic {
  const { apiKey: _, ...reste } = f;
  void _;
  return reste;
}
