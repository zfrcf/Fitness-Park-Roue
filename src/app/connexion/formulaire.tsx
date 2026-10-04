"use client";

import { Lock, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

function formatDuree(s: number) {
  if (s < 60) return `${s} s`;
  const m = Math.ceil(s / 60);
  return `${m} min`;
}

export function FormulaireConnexion() {
  const routeur = useRouter();
  const params = useSearchParams();
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [verrou, setVerrou] = useState(0);
  const [chargement, setChargement] = useState(false);

  useEffect(() => {
    if (verrou <= 0) return;
    const t = setInterval(() => setVerrou((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [verrou]);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setChargement(true);
    try {
      const r = await fetch("/api/connexion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motDePasse }),
      });
      const donnees = (await r.json()) as {
        ok?: boolean;
        erreur?: string;
        reessaiDans?: number;
        restantes?: number;
      };
      if (r.ok && donnees.ok) {
        const suivant = params.get("suivant");
        routeur.replace(suivant && suivant.startsWith("/") ? suivant : "/");
        routeur.refresh();
        return;
      }
      setErreur(donnees.erreur ?? "Connexion impossible.");
      if (donnees.restantes === 0 || r.status === 429) {
        setVerrou(donnees.reessaiDans ?? 0);
      }
      setMotDePasse("");
    } catch {
      setErreur("Le serveur ne répond pas. Réessayez.");
    } finally {
      setChargement(false);
    }
  }

  const bloque = verrou > 0;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="relative">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted">
          <Lock className="size-5" />
        </div>
        <CardTitle>Accès privé</CardTitle>
        <CardDescription>
          Entrez le mot de passe pour ouvrir le chat.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={soumettre} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="mot-de-passe">Mot de passe</Label>
            <Input
              id="mot-de-passe"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              disabled={bloque || chargement}
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              aria-invalid={erreur ? true : undefined}
            />
          </div>
          {erreur && (
            <p role="alert" className="text-sm text-destructive">
              {erreur}
              {bloque && ` Nouvel essai possible dans ${formatDuree(verrou)}.`}
            </p>
          )}
          <Button type="submit" disabled={bloque || chargement || !motDePasse}>
            {chargement && <Loader2 className="animate-spin" />}
            Se connecter
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
