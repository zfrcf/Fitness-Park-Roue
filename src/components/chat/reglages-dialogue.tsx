"use client";

import { Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { REGLAGES_DEFAUT, type Reglages } from "@/lib/chat/types";
import type { NiveauRaisonnement } from "@/lib/fournisseurs/types";
import { useReglages } from "./reglages-contexte";

const NIVEAUX: Array<{ valeur: NiveauRaisonnement; libelle: string; aide: string }> = [
  { valeur: "aucun", libelle: "Désactivé", aide: "Réponse directe, économe en tokens (recommandé)." },
  { valeur: "faible", libelle: "Faible", aide: "Courte réflexion avant de répondre." },
  { valeur: "moyen", libelle: "Moyen", aide: "Réflexion plus poussée, plus lente." },
  { valeur: "eleve", libelle: "Élevé", aide: "Réflexion maximale, consomme beaucoup de tokens." },
];

const RACCOURCIS: Array<[string, string]> = [
  ["Entrée", "Envoyer"],
  ["Maj + Entrée", "Nouvelle ligne"],
  ["Échap", "Arrêter la génération"],
  ["/", "Aller à la saisie"],
  ["⌘/Ctrl + K", "Rechercher dans l'historique"],
  ["⌘/Ctrl + B", "Replier la barre latérale"],
  ["⌘/Ctrl + ⇧ + O", "Nouvelle conversation"],
  ["⌘/Ctrl + ,", "Réglages"],
  ["Bouton globe", "Forcer une recherche web"],
];

export function ReglagesDialogue() {
  const { reglages, enregistrer } = useReglages();
  const [ouvert, setOuvert] = useState(false);
  const [brouillon, setBrouillon] = useState<Reglages>(reglages);
  const [enregistrement, setEnregistrement] = useState(false);

  function ouvrir() {
    setBrouillon(reglages); // repart des réglages enregistrés à chaque ouverture
    setOuvert(true);
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        ouvrir();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  async function sauver() {
    setEnregistrement(true);
    try {
      await enregistrer(brouillon);
      toast.success("Réglages enregistrés.");
      setOuvert(false);
    } catch {
      toast.error("Impossible d'enregistrer les réglages.");
    } finally {
      setEnregistrement(false);
    }
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="Réglages" onClick={ouvrir} />}>
          <Settings2 className="size-4" />
        </TooltipTrigger>
        <TooltipContent>Réglages (⌘,)</TooltipContent>
      </Tooltip>
      <Dialog open={ouvert} onOpenChange={setOuvert}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Réglages</DialogTitle>
            <DialogDescription>
              Appliqués à tous les fournisseurs, pour toutes les conversations.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="systeme">Prompt système</Label>
              <Textarea
                id="systeme"
                rows={5}
                value={brouillon.systeme}
                onChange={(e) => setBrouillon({ ...brouillon, systeme: e.target.value })}
                className="min-h-28"
              />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between">
                <Label htmlFor="temperature">Température</Label>
                <span className="text-sm tabular-nums text-muted-foreground">{brouillon.temperature.toFixed(2).replace(".", ",")}</span>
              </div>
              <Slider
                id="temperature"
                min={0}
                max={2}
                step={0.05}
                value={[brouillon.temperature]}
                onValueChange={(v) => setBrouillon({ ...brouillon, temperature: Array.isArray(v) ? v[0] : v })}
              />
              <p className="text-xs text-muted-foreground">0 = déterministe, 1 = équilibré, 2 = très créatif.</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="max-tokens">Longueur maximale de la réponse (tokens)</Label>
              <Input
                id="max-tokens"
                type="number"
                min={64}
                max={200000}
                step={256}
                value={brouillon.maxTokens}
                onChange={(e) => setBrouillon({ ...brouillon, maxTokens: Number(e.target.value) || REGLAGES_DEFAUT.maxTokens })}
              />
              <p className="text-xs text-muted-foreground">
                Plafond par réponse ; le modèle s&apos;arrête avant s&apos;il a terminé. Groq limite à 16 384 pour Qwen 3.8.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Raisonnement</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {NIVEAUX.map((n) => (
                  <button
                    key={n.valeur}
                    type="button"
                    onClick={() => setBrouillon({ ...brouillon, raisonnement: n.valeur })}
                    aria-pressed={brouillon.raisonnement === n.valeur}
                    title={n.aide}
                    className="rounded-lg border px-2 py-1.5 text-sm transition-colors hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                  >
                    {n.libelle}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{NIVEAUX.find((n) => n.valeur === brouillon.raisonnement)?.aide}</p>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="recherche-auto">Recherche web automatique</Label>
                <p className="text-xs text-muted-foreground">
                  Le modèle peut lancer lui-même une recherche (DuckDuckGo) pour les informations récentes. Le bouton globe de la saisie force une recherche quoi qu&apos;il arrive.
                </p>
              </div>
              <Switch id="recherche-auto" checked={brouillon.rechercheAuto} onCheckedChange={(v) => setBrouillon({ ...brouillon, rechercheAuto: v })} />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <Label htmlFor="compilation-auto">Compilation automatique</Label>
                <p className="text-xs text-muted-foreground">
                  Dès qu&apos;une réponse crée ou modifie un projet Gradle (mod Minecraft), la compilation est lancée sans cliquer. Le résultat s&apos;affiche sous la réponse.
                </p>
              </div>
              <Switch id="compilation-auto" checked={brouillon.compilationAuto} onCheckedChange={(v) => setBrouillon({ ...brouillon, compilationAuto: v })} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Raccourcis clavier</Label>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {RACCOURCIS.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt>
                      <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
                    </dt>
                    <dd className="text-muted-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBrouillon(REGLAGES_DEFAUT)}>
              Valeurs par défaut
            </Button>
            <Button onClick={() => void sauver()} disabled={enregistrement}>
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
