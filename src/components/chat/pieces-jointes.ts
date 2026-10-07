"use client";

/**
 * Préparation des pièces jointes dans le navigateur : images réduites (JPEG ≤ 1600 px), archives
 * .zip dépliées (fichiers texte seulement), texte des PDF, fichiers de code, dossiers glissés.
 */
import type { FileUIPart } from "ai";
import type { FichierJoint } from "@/lib/chat/types";
import { estBinaire, filtrerArchive, LIMITE_FICHIER_TEXTE, LIMITE_IMAGES, cheminSur, doitIgnorer, type EntreeArchive } from "@/lib/fichiers/pieces-jointes";

export interface PiecesPreparees {
  images: FileUIPart[];
  fichiers: FichierJoint[];
  ignores: string[];
  erreurs: string[];
}

const COTE_MAX_IMAGE = 1600;

async function reduireImage(f: File): Promise<string> {
  const bitmap = await createImageBitmap(f);
  const echelle = Math.min(1, COTE_MAX_IMAGE / Math.max(bitmap.width, bitmap.height));
  const l = Math.max(1, Math.round(bitmap.width * echelle));
  const h = Math.max(1, Math.round(bitmap.height * echelle));
  const canvas = document.createElement("canvas");
  canvas.width = l;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas indisponible");
  ctx.fillStyle = "#ffffff"; // fond blanc pour les PNG transparents (JPEG n'a pas d'alpha)
  ctx.fillRect(0, 0, l, h);
  ctx.drawImage(bitmap, 0, 0, l, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function texteDuPdf(octets: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(octets);
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n\n") : text).trim();
}

/** Un fichier : image, archive, PDF ou texte. `chemin` : chemin relatif (dossier glissé) ou nom. */
async function preparerUn(f: File, chemin: string, sortie: PiecesPreparees): Promise<void> {
  const nom = f.name;
  const ext = nom.split(".").pop()?.toLowerCase() ?? "";
  if (f.type.startsWith("image/") && ext !== "svg") {
    if (sortie.images.length >= LIMITE_IMAGES) {
      sortie.ignores.push(`${nom} (au plus ${LIMITE_IMAGES} images par message)`);
      return;
    }
    try {
      sortie.images.push({ type: "file", mediaType: "image/jpeg", filename: nom, url: await reduireImage(f) });
    } catch {
      sortie.erreurs.push(`${nom} : image illisible`);
    }
    return;
  }
  const octets = new Uint8Array(await f.arrayBuffer());
  if (ext === "zip" || f.type === "application/zip" || f.type === "application/x-zip-compressed") {
    try {
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(octets);
      const entrees: EntreeArchive[] = [];
      for (const e of Object.values(zip.files)) {
        if (e.dir || doitIgnorer(e.name)) continue;
        entrees.push({ chemin: e.name, octets: await e.async("uint8array") });
      }
      const r = filtrerArchive(entrees, nom);
      sortie.fichiers.push(...r.fichiers);
      sortie.ignores.push(...r.ignores);
    } catch {
      sortie.erreurs.push(`${nom} : archive illisible`);
    }
    return;
  }
  if (ext === "pdf" || f.type === "application/pdf") {
    try {
      const texte = await texteDuPdf(octets);
      if (!texte) sortie.ignores.push(`${nom} (PDF sans texte : scanné ?)`);
      else sortie.fichiers.push({ chemin: nom, contenu: texte, taille: f.size, genre: "document" });
    } catch {
      sortie.erreurs.push(`${nom} : PDF illisible`);
    }
    return;
  }
  const c = cheminSur(chemin) ?? cheminSur(nom);
  if (!c) {
    sortie.ignores.push(`${nom} (nom refusé)`);
    return;
  }
  if (f.size > LIMITE_FICHIER_TEXTE) {
    sortie.ignores.push(`${c} (trop gros : ${Math.round(f.size / 1024)} Ko)`);
    return;
  }
  if (estBinaire(octets)) {
    sortie.ignores.push(`${c} (binaire)`);
    return;
  }
  sortie.fichiers.push({ chemin: c, contenu: new TextDecoder().decode(octets), taille: f.size, genre: "code" });
}

export async function preparerPiecesJointes(fichiers: Array<{ fichier: File; chemin?: string }>): Promise<PiecesPreparees> {
  const sortie: PiecesPreparees = { images: [], fichiers: [], ignores: [], erreurs: [] };
  for (const { fichier, chemin } of fichiers) {
    if (chemin && doitIgnorer(chemin)) continue;
    await preparerUn(fichier, chemin ?? fichier.name, sortie);
  }
  return sortie;
}

/** Fichiers d'un glisser-déposer, dossiers compris (chemins relatifs conservés). */
export async function fichiersDuDepot(dt: DataTransfer): Promise<Array<{ fichier: File; chemin: string }>> {
  const entrees = [...dt.items].map((i) => (typeof i.webkitGetAsEntry === "function" ? i.webkitGetAsEntry() : null)).filter((e): e is FileSystemEntry => !!e);
  if (!entrees.length) return [...dt.files].map((f) => ({ fichier: f, chemin: f.name }));
  const out: Array<{ fichier: File; chemin: string }> = [];
  const lireFichier = (e: FileSystemFileEntry) => new Promise<File>((ok, ko) => e.file(ok, ko));
  const lireDossier = (r: FileSystemDirectoryReader) => new Promise<FileSystemEntry[]>((ok, ko) => r.readEntries(ok, ko));
  const parcourir = async (e: FileSystemEntry, prefixe: string): Promise<void> => {
    const chemin = prefixe ? `${prefixe}/${e.name}` : e.name;
    if (doitIgnorer(chemin) || out.length > 2000) return;
    if (e.isFile) out.push({ fichier: await lireFichier(e as FileSystemFileEntry), chemin });
    else if (e.isDirectory) {
      const lecteur = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const lot = await lireDossier(lecteur); // readEntries renvoie les entrées par lots
        if (!lot.length) break;
        for (const s of lot) await parcourir(s, chemin);
      }
    }
  };
  for (const e of entrees) await parcourir(e, "");
  // Un seul dossier glissé : son nom n'a pas sa place dans les chemins du projet.
  const racines = new Set(out.map((o) => o.chemin.split("/")[0]));
  if (entrees.length === 1 && entrees[0].isDirectory && racines.size === 1) {
    for (const o of out) o.chemin = o.chemin.split("/").slice(1).join("/");
  }
  return out;
}
