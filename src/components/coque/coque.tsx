"use client";

import { PanelLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ReglagesProvider } from "@/components/chat/reglages-contexte";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { BarreLaterale } from "./barre-laterale";
import { Entete } from "./entete";
import { ConsolePython } from "@/components/chat/console-python";

const CLE = "chat:barre-ouverte";
const ecouteurs = new Set<() => void>();
const abonner = (cb: () => void) => {
  ecouteurs.add(cb);
  return () => {
    ecouteurs.delete(cb);
  };
};
function lireOuverte() {
  try {
    return localStorage.getItem(CLE) !== "0";
  } catch {
    return true;
  }
}
function ecrireOuverte(v: boolean) {
  try {
    localStorage.setItem(CLE, v ? "1" : "0");
  } catch {
    /* stockage indisponible */
  }
  ecouteurs.forEach((f) => f());
}

/** Coque de l'application : barre latérale repliable (volet mobile) + en-tête + contenu. */
export function Coque({ children }: { children: React.ReactNode }) {
  // Préférence persistée dans localStorage, hydratation sûre via useSyncExternalStore.
  const ouverte = useSyncExternalStore(abonner, lireOuverte, () => true);
  const [mobile, setMobile] = useState(false);
  const [consoleOuv, setConsole] = useState(false);
  const routeur = useRouter();

  function basculer() {
    ecrireOuverte(!lireOuverte());
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        basculer();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        routeur.push("/chat");
      } else if (mod && (e.key === "`" || e.key === "²")) {
        e.preventDefault();
        setConsole((v) => !v);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [routeur]);

  const bouton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              ouverte
                ? "Replier la barre latérale"
                : "Déplier la barre latérale"
            }
            onClick={() => {
              if (window.matchMedia("(max-width: 767px)").matches)
                setMobile(true);
              else basculer();
            }}
          />
        }
      >
        <PanelLeft className="size-4" />
      </TooltipTrigger>
      <TooltipContent>Barre latérale (⌘B)</TooltipContent>
    </Tooltip>
  );

  return (
    <ReglagesProvider>
      <div className="flex h-dvh overflow-hidden">
        <aside
          className={cn(
            "hidden shrink-0 border-r bg-sidebar transition-[width] duration-200 md:block",
            ouverte ? "w-72" : "w-0 overflow-hidden border-r-0",
          )}
          aria-hidden={!ouverte}
        >
          <div className="h-full w-72">
            <BarreLaterale />
          </div>
        </aside>
        <Sheet open={mobile} onOpenChange={setMobile}>
          <SheetContent side="left" className="w-80 p-0">
            <SheetTitle className="sr-only">Historique</SheetTitle>
            <BarreLaterale onNaviguer={() => setMobile(false)} />
          </SheetContent>
        </Sheet>
        <div className="flex min-w-0 flex-1 flex-col">
          <Entete consoleOuverte={consoleOuv} onBasculerConsole={() => setConsole((v) => !v)}>
            {bouton}
          </Entete>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            {consoleOuv && (
              <div className="h-[38vh] min-h-48 shrink-0 border-t">
                <ConsolePython onFermer={() => setConsole(false)} />
              </div>
            )}
          </div>
        </div>
      </div>
    </ReglagesProvider>
  );
}
