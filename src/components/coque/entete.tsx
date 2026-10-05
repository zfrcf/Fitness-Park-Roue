"use client";

import { Activity, Home, ListChecks, LogOut, MessageSquare } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ReglagesDialogue } from "@/components/chat/reglages-dialogue";
import { ThemeToggle } from "@/components/theme-toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LOCAL } from "@/lib/mode";
import { cn } from "@/lib/utils";

const LIENS = [
  { href: "/", libelle: "Accueil", icone: Home },
  { href: "/chat", libelle: "Chat", icone: MessageSquare },
  { href: "/taches", libelle: "Tâches", icone: ListChecks },
  { href: "/etat", libelle: "État", icone: Activity },
] as const;

export function Entete({ children }: { children?: React.ReactNode }) {
  const chemin = usePathname();
  const routeur = useRouter();

  async function deconnecter() {
    await fetch("/api/deconnexion", { method: "POST" });
    routeur.replace("/connexion");
    routeur.refresh();
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
      {children}
      <nav className="flex items-center gap-1">
        {LIENS.map(({ href, libelle, icone: Icone }) => {
          const actif = href === "/" ? chemin === "/" : href === "/chat" ? chemin.startsWith("/chat") || chemin.startsWith("/c/") : chemin.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium transition-colors hover:bg-muted",
                actif ? "bg-muted text-foreground" : "text-muted-foreground",
              )}
            >
              <Icone className="size-4" />
              <span className="hidden sm:inline">{libelle}</span>
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-1">
        <ReglagesDialogue />
        <ThemeToggle />
        {/* Atelier local : pas de mot de passe, donc pas de déconnexion. */}
        {!LOCAL && (
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon" aria-label="Se déconnecter" onClick={deconnecter} />}
            >
              <LogOut className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Se déconnecter</TooltipContent>
          </Tooltip>
        )}
      </div>
    </header>
  );
}
