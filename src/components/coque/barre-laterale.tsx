"use client";

import { Download, FileJson, FileText, MessageSquarePlus, MoreHorizontal, Pencil, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { ResumeConversation } from "@/lib/db/conversations";
import { formatHeure } from "@/lib/format";
import { cn } from "@/lib/utils";

export const EVENEMENT_MAJ = "conversations:maj";

export function signalerMajConversations() {
  window.dispatchEvent(new Event(EVENEMENT_MAJ));
}

function grouper(liste: ResumeConversation[]) {
  const auj = new Date();
  const hier = new Date(auj);
  hier.setDate(auj.getDate() - 1);
  const semaine = new Date(auj);
  semaine.setDate(auj.getDate() - 7);
  const groupes: Array<{ titre: string; items: ResumeConversation[] }> = [
    { titre: "Aujourd'hui", items: [] },
    { titre: "Hier", items: [] },
    { titre: "7 derniers jours", items: [] },
    { titre: "Plus ancien", items: [] },
  ];
  for (const c of liste) {
    const d = new Date(c.majA);
    if (d.toDateString() === auj.toDateString()) groupes[0].items.push(c);
    else if (d.toDateString() === hier.toDateString()) groupes[1].items.push(c);
    else if (d > semaine) groupes[2].items.push(c);
    else groupes[3].items.push(c);
  }
  return groupes.filter((g) => g.items.length);
}

export function BarreLaterale({ onNaviguer }: { onNaviguer?: () => void }) {
  const [liste, setListe] = useState<ResumeConversation[] | null>(null);
  const [erreurDb, setErreurDb] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [renommage, setRenommage] = useState<ResumeConversation | null>(null);
  const [suppression, setSuppression] = useState<ResumeConversation | null>(null);
  const [nouveauTitre, setNouveauTitre] = useState("");
  const params = useParams<{ id?: string }>();
  const chemin = usePathname();
  const routeur = useRouter();
  const champRecherche = useRef<HTMLInputElement>(null);
  const actif = params?.id ?? null;

  const charger = useCallback(async (q: string) => {
    try {
      const r = await fetch(`/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`, { cache: "no-store" });
      const j = (await r.json()) as { conversations?: ResumeConversation[]; code?: string; erreur?: string };
      if (!r.ok) {
        setErreurDb(
          j.code === "db_absente"
            ? "Historique indisponible : aucune base Postgres n'est connectée (DATABASE_URL). Voir le README, section « Stockage »."
            : `Historique indisponible : ${j.erreur ?? "erreur de base de données"}`,
        );
        setListe([]);
        return;
      }
      setErreurDb(null);
      setListe(j.conversations ?? []);
    } catch {
      setListe([]);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void charger(recherche), recherche ? 200 : 0);
    return () => clearTimeout(t);
  }, [recherche, charger]);

  useEffect(() => {
    const h = () => void charger(recherche);
    window.addEventListener(EVENEMENT_MAJ, h);
    return () => window.removeEventListener(EVENEMENT_MAJ, h);
  }, [charger, recherche]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        champRecherche.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  async function renommer() {
    if (!renommage) return;
    const r = await fetch(`/api/conversations/${renommage.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titre: nouveauTitre }),
    });
    if (r.ok) {
      toast.success("Conversation renommée.");
      void charger(recherche);
    } else toast.error("Impossible de renommer.");
    setRenommage(null);
  }

  async function supprimer() {
    if (!suppression) return;
    const r = await fetch(`/api/conversations/${suppression.id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("Conversation supprimée.");
      if (actif === suppression.id) routeur.push("/");
      void charger(recherche);
    } else toast.error("Impossible de supprimer.");
    setSuppression(null);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 p-2">
        <Button
          variant="outline"
          className="flex-1 justify-start"
          onClick={() => {
            routeur.push("/chat");
            onNaviguer?.();
          }}
          disabled={chemin === "/chat"}
        >
          <MessageSquarePlus /> Nouvelle conversation
          <kbd className="ml-auto hidden rounded border px-1 font-mono text-[10px] text-muted-foreground sm:inline">⌘⇧O</kbd>
        </Button>
      </div>
      <div className="relative px-2 pb-2">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={champRecherche}
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher (⌘K)"
          className="pl-8"
          aria-label="Rechercher dans l'historique"
        />
        {recherche && (
          <button
            type="button"
            aria-label="Effacer la recherche"
            onClick={() => setRecherche("")}
            className="absolute top-1/2 right-4 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-2" aria-label="Historique">
        {erreurDb && (
          <p role="alert" className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
            {erreurDb}
          </p>
        )}
        {liste === null ? (
          <div className="flex flex-col gap-2 p-1">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : liste.length === 0 ? (
          <p className="p-3 text-center text-xs text-muted-foreground">
            {recherche ? "Aucun résultat." : "Aucune conversation pour l'instant."}
          </p>
        ) : (
          grouper(liste).map((g) => (
            <div key={g.titre} className="mb-2">
              <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase">{g.titre}</p>
              <ul className="flex flex-col gap-0.5">
                {g.items.map((c) => (
                  <li key={c.id} className="group relative">
                    <Link
                      href={`/c/${c.id}`}
                      onClick={onNaviguer}
                      className={cn(
                        "flex flex-col rounded-lg px-2 py-1.5 pr-8 text-sm transition-colors hover:bg-muted",
                        actif === c.id && "bg-muted",
                      )}
                      title={c.titre}
                    >
                      <span className="truncate">{c.titre}</span>
                      {c.extrait ? (
                        <span className="truncate text-[11px] text-muted-foreground">{c.extrait}</span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          {formatHeure(new Date(c.majA).getTime())} · {c.nbMessages} message{c.nbMessages > 1 ? "s" : ""}
                        </span>
                      )}
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Actions"
                            className="absolute top-1.5 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                          />
                        }
                      >
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setNouveauTitre(c.titre);
                            setRenommage(c);
                          }}
                        >
                          <Pencil /> Renommer
                        </DropdownMenuItem>
                        <DropdownMenuItem render={<a href={`/api/conversations/${c.id}/export?format=md`} download />}>
                          <FileText /> Exporter en Markdown
                        </DropdownMenuItem>
                        <DropdownMenuItem render={<a href={`/api/conversations/${c.id}/export?format=json`} download />}>
                          <FileJson /> Exporter en JSON
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setSuppression(c)}>
                          <Trash2 /> Supprimer
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </nav>
      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          nativeButton={false}
          render={<a href="/api/export" download />}
        >
          <Download /> Exporter tout l&apos;historique
        </Button>
      </div>

      <Dialog open={!!renommage} onOpenChange={(o) => !o && setRenommage(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renommer la conversation</DialogTitle>
            <DialogDescription>Choisissez un titre court et explicite.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void renommer();
            }}
          >
            <Input value={nouveauTitre} onChange={(e) => setNouveauTitre(e.target.value)} autoFocus aria-label="Nouveau titre" />
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setRenommage(null)}>
                Annuler
              </Button>
              <Button type="submit" disabled={!nouveauTitre.trim()}>
                Renommer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!suppression} onOpenChange={(o) => !o && setSuppression(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer cette conversation ?</DialogTitle>
            <DialogDescription>
              « {suppression?.titre} » et tous ses messages seront supprimés définitivement.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuppression(null)}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={() => void supprimer()}>
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
