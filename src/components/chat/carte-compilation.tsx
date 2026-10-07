"use client";

import { AlertCircle, Bot, CheckCircle2, ChevronDown, Download, ExternalLink, Hammer, Loader2, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { CompilationPublique } from "@/lib/db/compilations";
import { formatHeure } from "@/lib/format";
import { LOCAL } from "@/lib/mode";
import { cn } from "@/lib/utils";

const LIBELLES: Record<CompilationPublique["statut"], string> = {
  en_attente: LOCAL ? "En file d'attente sur cet ordinateur…" : "En file d'attente sur GitHub Actions…",
  en_cours: "Construction en cours (compilation et tests)…",
  reussie: "Construction réussie",
  echouee: "Construction échouée",
  erreur: "Construction impossible",
};

/**
 * Application de bureau (mode local) : notification du système à la fin d'une compilation quand
 * la fenêtre n'est pas au premier plan (une construction peut durer plusieurs minutes).
 */
function notifierFin(c: CompilationPublique) {
  if (!LOCAL || typeof Notification === "undefined" || document.hasFocus()) return;
  if (c.statut !== "reussie" && c.statut !== "echouee" && c.statut !== "erreur") return;
  try {
    const n = new Notification(c.statut === "reussie" ? "Construction réussie" : "Construction échouée", {
      body: c.statut === "reussie" ? (c.jarNom ? `${c.jarNom} est prêt.` : "Code compilé et testé.") : (c.erreur ?? "Voir le journal dans l'atelier."),
      tag: `compilation-${c.id}`,
    });
    n.onclick = () => window.focus();
  } catch {
    /* notifications indisponibles */
  }
}

export function CarteCompilation({
  compilation: initiale,
  onDemanderCorrection,
  onMaj,
}: {
  compilation: CompilationPublique;
  onDemanderCorrection?: (texte: string) => void;
  /** Prévient la liste d'un nouvel état (sinon le bouton « Compiler » resterait occupé). */
  onMaj?: (c: CompilationPublique) => void;
}) {
  const [tacheEnCours, setTacheEnCours] = useState(false);
  async function lancerTache() {
    setTacheEnCours(true);
    try {
      const r = await fetch("/api/taches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: initiale.conversationId,
          objectif: "Corriger le projet jusqu'à une compilation réussie",
          messageInitial: `La compilation a échoué. Corrige le projet : blocs modif pour les fichiers existants, fichier entier seulement pour un nouveau fichier. Journal :\n\n\`\`\`text\n${initiale.journal ?? ""}\n\`\`\``,
          compiler: true,
        }),
      });
      const j = (await r.json()) as { erreur?: string };
      if (!r.ok) throw new Error(j.erreur ?? "échec");
      toast.success("Tâche de fond lancée : suivez-la dans l'onglet Tâches.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impossible de lancer la tâche.");
    } finally {
      setTacheEnCours(false);
    }
  }
  const [c, setC] = useState(initiale);
  const [journalOuvert, setJournalOuvert] = useState(false);
  const terminal = c.statut === "reussie" || c.statut === "echouee" || c.statut === "erreur";

  useEffect(() => {
    if (terminal) return;
    let actif = true;
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/compilations/${c.id}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { compilation: CompilationPublique };
        if (actif) {
          setC(j.compilation);
          onMaj?.(j.compilation);
          notifierFin(j.compilation);
        }
      } catch {
        /* nouvel essai au prochain tour */
      }
    }, LOCAL ? 3_000 : 10_000); // en local, une construction ne dure souvent que quelques secondes
    return () => {
      actif = false;
      clearInterval(t);
    };
  }, [c.id, terminal, onMaj]);

  const Icone = c.statut === "reussie" ? CheckCircle2 : c.statut === "echouee" || c.statut === "erreur" ? AlertCircle : Loader2;

  return (
    <div className={cn("rounded-lg border text-sm", c.statut === "reussie" && "border-emerald-500/40", (c.statut === "echouee" || c.statut === "erreur") && "border-destructive/40")}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Icone className={cn("size-4 shrink-0", !terminal && "animate-spin text-muted-foreground", c.statut === "reussie" && "text-emerald-600", (c.statut === "echouee" || c.statut === "erreur") && "text-destructive")} />
        <span className="font-medium">{LIBELLES[c.statut]}</span>
        <span className="text-xs text-muted-foreground">
          {c.nom} · {c.nbFichiers} fichier{c.nbFichiers > 1 ? "s" : ""} · {formatHeure(new Date(c.creeA).getTime())}
        </span>
        {c.runUrl && (
          <a href={c.runUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline decoration-dotted underline-offset-2">
            journal GitHub <ExternalLink className="size-3" />
          </a>
        )}
        <div className="ml-auto flex gap-1.5">
          {/* Les artefacts GitHub expirent après 14 jours : au-delà, on n'affiche plus un bouton
              actif qui renverrait un 502, mais un libellé « expiré ». (#44) */}
          {c.statut === "reussie" &&
            c.jarNom &&
            (!c.locale && new Date().getTime() - new Date(c.creeA).getTime() > 14 * 24 * 3600_000 ? (
              <span className="text-xs text-muted-foreground">Artefact expiré (plus de 14 jours) : relancez la compilation.</span>
            ) : (
              <Button size="sm" nativeButton={false} render={<a href={`/api/compilations/${c.id}/jar`} download />}>
                <Download /> Télécharger {c.jarNom}
              </Button>
            ))}
          {c.statut === "echouee" && onDemanderCorrection && c.journal && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onDemanderCorrection(
                    `La compilation a échoué. Corrige le projet : blocs modif pour les fichiers existants, fichier entier seulement pour un nouveau fichier. Journal :\n\n\`\`\`text\n${c.journal}\n\`\`\``,
                  )
                }
              >
                <Wrench /> Demander une correction
              </Button>
              <Button size="sm" variant="outline" disabled={tacheEnCours} onClick={() => void lancerTache()} title="Corrige et recompile en boucle sur le serveur, même si vous fermez la page">
                {tacheEnCours ? <Loader2 className="animate-spin" /> : <Bot />} Corriger en tâche de fond
              </Button>
            </>
          )}
        </div>
      </div>
      {!terminal && <p className="border-t px-3 py-2 text-xs text-muted-foreground">Quelques secondes à quelques minutes selon le langage (un mod Minecraft : 3 à 8 minutes). Vous pouvez continuer à discuter, l&apos;état se met à jour seul.</p>}
      {c.erreur && <p className="border-t px-3 py-2 text-xs text-destructive">{c.erreur}</p>}
      {c.journal && (c.statut === "echouee" || c.statut === "reussie") && (
        <div className="border-t">
          <button type="button" onClick={() => setJournalOuvert((o) => !o)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground" aria-expanded={journalOuvert}>
            <Hammer className="size-3.5" />
            {c.statut === "echouee" ? "Erreurs (compilation ou tests)" : "Fin du journal"}
            <ChevronDown className={cn("ml-auto size-3.5 transition-transform", journalOuvert && "rotate-180")} />
          </button>
          {journalOuvert && <pre className="max-h-72 overflow-auto border-t bg-muted/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{c.journal}</pre>}
        </div>
      )}
    </div>
  );
}

