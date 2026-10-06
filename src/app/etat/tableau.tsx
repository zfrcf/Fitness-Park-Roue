"use client";

import { CheckCircle2, CircleHelp, Loader2, RefreshCw, RotateCcw, XCircle, Zap } from "lucide-react";
import { useCallback, useState } from "react";
import { useSondage } from "@/hooks/use-sondage";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDureeRelative, formatHeure, formatNombre, formatTokens } from "@/lib/format";
import { LOCAL } from "@/lib/mode";
import { cn } from "@/lib/utils";
import type { EtatFournisseur, FournisseurPublic } from "@/lib/fournisseurs/types";

interface Depense {
  montant: number;
  tokensEntree: number;
  tokensSortie: number;
  requetes: number;
}
type Ligne = FournisseurPublic & {
  etat: EtatFournisseur;
  depense: Depense | null;
  limites?: { itpm?: number; otpm?: number };
  debit?: { utilise: number; limite?: number };
  occupe?: boolean;
};
interface Reponse {
  fournisseurs: Ligne[];
  stockage: { kv: "redis" | "memoire" };
  plafondMensuel: number;
  mois: string;
  depenseTotale: number;
  maintenant: number;
}

const fmtUSD = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

function BadgeStatut({ etat }: { etat: EtatFournisseur }) {
  switch (etat.statut) {
    case "disponible":
      return (
        <Badge variant="secondary" className="gap-1 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-3" /> Disponible
        </Badge>
      );
    case "epuise":
      return (
        <Badge variant="secondary" className="gap-1 text-amber-700 dark:text-amber-400">
          <Zap className="size-3" /> Épuisé
        </Badge>
      );
    case "erreur":
      return (
        <Badge variant="secondary" className="gap-1 text-destructive">
          <XCircle className="size-3" /> Erreur
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <CircleHelp className="size-3" /> Pas encore testé
        </Badge>
      );
  }
}

function LigneInfo({ libelle, valeur }: { libelle: string; valeur: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{libelle}</span>
      <span className="text-right font-medium tabular-nums">{valeur}</span>
    </div>
  );
}

