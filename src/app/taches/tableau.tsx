"use client";

import { CheckCircle2, ChevronDown, Clock, Download, Loader2, Pause, Play, Plus, Square, Trash2, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDureeRelative, formatHeure, formatNombre } from "@/lib/format";
import type { TachePublique } from "@/lib/db/taches";
import { cn } from "@/lib/utils";

const LIBELLES: Record<TachePublique["statut"], string> = {
  en_attente: "En attente",
  en_cours: "En cours",
  pause: "En pause",
  terminee: "Terminée",
  echouee: "Échouée",
  arretee: "Arrêtée",
};

function BadgeStatut({ t }: { t: TachePublique }) {
  const actif = t.statut === "en_cours" || (t.statut === "en_attente" && !t.repriseA);
  if (t.statut === "terminee")
    return (
      <Badge variant="secondary" className="gap-1 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="size-3" /> Terminée
      </Badge>
    );
  if (t.statut === "echouee")
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="size-3" /> Échouée
      </Badge>
    );
  if (t.statut === "en_attente" && t.repriseA)
    return (
      <Badge variant="outline" className="gap-1">
        <Clock className="size-3" /> Reprise {formatDureeRelative(t.repriseA)}
      </Badge>
    );
  return (
    <Badge variant={actif ? "default" : "outline"} className="gap-1">
      {actif ? <Loader2 className="size-3 animate-spin" /> : <Pause className="size-3" />} {LIBELLES[t.statut]}
    </Badge>
  );
}

