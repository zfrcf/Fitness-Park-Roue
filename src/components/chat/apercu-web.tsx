"use client";

import { MonitorPlay, RotateCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { construireApercu, pagesHtml, resoudre, type FichierApercu } from "@/lib/fichiers/apercu";

/**
 * Bouton « Aperçu » d'un site produit dans la conversation. L'iframe est isolé (sandbox sans
 * allow-same-origin) : le code du site n'a accès ni à l'application ni à ses cookies.
 */
export function BoutonApercu({ fichiers }: { fichiers: FichierApercu[] }) {
  const pages = useMemo(() => pagesHtml(fichiers), [fichiers]);
  const [ouvert, setOuvert] = useState(false);
  const [page, setPage] = useState<string | null>(null);
  const [cle, setCle] = useState(0);
  const courante = page && pages.includes(page) ? page : pages[0];
  const doc = useMemo(() => (ouvert && courante ? construireApercu(fichiers, courante) : ""), [ouvert, courante, fichiers]);

  useEffect(() => {
    if (!ouvert || !courante) return;
    const h = (e: MessageEvent) => {
      const lien = (e.data as { atelierApercu?: unknown } | null)?.atelierApercu;
      if (typeof lien !== "string") return;
      const cible = resoudre(courante, lien);
      if (cible && pages.includes(cible)) setPage(cible);
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, [ouvert, courante, pages]);

  if (!pages.length) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOuvert(true)} title="Afficher le site dans un cadre isolé">
        <MonitorPlay /> Aperçu
      </Button>
      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogContent className="flex h-[92dvh] max-w-[min(96vw,1400px)] flex-col gap-2 sm:max-w-[min(96vw,1400px)]">
          <DialogHeader className="flex-row items-center gap-2 pr-8">
            <DialogTitle className="truncate font-mono text-sm">{courante}</DialogTitle>
            <DialogDescription className="sr-only">Aperçu du site, exécuté dans un cadre isolé</DialogDescription>
            {pages.length > 1 && (
              <select aria-label="Page" value={courante} onChange={(e) => setPage(e.target.value)} className="ml-auto rounded-md border bg-background px-2 py-1 text-xs">
                {pages.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            )}
            <Button size="icon-sm" variant="ghost" aria-label="Recharger" onClick={() => setCle((k) => k + 1)} className={pages.length > 1 ? "" : "ml-auto"}>
              <RotateCw />
            </Button>
          </DialogHeader>
          <iframe
            key={`${courante}-${cle}`}
            title={`Aperçu de ${courante}`}
            srcDoc={doc}
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"
            className="min-h-0 flex-1 rounded-md border bg-white"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