export function TableauEtat() {
  const [donnees, setDonnees] = useState<Reponse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enTest, setEnTest] = useState<Record<string, boolean>>({});
  const [maintenant, setMaintenant] = useState(() => Date.now());

  const charger = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch("/api/etat", { cache: "no-store", signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setDonnees((await r.json()) as Reponse);
      setMaintenant(Date.now());
      setErreur(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErreur(e instanceof Error ? e.message : "Erreur de chargement");
    }
  }, []);
  useSondage(charger, 60_000);

  async function tester(f: Ligne) {
    setEnTest((s) => ({ ...s, [f.id]: true }));
    try {
      const r = await fetch("/api/etat/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: f.id }),
      });
      const j = (await r.json()) as { resultat?: { ok: boolean; message: string; latenceMs: number }; erreur?: string };
      if (j.resultat?.ok) toast.success(`${f.nom} répond en ${j.resultat.latenceMs} ms`);
      else toast.error(`${f.nom} : ${j.resultat?.message ?? j.erreur ?? "échec"}`);
    } catch {
      toast.error(`${f.nom} : le test a échoué.`);
    } finally {
      setEnTest((s) => ({ ...s, [f.id]: false }));
      void charger();
    }
  }

  async function reinitialiser(f: Ligne) {
    await fetch("/api/etat/reinitialiser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: f.id }),
    });
    toast.message(`État de ${f.nom} réinitialisé.`);
    void charger();
  }

  if (erreur) {
    return (
      <p className="text-sm text-destructive">
        Impossible de charger l&apos;état : {erreur}
      </p>
    );
  }

  if (!donnees) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">État des fournisseurs</h1>
          <p className="text-sm text-muted-foreground">
            Ordre d&apos;utilisation, quotas connus et heure de réessai. État stocké en{" "}
            {donnees.stockage.kv === "redis" ? "Redis" : "mémoire locale (Redis non configuré)"}.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void charger()}>
          <RefreshCw /> Actualiser
        </Button>
      </div>

      {donnees.fournisseurs.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {LOCAL
              ? "Aucun fournisseur configuré. Dans un terminal, lancez « atelier config » (ou déposez atelier-cles.env dans Téléchargements), puis rouvrez Atelier IA."
              : "Aucun fournisseur configuré. Renseignez PROVIDER_1_NAME, _BASE_URL, _API_KEY, _MODEL et _CONTEXT."}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {donnees.fournisseurs.map((f) => {
          const e = f.etat;
          const q = e.quota;
          return (
            <Card key={f.id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
                        {f.rang}
                      </span>
                      {f.nom}
                      {f.payant && <Badge variant="outline">payant</Badge>}
                    </CardTitle>
                    <CardDescription className="mt-1 font-mono text-xs break-all">{f.modele}</CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <BadgeStatut etat={e} />
                    {f.occupe && (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Zap className="size-3" /> tâche en cours
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-1.5">
                <LigneInfo libelle="Contexte" valeur={`${formatTokens(f.contexte)} tokens`} />
                {f.debit?.limite !== undefined && (
                  <LigneInfo libelle="Requêtes / min (fenêtre)" valeur={`${formatNombre(f.debit.utilise)} / ${formatNombre(f.debit.limite)}`} />
                )}
                {(f.limites?.itpm || f.limites?.otpm) && (
                  <LigneInfo
                    libelle="Limites apprises / min"
                    valeur={[f.limites?.itpm && `${formatTokens(f.limites.itpm)} entrée`, f.limites?.otpm && `${formatTokens(f.limites.otpm)} sortie`].filter(Boolean).join(" · ")}
                  />
                )}
                {e.reessaiA && e.reessaiA > maintenant && (
                  <LigneInfo
                    libelle="Réessai"
                    valeur={`${formatHeure(e.reessaiA)} (dans ${formatDureeRelative(e.reessaiA, maintenant)})`}
                  />
                )}
                {q?.requetesRestantes !== undefined && (
                  <LigneInfo
                    libelle="Requêtes restantes"
                    valeur={`${formatNombre(q.requetesRestantes)}${q.requetesLimite ? ` / ${formatNombre(q.requetesLimite)}` : ""}`}
                  />
                )}
                {q?.tokensRestants !== undefined && (
                  <LigneInfo
                    libelle="Tokens restants (fenêtre)"
                    valeur={`${formatNombre(q.tokensRestants)}${q.tokensLimite ? ` / ${formatNombre(q.tokensLimite)}` : ""}`}
                  />
                )}
                {q?.journalierLimite !== undefined && (
                  <LigneInfo
                    libelle="Requêtes gratuites du jour"
                    valeur={`${formatNombre(q.journalierUtilise ?? 0)} / ${formatNombre(q.journalierLimite)}`}
                  />
                )}
                {f.famille === "cloudflare" && (
                  <LigneInfo libelle="Quota gratuit" valeur="10 000 neurons / jour (non exposé par l'API)" />
                )}
                {f.payant && (
                  <>
                    <LigneInfo
                      libelle={`Dépense du mois (${donnees.mois})`}
                      valeur={`${fmtUSD.format(f.depense?.montant ?? 0)}${donnees.plafondMensuel > 0 ? ` / ${fmtUSD.format(donnees.plafondMensuel)}` : ""}`}
                    />
                    {donnees.plafondMensuel > 0 ? (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.min(100, Math.round((donnees.depenseTotale / donnees.plafondMensuel) * 100))} aria-valuemin={0} aria-valuemax={100}>
                        <div
                          className={cn("h-full rounded-full", donnees.depenseTotale >= donnees.plafondMensuel ? "bg-destructive" : "bg-primary")}
                          style={{ width: `${Math.min(100, (donnees.depenseTotale / donnees.plafondMensuel) * 100)}%` }}
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-amber-700 dark:text-amber-400">PAID_MONTHLY_CAP est à 0 : ce fournisseur n&apos;est jamais utilisé.</p>
                    )}
                    {f.depense && (
                      <LigneInfo libelle="Requêtes payantes" valeur={`${formatNombre(f.depense.requetes)} · ${formatTokens(f.depense.tokensEntree)} → ${formatTokens(f.depense.tokensSortie)} tokens`} />
                    )}
                  </>
                )}
                {e.derniereReussiteA && <LigneInfo libelle="Dernière réussite" valeur={formatHeure(e.derniereReussiteA)} />}
                {e.raison && (
                  <p className="mt-1 rounded-md bg-muted p-2 text-xs break-words text-muted-foreground">{e.raison}</p>
                )}
                {e.dernierTest && (
                  <p className="text-xs text-muted-foreground">
                    Dernier test {formatHeure(e.dernierTest.a)} · {e.dernierTest.ok ? "réussi" : "échoué"} ·{" "}
                    {e.dernierTest.latenceMs} ms
                    {e.dernierTest.tokens && ` · ${e.dernierTest.tokens.entree}→${e.dernierTest.tokens.sortie} tokens`}
                    {!e.dernierTest.ok && ` · ${e.dernierTest.message}`}
                  </p>
                )}
                <div className="mt-auto flex gap-2 pt-3">
                  <Button size="sm" onClick={() => void tester(f)} disabled={enTest[f.id]}>
                    {enTest[f.id] ? <Loader2 className="animate-spin" /> : <Zap />} Tester
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void reinitialiser(f)}>
                    <RotateCcw /> Réinitialiser
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
