/**
 * Coloration syntaxique de l'éditeur de l'explorateur : highlight.js « core » avec seulement les
 * langages utiles (mods Minecraft, projets Gradle, scripts courants), pour garder un paquet léger.
 */
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import groovy from "highlight.js/lib/languages/groovy";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import properties from "highlight.js/lib/languages/properties";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { decouperHtmlParLigne, langageDuFichier } from "@/lib/fichiers/explorateur";

const LANGAGES = { bash, c, cpp, csharp, css, dockerfile, go, groovy, ini, java, javascript, json, kotlin, lua, makefile, markdown, properties, python, rust, sql, typescript, xml, yaml };
for (const [nom, def] of Object.entries(LANGAGES)) hljs.registerLanguage(nom, def);

const NOMS_AFFICHES: Record<string, string> = {
  groovy: "Groovy (Gradle)",
  java: "Java",
  json: "JSON",
  properties: "Properties",
  kotlin: "Kotlin",
  xml: "XML",
  yaml: "YAML",
  ini: "TOML / INI",
  markdown: "Markdown",
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  bash: "Shell",
};

export function nomLangage(chemin: string): string {
  const l = langageDuFichier(chemin);
  return l ? (NOMS_AFFICHES[l] ?? l.charAt(0).toUpperCase() + l.slice(1)) : "Texte brut";
}

function echapper(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** HTML coloré, une entrée par ligne du fichier (le HTML est produit et échappé par highlight.js). */
export function colorerParLigne(chemin: string, contenu: string): string[] {
  const langage = langageDuFichier(chemin);
  // Au-delà de ~300 Ko, la coloration ralentirait l'affichage en direct : texte brut.
  if (!langage || contenu.length > 300_000) return contenu.split("\n").map(echapper);
  try {
    return decouperHtmlParLigne(hljs.highlight(contenu, { language: langage, ignoreIllegals: true }).value);
  } catch {
    return contenu.split("\n").map(echapper);
  }
}
