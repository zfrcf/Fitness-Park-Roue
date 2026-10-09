"use client";

import { Ban, Check, Loader2, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDepuis } from "@/lib/format";

interface Compte {
  id: string;
  email: string;
  nom: string;
  statut: "en_attente" | "actif" | "bloque";
  creeA: string;
  derniereConnexion: string | null;
  quota: { messages: number; tokens: number; limiteMessages: number; limiteTokens: number } | null;
}

const LIBELLE_VERIF: Record<string, string> = {
  email: "par lien envoyé par e-mail",
  admin: "par vous (aucun service d'e-mail configuré)",
  aucune: "aucune (comptes actifs dès l'inscription)",
};

function BadgeStatut({ s }: { s: Compte["statut"] }) {
  if (s === "actif") return <Badge variant="secondary" className="text-emerald-700 dark:text-emerald-400">Actif</Badge>;
  if (s === "bloque") return <Badge variant="destructive">Bloqué</Badge>;
  return <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">En attente</Badge>;
}

export function TableauComptes() {
  const [comptes, setComptes] = useState<Compte[] | null>(null);
  const [verification, setVerification] = useState("admin");
  const [occupe, setOccupe] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/comptes", { cache: "no-store" });
      const d = (await r.json()) as { comptes?: Compte[]; verification?: string; erreur?: string };
      if (!r.ok) throw new Error(d.erreur ?? `HTTP ${r.status}`);
      setComptes(d.comptes ?? []);
      setVerification(d.verification ?? "admin");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, []);

  useEffect(() => {
    // Différé d'un tour : le chargement met l'état à jour hors du rendu de l'effet.
    const t = setTimeout(() => void charger(), 0);
    return () => clearTimeout(t);
  }, [charger]);

  async function agir(c: Compte, action: "valider" | "bloquer" | "debloquer" | "supprimer") {
    if (action === "supprimer" && !window.confirm(`Supprimer le compte ${c.email} et toutes ses conversations ?`)) return;
    setOccupe(c.id);
    try {
      const r =
        action === "supprimer"
          ? await fetch(`/api/admin/comptes?id=${encodeURIComponent(c.id)}`, { method: "DELETE" })
          : await fetch("/api/admin/comptes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, action }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { erreur?: string }).erreur ?? `HTTP ${r.status}`);
      await charger();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setOccupe(null);
    }
  }

  const enAttente = comptes?.filter((c) => c.statut === "en_attente").length ?? 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Comptes</h1>
          <p className="text-sm text-muted-foreground">
            Vérification des nouveaux comptes : {LIBELLE_VERIF[verification] ?? verification}.
            {enAttente > 0 && <span className="ml-1 font-medium text-amber-700 dark:text-amber-400">{enAttente} en attente.</span>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void charger()}>
          <RefreshCw /> Actualiser
        </Button>
      </div>
      {comptes === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Chargement…
        </p>
      ) : comptes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun compte pour l&apos;instant. La page d&apos;inscription est /inscription.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {comptes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {c.nom} <span className="font-normal text-muted-foreground">· {c.email}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  inscrit {formatDepuis(new Date(c.creeA).getTime())}
                  {c.derniereConnexion && <> · vu {formatDepuis(new Date(c.derniereConnexion).getTime())}</>}
                  {c.quota && (
                    <>
                      {" "}
                      · aujourd&apos;hui {c.quota.messages}
                      {c.quota.limiteMessages > 0 && `/${c.quota.limiteMessages}`} messages, {new Intl.NumberFormat("fr-FR").format(c.quota.tokens)} tokens
                    </>
                  )}
                </p>
              </div>
              <BadgeStatut s={c.statut} />
              <div className="flex gap-1">
                {occupe === c.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    {c.statut === "en_attente" && (
                      <Button size="sm" onClick={() => void agir(c, "valider")}>
                        <Check /> Valider
                      </Button>
                    )}
                    {c.statut === "actif" && (
                      <Button size="sm" variant="outline" onClick={() => void agir(c, "bloquer")}>
                        <Ban /> Bloquer
                      </Button>
                    )}
                    {c.statut === "bloque" && (
                      <Button size="sm" variant="outline" onClick={() => void agir(c, "debloquer")}>
                        <Undo2 /> Débloquer
                      </Button>
                    )}
                    <Button size="icon-sm" variant="ghost" aria-label={`Supprimer ${c.email}`} onClick={() => void agir(c, "supprimer")}>
                      <Trash2 />
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
