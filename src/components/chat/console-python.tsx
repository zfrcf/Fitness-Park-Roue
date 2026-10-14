"use client";

import { CornerDownLeft, Loader2, Terminal, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { executerPython, importerFichiersConsole } from "@/lib/execution/python-navigateur";
import { abonnerProjetConsole, projetConsole } from "@/lib/execution/projet-console";
import { tronquerSortie } from "@/lib/execution/langues";
import { cn } from "@/lib/utils";

interface Cellule {
  code: string;
  sortie: string;
  erreur?: string;
}

/** Sortie d'une cellule : les lignes d'échec de pip (« ÉCHEC : », « ERREUR : ») ressortent en rouge. */
function Sortie({ texte }: { texte: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words pl-6 text-foreground/90">
      {texte.split("\n").map((l, i) => (
        <span key={i} className={/^(ÉCHEC|ERREUR) :/.test(l) ? "text-destructive" : undefined}>
          {l}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

/**
 * Console Python interactive (REPL) tournant DANS LE NAVIGATEUR via Pyodide : les variables et les
 * imports persistent d'une cellule à l'autre (même interpréteur). Aucun code n'est exécuté sur le
 * serveur. Historique des commandes avec les flèches haut/bas. Les fichiers du projet de la
 * conversation et ceux importés sont dans le dossier courant (pip install -r requirements.txt).
 */
export function ConsolePython({ onFermer }: { onFermer: () => void }) {
  const [code, setCode] = useState("");
  const [cellules, setCellules] = useState<Cellule[]>([]);
  const [occupe, setOccupe] = useState(false);
  const [etape, setEtape] = useState("");
  const [histIndex, setHistIndex] = useState(-1);
  const zone = useRef<HTMLTextAreaElement>(null);
  const bas = useRef<HTMLDivElement>(null);
  const entreeFichiers = useRef<HTMLInputElement>(null);
  const nbFichiersProjet = useSyncExternalStore(abonnerProjetConsole, () => projetConsole().length, () => 0);

  useEffect(() => {
    bas.current?.scrollIntoView({ behavior: "smooth" });
  }, [cellules, occupe]);

  useEffect(() => {
    zone.current?.focus();
  }, []);

  const historique = cellules.map((c) => c.code);

  async function lancer() {
    const c = code.trim();
    if (!c || occupe) return;
    setOccupe(true);
    setHistIndex(-1);
    try {
      const r = await executerPython(code, setEtape);
      setCellules((liste) => [...liste, { code, sortie: tronquerSortie(r.sortie), erreur: r.erreur ? tronquerSortie(r.erreur, 60, 4000) : undefined }]);
      setCode("");
    } catch (e) {
      setCellules((liste) => [...liste, { code, sortie: "", erreur: e instanceof Error ? e.message : "Exécution impossible." }]);
    } finally {
      setOccupe(false);
      setEtape("");
      zone.current?.focus();
    }
  }

  async function importer(e: ChangeEvent<HTMLInputElement>) {
    const liste = e.target.files;
    if (!liste?.length || occupe) return;
    setOccupe(true);
    try {
      const noms = await importerFichiersConsole(liste, setEtape);
      setCellules((l) => [...l, { code: "# fichiers importés", sortie: noms.length ? `Importé dans le dossier courant : ${noms.join(", ")}` : "", erreur: noms.length ? undefined : "Aucun fichier importé." }]);
    } catch (err) {
      setCellules((l) => [...l, { code: "# fichiers importés", sortie: "", erreur: err instanceof Error ? err.message : "Import impossible." }]);
    } finally {
      e.target.value = "";
      setOccupe(false);
      setEtape("");
      zone.current?.focus();
    }
  }

  function clavier(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Entrée exécute ; Maj+Entrée = nouvelle ligne (code multiligne).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void lancer();
    } else if (e.key === "ArrowUp" && !code.includes("\n") && historique.length) {
      e.preventDefault();
      const i = histIndex < 0 ? historique.length - 1 : Math.max(0, histIndex - 1);
      setHistIndex(i);
      setCode(historique[i]);
    } else if (e.key === "ArrowDown" && histIndex >= 0) {
      e.preventDefault();
      const i = histIndex + 1;
      if (i >= historique.length) {
        setHistIndex(-1);
        setCode("");
      } else {
        setHistIndex(i);
        setCode(historique[i]);
      }
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/50 px-3">
        <Terminal className="size-4 text-muted-foreground" />
        <span className="text-xs font-medium">Console Python</span>
        <span className="text-[11px] text-muted-foreground">· exécutée dans votre navigateur</span>
        {nbFichiersProjet > 0 && (
          <span className="hidden text-[11px] text-muted-foreground sm:inline" title="Copiés dans le dossier courant de la console">
            · {nbFichiersProjet} fichier{nbFichiersProjet > 1 ? "s" : ""} du projet
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <input ref={entreeFichiers} type="file" multiple hidden onChange={(e) => void importer(e)} />
          <Button variant="ghost" size="icon-sm" aria-label="Importer des fichiers" title="Importer des fichiers dans la console (ex. requirements.txt)" onClick={() => entreeFichiers.current?.click()} disabled={occupe}>
            <Upload />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Vider la console" title="Vider l'affichage (les variables restent)" onClick={() => setCellules([])} disabled={!cellules.length}>
            <Trash2 />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Fermer la console" onClick={onFermer}>
            <X />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12.5px] leading-relaxed">
        {cellules.length === 0 && (
          <p className="text-muted-foreground">
            Tapez du Python et appuyez sur Entrée. Installez des paquets avec <code>pip install nom</code> ou <code>pip install -r requirements.txt</code> (les fichiers du projet de la conversation et ceux importés avec le bouton ↑ sont dans le dossier courant). <code>pip help</code> liste les commandes. Les variables et les imports restent d&apos;une commande à l&apos;autre. Maj+Entrée pour une nouvelle ligne.
          </p>
        )}
        {cellules.map((c, i) => (
          <div key={i} className="mb-2">
            <div className="flex gap-2">
              <span className="shrink-0 select-none text-primary">&gt;&gt;&gt;</span>
              <pre className="whitespace-pre-wrap break-words">{c.code}</pre>
            </div>
            {c.sortie && <Sortie texte={c.sortie} />}
            {c.erreur && <pre className="whitespace-pre-wrap break-words pl-6 text-destructive">{c.erreur}</pre>}
          </div>
        ))}
        {occupe && (
          <p className="flex items-center gap-2 pl-6 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> {etape || "Exécution…"}
          </p>
        )}
        <div ref={bas} />
      </div>
      <div className="flex items-end gap-2 border-t p-2">
        <span className="select-none pt-2 pl-1 font-mono text-sm text-primary">&gt;&gt;&gt;</span>
        <textarea
          ref={zone}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={clavier}
          rows={1}
          spellCheck={false}
          placeholder="print('Bonjour')"
          aria-label="Code Python à exécuter"
          className={cn("max-h-40 min-h-9 flex-1 resize-none rounded-md border bg-transparent px-2 py-1.5 font-mono text-[12.5px] outline-none focus-visible:border-ring", "field-sizing-content")}
          disabled={occupe}
        />
        <Button size="icon" aria-label="Exécuter" onClick={() => void lancer()} disabled={occupe || !code.trim()}>
          {occupe ? <Loader2 className="animate-spin" /> : <CornerDownLeft className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
