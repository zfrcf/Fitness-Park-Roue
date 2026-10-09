"use client";

import { KeyRound, Loader2, LogIn } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { destinationSure } from "./destination";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

function formatDuree(s: number) {
  if (s < 60) return `${s} s`;
  const m = Math.ceil(s / 60);
  return `${m} min`;
}

export function FormulaireConnexion() {
  const routeur = useRouter();
  const params = useSearchParams();
  const [modeAdmin, setModeAdmin] = useState(false);
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(params.get("activation") === "invalide" ? "Lien d'activation invalide ou expiré." : null);
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
        body: JSON.stringify(modeAdmin ? { motDePasse } : { email, motDePasse }),
      });
      const donnees = (await r.json()) as { ok?: boolean; erreur?: string; reessaiDans?: number; restantes?: number };
      if (r.ok && donnees.ok) {
        routeur.replace(destinationSure(params.get("suivant")));
        routeur.refresh();
        return;
      }
      setErreur(donnees.erreur ?? "Connexion impossible.");
      if (donnees.restantes === 0 || r.status === 429) setVerrou(donnees.reessaiDans ?? 0);
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
        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted">{modeAdmin ? <KeyRound className="size-5" /> : <LogIn className="size-5" />}</div>
        <CardTitle>{modeAdmin ? "Accès administrateur" : "Connexion"}</CardTitle>
        <CardDescription>{modeAdmin ? "Mot de passe de l'administrateur du site." : "Connectez-vous avec votre adresse e-mail."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={soumettre} className="flex flex-col gap-4">
          {!modeAdmin && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Adresse e-mail</Label>
              <Input id="email" type="email" autoComplete="email" autoFocus required disabled={bloque || chargement} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="mot-de-passe">Mot de passe</Label>
            <Input
              id="mot-de-passe"
              type="password"
              autoComplete="current-password"
              autoFocus={modeAdmin}
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
          <Button type="submit" disabled={bloque || chargement || !motDePasse || (!modeAdmin && !email)}>
            {chargement && <Loader2 className="animate-spin" />}
            Se connecter
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 text-sm">
        {!modeAdmin && (
          <p className="text-muted-foreground">
            Pas encore de compte ?{" "}
            <Link href="/inscription" className="font-medium text-foreground underline underline-offset-4">
              Créer un compte
            </Link>
          </p>
        )}
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            setModeAdmin((m) => !m);
            setErreur(null);
            setMotDePasse("");
          }}
        >
          {modeAdmin ? "Connexion avec une adresse e-mail" : "Accès administrateur"}
        </button>
      </CardFooter>
    </Card>
  );
}