/** État des compilations d'un message : liste persistée, lancement d'une nouvelle. */
export function useCompilations(conversationId: string | undefined, messageId: string, fichiers: Array<{ chemin: string; contenu: string }>) {
  const [liste, setListe] = useState<CompilationPublique[]>([]);
  const [lancement, setLancement] = useState(false);

  useEffect(() => {
    if (!conversationId) return;
    let actif = true;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    // La compilation automatique (lancée côté serveur juste après la réponse) peut arriver quelques
    // secondes après le montage : on re-interroge brièvement tant que la liste est vide.
    const charger = async (essai: number) => {
      try {
        const r = await fetch(`/api/compilations?messageId=${encodeURIComponent(messageId)}`, { cache: "no-store" });
        const j = (r.ok ? await r.json() : { compilations: [] }) as { compilations?: CompilationPublique[] };
        if (!actif) return;
        const liste = j.compilations ?? [];
        setListe((precedente) => (precedente.length && !liste.length ? precedente : liste));
        if (!liste.length && essai < 6) minuteur = setTimeout(() => void charger(essai + 1), 5000);
      } catch {
        /* ignoré */
      }
    };
    void charger(0);
    return () => {
      actif = false;
      if (minuteur) clearTimeout(minuteur);
    };
  }, [messageId, conversationId]);

  async function compiler() {
    setLancement(true);
    try {
      const r = await fetch("/api/compilations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, messageId, fichiers }),
      });
      const j = (await r.json()) as { compilation?: CompilationPublique; erreur?: string };
      if (j.compilation) {
        const c = j.compilation;
        setListe((l) => [c, ...l]);
        if (c.statut === "erreur") toast.error(c.erreur ?? "Envoi impossible.");
        else toast.message(LOCAL ? "Construction lancée sur cet ordinateur." : "Projet envoyé sur GitHub, construction lancée.");
      } else toast.error(j.erreur ?? "Compilation impossible.");
    } catch {
      toast.error("Le serveur ne répond pas.");
    } finally {
      setLancement(false);
    }
  }

  const majCompilation = useCallback((c: CompilationPublique) => setListe((l) => l.map((x) => (x.id === c.id ? c : x))), []);
  const enCours = liste.some((c) => c.statut === "en_attente" || c.statut === "en_cours");
  return { liste, compiler, lancement, enCours, majCompilation };
}

export function BoutonCompiler({ onClick, occupe }: { onClick: () => void; occupe: boolean }) {
  return (
    <Button size="sm" onClick={onClick} disabled={occupe}>
      {occupe ? <Loader2 className="animate-spin" /> : <Hammer />} {LOCAL ? "Construire et tester" : "Construire sur GitHub"}
    </Button>
  );
}

export function ListeCompilations({
  liste,
  onDemanderCorrection,
  onMaj,
}: {
  liste: CompilationPublique[];
  onDemanderCorrection?: (texte: string) => void;
  onMaj?: (c: CompilationPublique) => void;
}) {
  if (!liste.length) return null;
  return (
    <div className="flex flex-col gap-2 border-t p-2">
      {liste.map((c) => (
        <CarteCompilation key={c.id} compilation={c} onDemanderCorrection={onDemanderCorrection} onMaj={onMaj} />
      ))}
    </div>
  );
}
