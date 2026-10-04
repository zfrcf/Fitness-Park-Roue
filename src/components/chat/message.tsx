"use client";

import { AlertCircle, Bot, Brain, ChevronDown, Check, ExternalLink, FileText, Globe, Loader2, Pencil, RefreshCw, Sparkles, X } from "lucide-react";
import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MessageUI, MetaMessage } from "@/lib/chat/types";
import { formatNombre } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BoutonCopier } from "./bloc-code";
import { Markdown } from "./markdown";
import { partiesVisibles } from "./utils";

function MetaReponse({ meta }: { meta?: MetaMessage }) {
  if (!meta?.fournisseur) return null;
  const u = meta.usage;
  const sep = <span aria-hidden className="text-border">·</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
      <span className="font-medium">{meta.fournisseur}</span>
      {sep}
      <span className="font-mono">{meta.modele}</span>
      {u && u.total > 0 && (
        <>
          {sep}
          <span title="tokens d'entrée → tokens de sortie">
            {formatNombre(u.entree)} → {formatNombre(u.sortie)} tokens
          </span>
        </>
      )}
      {meta.cout ? (
        <>
          {sep}
          <span>{meta.cout.toFixed(4)} $</span>
        </>
      ) : null}
      {meta.dureeMs ? (
        <>
          {sep}
          <span>{(meta.dureeMs / 1000).toFixed(1).replace(".", ",")} s</span>
        </>
      ) : null}
      {meta.bascules && meta.bascules.length > 0 && (
        <>
          {sep}
          <Tooltip>
            <TooltipTrigger render={<span className="cursor-help underline decoration-dotted" />}>
              {meta.bascules.length} bascule{meta.bascules.length > 1 ? "s" : ""}
            </TooltipTrigger>
            <TooltipContent>
              <ul className="list-disc pl-3">
                {meta.bascules.map((b, i) => (
                  <li key={i}>
                    {b.de} → {b.vers} : {b.raison}
                    {b.continuation ? " (reprise à la suite)" : ""}
                  </li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        </>
      )}
      {meta.resume && (
        <>
          {sep}
          <span title="Les anciens messages ont été résumés pour tenir dans le contexte">historique résumé</span>
        </>
      )}
    </div>
  );
}

type PageLue = Extract<MessageUI["parts"][number], { type: "data-page-lue" }>["data"];

const SOURCES: Record<PageLue["source"], string> = { direct: "lecture directe", jina: "via Jina Reader", pdf: "PDF" };

function PastillesPages({ pages }: { pages: PageLue[] }) {
  if (!pages.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Pages lues">
      {pages.map((p) => {
        const Icone = !p.ok ? AlertCircle : p.source === "pdf" ? FileText : Globe;
        let hote = p.url;
        try {
          hote = new URL(p.url).hostname.replace(/^www\./, "");
        } catch {
          /* brut */
        }
        return (
          <li key={p.url}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "inline-flex max-w-[280px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-muted",
                      !p.ok && "border-destructive/40 text-destructive",
                    )}
                  />
                }
              >
                <Icone className="size-3.5 shrink-0" />
                <span className="truncate">{p.ok ? p.titre : hote}</span>
                {p.ok && p.condense && <Sparkles className="size-3 shrink-0 text-muted-foreground" />}
                <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {p.ok ? (
                  <>
                    <p className="font-medium">{p.titre}</p>
                    <p className="text-xs opacity-80">
                      {hote} · {SOURCES[p.source]} · {Intl.NumberFormat("fr-FR").format(p.caracteres)} caractères
                      {p.condense ? " · condensée pour tenir dans le contexte" : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-xs">Page non lue : {p.erreur}</p>
                )}
              </TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

function Raisonnement({ texte, enCours }: { texte: string; enCours: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  if (!texte.trim()) return null;
  return (
    <div className="mb-2 rounded-lg border bg-muted/30 text-sm">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground"
        aria-expanded={ouvert}
      >
        <Brain className="size-3.5" />
        {enCours ? "Raisonnement en cours…" : "Raisonnement"}
        <ChevronDown className={cn("ml-auto size-3.5 transition-transform", ouvert && "rotate-180")} />
      </button>
      {ouvert && <div className="border-t px-3 py-2 whitespace-pre-wrap text-muted-foreground">{texte}</div>}
    </div>
  );
}

export interface PropsMessage {
  message: MessageUI;
  dernier: boolean;
  enCours: boolean;
  occupe: boolean;
  onRegenerer?: () => void;
  onEditer?: (texte: string) => void;
}

export const Message = memo(function Message({ message: m, dernier, enCours, occupe, onRegenerer, onEditer }: PropsMessage) {
  const [edition, setEdition] = useState(false);
  const [brouillon, setBrouillon] = useState("");
  const parts = partiesVisibles(m);
  const texte = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
  const raisonnement = parts
    .filter((p) => p.type === "reasoning")
    .map((p) => p.text)
    .join("");
  const pages = m.parts.filter((p) => p.type === "data-page-lue").map((p) => p.data);
  const estUtilisateur = m.role === "user";

  if (estUtilisateur) {
    return (
      <div className="group flex flex-col items-end gap-1">
        {edition ? (
          <form
            className="w-full max-w-[85%]"
            onSubmit={(e) => {
              e.preventDefault();
              if (brouillon.trim()) onEditer?.(brouillon.trim());
              setEdition(false);
            }}
          >
            <Textarea value={brouillon} onChange={(e) => setBrouillon(e.target.value)} autoFocus rows={3} className="min-h-20" aria-label="Modifier le message" onKeyDown={(e) => {
              if (e.key === "Escape") setEdition(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }} />
            <div className="mt-1.5 flex justify-end gap-1.5">
              <Button type="button" size="sm" variant="ghost" onClick={() => setEdition(false)}>
                <X /> Annuler
              </Button>
              <Button type="submit" size="sm" disabled={!brouillon.trim()}>
                <Check /> Envoyer
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">{texte}</div>
            <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <BoutonCopier texte={texte} />
              {onEditer && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={occupe}
                  onClick={() => {
                    setBrouillon(texte);
                    setEdition(true);
                  }}
                >
                  <Pencil /> <span className="hidden sm:inline">Modifier</span>
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="group flex gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <Bot className="size-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <PastillesPages pages={pages} />
        <Raisonnement texte={raisonnement} enCours={enCours && !texte} />
        {texte ? (
          <Markdown texte={texte} />
        ) : enCours ? (
          <div className="flex h-7 items-center text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <MetaReponse meta={m.metadata} />
          {!enCours && (
            <div className={cn("flex gap-0.5 transition-opacity", dernier ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
              <BoutonCopier texte={texte} />
              {onRegenerer && (
                <Button type="button" variant="ghost" size="xs" disabled={occupe} onClick={onRegenerer}>
                  <RefreshCw /> <span className="hidden sm:inline">Régénérer</span>
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
