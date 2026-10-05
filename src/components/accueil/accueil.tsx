"use client";

import { ArrowRight, Bot, CheckCircle2, Clock, ListChecks, Loader2, MessageSquare, Pause, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ResumeConversation } from "@/lib/db/conversations";
import type { TachePublique } from "@/lib/db/taches";
import type { EtatFournisseur, FournisseurPublic } from "@/lib/fournisseurs/types";
import { formatDepuis, formatDureeRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ecrirePremierMessage } from "@/components/chat/utils";

const SUGGESTIONS = [
  "Crée un mod Fabric pour Minecraft 26.3 qui ajoute une commande /heal, puis compile-le.",
  "Explique-moi les mixins Fabric avec un exemple minimal.",
  "Résume cette page : https://fabricmc.net/develop/",
];

function salutation() {
  const h = new Date().getHours();
  return h < 6 ? "Bonne nuit" : h < 18 ? "Bonjour" : "Bonsoir";
}

function BadgeTache({ t, maintenant }: { t: TachePublique; maintenant: number }) {
  if (t.statut === "terminee") return <Badge variant="secondary" className="gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-3" /> Terminée</Badge>;
  if (t.statut === "echouee") return <Badge variant="destructive" className="gap-1"><XCircle className="size-3" /> Échouée</Badge>;
  if (t.statut === "pause") return <Badge variant="outline" className="gap-1"><Pause className="size-3" /> En pause</Badge>;
  if (t.statut === "arretee") return <Badge variant="outline">Arrêtée</Badge>;
  if (t.statut === "en_attente" && t.repriseA) return <Badge variant="outline" className="gap-1"><Clock className="size-3" /> Reprise {formatDureeRelative(t.repriseA, maintenant)}</Badge>;
  return <Badge className="gap-1"><Loader2 className="size-3 animate-spin" /> En cours</Badge>;
}

function PastilleFournisseur({ f, maintenant }: { f: FournisseurPublic & { etat: EtatFournisseur }; maintenant: number }) {
  const s = f.etat.statut;
  const couleur = s === "disponible" ? "bg-emerald-500" : s === "epuise" || s === "erreur" ? "bg-red-500" : "bg-muted-foreground/50";
  const libelle = s === "disponible" ? "disponible" : s === "epuise" ? "épuisé" : s === "erreur" ? "en erreur" : "non testé";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs" title={`${f.modele} · ${libelle}`}>
      <span className={cn("size-2 rounded-full", couleur)} aria-hidden />
      {f.nom}
      {f.etat.reessaiA && f.etat.reessaiA > maintenant && <span className="text-muted-foreground">· {formatDureeRelative(f.etat.reessaiA, maintenant)}</span>}
    </span>
  );
}

export function Accueil() {
  const routeur = useRouter();
  const [texte, setTexte] = useState("");
  const [taches, setTaches] = useState<TachePublique[] | null>(null);
  const [conversations, setConversations] = useState<ResumeConversation[] | null>(null);
  const [fournisseurs, setFournisseurs] = useState<Array<FournisseurPublic & { etat: EtatFournisseur }> | null>(null);
  const [maintenant, setMaintenant] = useState(0);
  const [salut] = useState(() => salutation());

  const charger = useCallback(async () => {
    const [t, c, e] = await Promise.allSettled([
      fetch("/api/taches", { cache: "no-store" }).then((r) => r.json() as Promise<{ taches?: TachePublique[] }>),
      fetch("/api/conversations", { cache: "no-store" }).then((r) => r.json() as Promise<{ conversations?: ResumeConversation[] }>),
      fetch("/api/etat", { cache: "no-store" }).then((r) => r.json() as Promise<{ fournisseurs?: Array<FournisseurPublic & { etat: EtatFournisseur }> }>),
    ]);
    if (t.status === "fulfilled") setTaches(t.value.taches ?? []);
    if (c.status === "fulfilled") setConversations(c.value.conversations ?? []);
    if (e.status === "fulfilled") setFournisseurs(e.value.fournisseurs ?? []);
    setMaintenant(Date.now());
  }, []);

  useEffect(() => {
    const premier = setTimeout(() => void charger(), 0);
    const id = setInterval(() => void charger(), 10_000);
    return () => {
      clearTimeout(premier);
      clearInterval(id);
    };
  }, [charger]);

  function demarrer(t = texte) {
    const q = t.trim();
    if (q) ecrirePremierMessage(q);
    routeur.push("/chat");
  }

  const actives = (taches ?? []).filter((t) => t.statut === "en_cours" || t.statut === "en_attente");
  const recentes = (taches ?? []).filter((t) => t.statut !== "en_cours" && t.statut !== "en_attente").slice(0, 3);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col items-center gap-4 pt-6 text-center sm:pt-10">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
          <Bot className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{salut}. Que faisons-nous aujourd&apos;hui ?</h1>
          <p className="mt-1 text-sm text-muted-foreground">Une question, un mod à produire et compiler, une page à lire : écrivez, le reste suit.</p>
        </div>
        <form
          className="w-full max-w-2xl"
          onSubmit={(e) => {
            e.preventDefault();
            demarrer();
          }}
        >
          <div className="flex flex-col gap-2 rounded-2xl border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
            <textarea
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  demarrer();
                }
              }}
              rows={3}
              aria-label="Premier message"
              placeholder="Écrivez votre message… ou collez un lien pour qu'il soit lu"
              className="w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
            />
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] text-muted-foreground">Entrée pour commencer · Maj+Entrée pour un retour à la ligne</span>
              <Button type="submit" size="sm">
                {texte.trim() ? "Commencer" : "Nouvelle conversation"} <ArrowRight />
              </Button>
            </div>
          </div>
        </form>
        <div className="flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => demarrer(s)} className="rounded-full border px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              {s}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="size-4" /> Tâches de fond
            </CardTitle>
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/taches" />}>
              Tout voir <ArrowRight />
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {taches === null ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : actives.length === 0 && recentes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune tâche. Lancez-en une depuis l&apos;onglet Tâches : elle tournera même site fermé.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {[...actives, ...recentes].map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <BadgeTache t={t} maintenant={maintenant} />
                    <Link href={`/c/${t.conversationId}`} className="min-w-0 flex-1 truncate hover:underline">
                      {t.titre}
                    </Link>
                    <span className="text-xs text-muted-foreground">{t.etape}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="size-4" /> Conversations récentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {conversations === null ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : conversations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune conversation pour l&apos;instant.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {conversations.slice(0, 6).map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    <Link href={`/c/${c.id}`} className="min-w-0 flex-1 truncate hover:underline">
                      {c.titre}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground">{maintenant ? formatDepuis(new Date(c.majA).getTime(), maintenant) : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Fournisseurs :</span>
        {fournisseurs === null ? (
          <span className="text-xs text-muted-foreground">chargement…</span>
        ) : (
          fournisseurs.map((f) => <PastilleFournisseur key={f.id} f={f} maintenant={maintenant} />)
        )}
        <Link href="/etat" className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2">
          détails
        </Link>
      </section>
    </div>
  );
}
