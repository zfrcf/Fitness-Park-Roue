"use client";

import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

const LANGUES: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  jsx: "JSX",
  py: "Python",
  python: "Python",
  sh: "Shell",
  bash: "Bash",
  zsh: "Shell",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  sql: "SQL",
  md: "Markdown",
  markdown: "Markdown",
  yaml: "YAML",
  yml: "YAML",
  go: "Go",
  rust: "Rust",
  java: "Java",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  php: "PHP",
  ruby: "Ruby",
  swift: "Swift",
  kotlin: "Kotlin",
  xml: "XML",
  diff: "Diff",
  text: "Texte",
  plaintext: "Texte",
};

export function copierTexte(texte: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(texte);
  const ta = document.createElement("textarea");
  ta.value = texte;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
  return Promise.resolve();
}

export function BoutonCopier({ texte, libelle = "Copier", className }: { texte: string; libelle?: string; className?: string }) {
  const [copie, setCopie] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className={className}
      aria-label={copie ? "Copié" : libelle}
      onClick={() => {
        void copierTexte(texte).then(() => {
          setCopie(true);
          setTimeout(() => setCopie(false), 1500);
        });
      }}
    >
      {copie ? <Check className="text-emerald-600" /> : <Copy />}
      <span className="hidden sm:inline">{copie ? "Copié" : libelle}</span>
    </Button>
  );
}

/** Bloc de code avec en-tête (langage) et bouton copier. */
export function BlocCode({ langue, code, children }: { langue?: string; code: string; children: ReactNode }) {
  const nom = langue ? (LANGUES[langue.toLowerCase()] ?? langue) : "";
  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border bg-muted/40 text-[13px]">
      <div className="flex h-8 items-center justify-between border-b bg-muted/60 pr-1 pl-3">
        <span className="text-xs text-muted-foreground">{nom || "Code"}</span>
        <BoutonCopier texte={code} />
      </div>
      <pre className="overflow-x-auto p-3 leading-relaxed">
        <code className={langue ? `hljs language-${langue}` : "hljs"}>{children}</code>
      </pre>
    </div>
  );
}