function Formulaire({ onCreee }: { onCreee: () => void }) {
  const [objectif, setObjectif] = useState("");
  const [compiler, setCompiler] = useState(true);
  const [maxCycles, setMaxCycles] = useState(8);
  const [envoi, setEnvoi] = useState(false);

  async function creer() {
    if (objectif.trim().length < 3) return;
    setEnvoi(true);
    try {
      const r = await fetch("/api/taches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objectif, compiler, maxCycles }) });
      const j = (await r.json()) as { erreur?: string };
      if (!r.ok) throw new Error(j.erreur ?? "échec");
      setObjectif("");
      toast.success("Tâche lancée : elle tourne même si vous fermez la page.");
      onCreee();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible de créer la tâche.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="size-4" /> Nouvelle tâche
        </CardTitle>
        <CardDescription>
          Décrivez l&apos;objectif comme dans le chat. La tâche enchaîne génération, compilation sur GitHub et corrections sans vous,
          chaque tâche prend le premier fournisseur libre : plusieurs tâches tournent en parallèle.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <textarea
          value={objectif}
          onChange={(e) => setObjectif(e.target.value)}
          rows={4}
          placeholder="Ex. : crée un mod Fabric pour Minecraft 26.2 qui ajoute une commande /heal, et compile-le jusqu'à obtenir le .jar."
          className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={compiler} onChange={(e) => setCompiler(e.target.checked)} className="size-4" />
            Compiler et corriger jusqu&apos;au .jar
          </label>
          <label className="flex items-center gap-2">
            Corrections max
            <input type="number" min={1} max={20} value={maxCycles} onChange={(e) => setMaxCycles(Number(e.target.value) || 8)} className="w-16 rounded-md border bg-background px-2 py-1" />
          </label>
          <Button className="ml-auto" onClick={() => void creer()} disabled={envoi || objectif.trim().length < 3}>
            {envoi ? <Loader2 className="animate-spin" /> : <Play />} Lancer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LigneTache({ t, onMaj }: { t: TachePublique; onMaj: () => void }) {
  const [journalOuvert, setJournalOuvert] = useState(false);
  const [occupe, setOccupe] = useState(false);

  async function action(a: "pause" | "reprendre" | "arreter" | "supprimer") {
    setOccupe(true);
    try {
      const r =
        a === "supprimer"
          ? await fetch(`/api/taches/${t.id}`, { method: "DELETE" })
          : await fetch(`/api/taches/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: a }) });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { erreur?: string };
        throw new Error(j.erreur ?? "échec");
      }
      onMaj();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setOccupe(false);
    }
  }

  const actif = t.statut === "en_attente" || t.statut === "en_cours";
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <BadgeStatut t={t} />
        <Link href={`/c/${t.conversationId}`} className="min-w-0 flex-1 truncate font-medium hover:underline" title="Ouvrir la conversation de la tâche">
          {t.titre}
        </Link>
        <div className="flex gap-1">
          {t.jarCompilationId && t.jarNom && (
            <Button size="sm" nativeButton={false} render={<a href={`/api/compilations/${t.jarCompilationId}/jar`} download />}>
              <Download /> {t.jarNom}
            </Button>
          )}
          {actif && (
            <Button size="sm" variant="outline" disabled={occupe} onClick={() => void action("pause")} aria-label="Mettre en pause">
              <Pause />
            </Button>
          )}
          {(t.statut === "pause" || t.statut === "echouee" || t.statut === "arretee") && (
            <Button size="sm" variant="outline" disabled={occupe} onClick={() => void action("reprendre")} aria-label="Reprendre">
              <Play />
            </Button>
          )}
          {t.statut !== "terminee" && t.statut !== "arretee" && (
            <Button size="sm" variant="outline" disabled={occupe} onClick={() => void action("arreter")} aria-label="Arrêter">
              <Square />
            </Button>
          )}
          {!actif && (
            <Button size="sm" variant="ghost" disabled={occupe} onClick={() => void action("supprimer")} aria-label="Supprimer">
              <Trash2 />
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t.etape}</span>
        <span>
          cycle {t.cycles}/{t.maxCycles}
        </span>
        {t.fournisseurId && <span>{t.fournisseurId}</span>}
        <span className="tabular-nums">
          {formatNombre(t.tokensEntree)} → {formatNombre(t.tokensSortie)} tokens
        </span>
        <span>créée {formatHeure(t.creeA)}</span>
        <span>màj {formatDureeRelative(t.majA)}</span>
      </div>
      {t.erreur && <p className="text-xs text-destructive">{t.erreur}</p>}
      {t.journal.length > 0 && (
        <div>
          <button type="button" onClick={() => setJournalOuvert((o) => !o)} className="flex items-center gap-1 text-xs text-muted-foreground" aria-expanded={journalOuvert}>
            Journal ({t.journal.length}) <ChevronDown className={cn("size-3.5 transition-transform", journalOuvert && "rotate-180")} />
          </button>
          {journalOuvert && (
            <ul className="mt-1 max-h-48 overflow-y-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">
              {t.journal.map((j, i) => (
                <li key={i}>
                  <span className="text-muted-foreground">{formatHeure(j.a)}</span> {j.texte}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export function TableauTaches() {
  const [liste, setListe] = useState<TachePublique[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const r = await fetch("/api/taches", { cache: "no-store" });
      const j = (await r.json()) as { taches?: TachePublique[]; erreur?: string };
      if (!r.ok) throw new Error(j.erreur ?? "échec");
      setListe(j.taches ?? []);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Impossible de charger les tâches.");
    }
  }, []);

  useEffect(() => {
    const premier = setTimeout(() => void charger(), 0);
    const id = setInterval(() => void charger(), 5000);
    return () => {
      clearTimeout(premier);
      clearInterval(id);
    };
  }, [charger]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Tâches de fond</h1>
        <p className="text-sm text-muted-foreground">
          Elles tournent sur le serveur, même quand vous n&apos;êtes pas sur le site. Chaque tâche est une conversation : ouvrez-la pour lire les échanges, les fichiers et le projet complet.
        </p>
      </div>
      <Formulaire onCreee={() => void charger()} />
      {erreur && <p className="text-sm text-destructive">{erreur}</p>}
      {liste === null ? (
        <Skeleton className="h-24 w-full" />
      ) : liste.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune tâche pour l&apos;instant.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {liste.map((t) => (
            <LigneTache key={t.id} t={t} onMaj={() => void charger()} />
          ))}
        </ul>
      )}
    </div>
  );
}
