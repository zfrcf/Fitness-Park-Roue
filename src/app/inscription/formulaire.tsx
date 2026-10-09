"use client";

import { CheckCircle2, Loader2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";

const CLE_APPAREIL = "chat:appareil";

/** Identifiant de cet appareil gardé par le navigateur (en plus du cookie posé par le serveur). */
function idAppareil(): string {
  try {
    let id = localStorage.getItem(CLE_APPAREIL);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "");
      localStorage.setItem(CLE_APPAREIL, id);
    }
    return id;
  } catch {
    return "";
  }
}

export function FormulaireInscription() {
  const routeur = useRouter();
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [site, setSite] = useState(""); // champ piège pour les robots
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);
  const [fini, setFini] = useState<{ mode: string; info?: string } | null>(null);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    if (motDePasse !== confirmation) {
      setErreur("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setChargement(true);
    try {
      const r = await fetch("/api/inscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nom, email, motDePasse, appareil: idAppareil(), site }),
      });
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; erreur?: string; mode?: string; info?: string };
      if (!r.ok || !d.ok) {
        setErreur(d.erreur ?? "Inscription impossible.");
        return;
      }
      if (d.mode === "aucune") {
        routeur.replace("/");
        routeur.refresh();
        return;
      }
      setFini({ mode: d.mode ?? "admin", info: d.info });
    } catch {
      setErreur("Le serveur ne répond pas. Réessayez.");
    } finally {
      setChargement(false);
    }
  }

  if (fini) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600">
            <CheckCircle2 className="size-5" />
          </div>
          <CardTitle>Compte créé</CardTitle>
          <CardDescription>
            {fini.info ??
              (fini.mode === "email"
                ? "Un e-mail d'activation vient de vous être envoyé : cliquez sur le lien qu'il contient (valable 48 h), puis vous serez connecté."
                : "Votre compte doit être validé par l'administrateur. Vous pourrez vous connecter dès qu'il sera activé.")}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Link href="/connexion" className="text-sm font-medium underline underline-offset-4">
            Aller à la connexion
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="relative">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted">
          <UserPlus className="size-5" />
        </div>
        <CardTitle>Créer un compte</CardTitle>
        <CardDescription>Un compte par personne : les doubles comptes sont refusés.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={soumettre} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nom">Nom</Label>
            <Input id="nom" autoComplete="name" required minLength={2} maxLength={60} autoFocus value={nom} onChange={(e) => setNom(e.target.value)} disabled={chargement} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Adresse e-mail</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={chargement} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="mot-de-passe">Mot de passe</Label>
            <Input id="mot-de-passe" type="password" autoComplete="new-password" required minLength={10} value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} disabled={chargement} />
            <p className="text-xs text-muted-foreground">10 caractères au moins.</p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirmation">Confirmer le mot de passe</Label>
            <Input id="confirmation" type="password" autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={chargement} />
          </div>
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label htmlFor="site">Site web</label>
            <input id="site" tabIndex={-1} autoComplete="off" value={site} onChange={(e) => setSite(e.target.value)} />
          </div>
          {erreur && (
            <p role="alert" className="text-sm text-destructive">
              {erreur}
            </p>
          )}
          <Button type="submit" disabled={chargement || !nom || !email || !motDePasse || !confirmation}>
            {chargement && <Loader2 className="animate-spin" />}
            Créer mon compte
          </Button>
        </form>
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        Déjà inscrit ?&nbsp;
        <Link href="/connexion" className="font-medium text-foreground underline underline-offset-4">
          Se connecter
        </Link>
      </CardFooter>
    </Card>
  );
}
