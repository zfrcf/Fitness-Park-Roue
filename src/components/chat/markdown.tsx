"use client";

import { memo, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { cheminDepuisInfo } from "@/lib/fichiers/extraire";
import { BlocCode } from "./bloc-code";

function texteDe(noeud: ReactNode): string {
  if (noeud == null || typeof noeud === "boolean") return "";
  if (typeof noeud === "string" || typeof noeud === "number") return String(noeud);
  if (Array.isArray(noeud)) return noeud.map(texteDe).join("");
  if (typeof noeud === "object" && "props" in noeud) {
    return texteDe((noeud as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

const composants: ComponentProps<typeof ReactMarkdown>["components"] = {
  pre({ children }) {
    // Le <code> enfant porte la classe language-xxx ajoutée par rehype-highlight.
    const enfant = Array.isArray(children) ? children[0] : children;
    const props = (enfant as { props?: { className?: string; children?: ReactNode; node?: { data?: { meta?: string } } } } | null)?.props ?? {};
    const meta = props.node?.data?.meta ?? "";
    const langueClasse = /language-([\w+-]+)/.exec(props.className ?? "")?.[1];
    const info = cheminDepuisInfo(`${langueClasse ?? ""} ${meta}`.trim());
    return (
      <BlocCode langue={info.langue ?? langueClasse} chemin={info.chemin} code={texteDe(props.children).replace(/\n$/, "")}>
        {props.children}
      </BlocCode>
    );
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

const plugins = { remark: [remarkGfm], rehype: [[rehypeHighlight, { detect: false, ignoreMissing: true }]] as never[] };

export const Markdown = memo(function Markdown({ texte }: { texte: string }) {
  return (
    <div className="prose-chat text-[15px]">
      <ReactMarkdown remarkPlugins={plugins.remark} rehypePlugins={plugins.rehype} components={composants}>
        {texte}
      </ReactMarkdown>
    </div>
  );
});
