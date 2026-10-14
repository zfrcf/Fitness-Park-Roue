"use client";

import { AppWindow, CornerDownLeft, Loader2, Terminal, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { executerPython, importerFichiersConsole, type Morceau } from "@/lib/execution/python-navigateur";
import { abonnerProjetConsole, projetConsole } from "@/lib/execution/projet-console";
import { abonnerFenetres, fermerToutesFenetres, nombreFenetres } from "@/lib/execution/ui/fenetres";
import { tronquerSortie } from "@/lib/execution/langues";
import { cn } from "@/lib/utils";

interface Cellule {
  id: number;
  code: string;
  sortie: string;
  erreur?: string;
  images: string[];
}

/** Commande envoyée à la console depuis l'extérieur (bouton « Lancer » de l'explorateur). */
const EVENEMENT_COMMANDE = "atelier:console-commande";
let commandeEnAttente: string | null = null;

/** Demande à la console d'exécuter une commande (elle s'ouvre si besoin : voir la coque). */
export function envoyerALaConsole(commande: string): void {
  commandeEnAttente = commande;
  window.dispatchEvent(new CustomEvent(EVENEMENT_COMMANDE));
}

/** Sortie d'une cellule : les lignes d'échec de pip (« ÉCHEC : », « ERREUR : ») ressortent en rouge. */
function Sortie({ texte }: { texte: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words pl-6 text-foreground/90">
      {texte.split("\n").map((l, i, tout) => (
        <span key={i} className={/^(ÉCHEC|ERREUR) :/.test(l) ? "text-destructive" : undefined}>
          {l}
          {i < tout.length - 1 ? "\n" : ""}
        </span>
      ))}
    </pre>
  );
}

let prochainId = 1;

/**
 * Console Python interactive (REPL) tournant DANS LE NAVIGATEUR via Pyodide : les variables et les
 * imports persistent d'une cellule à l'autre (même interpréteur). Aucun code n'est exécuté sur le
 * serveur. Historique des commandes avec les flèches haut/bas. Les fichiers du projet de la
 * conversation et ceux importés sont dans le dossier courant (python main.py, pip install -r …).
 * Les programmes à interface (tkinter, turtle) ouvrent des fenêtres ; ce qu'ils affichent ensuite
 * (clics, minuteries) s'ajoute sous la commande qui les a lancés.
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
  const occupeRef = useRef(false);
  const nbFichiersProjet = useSyncExternalStore(abonnerProjetConsole, () => projetConsole().length, () => 0);
  const nbFenetres = useSyncExternalStore(abonnerFenetres, nombreFenetres, () => 0);

  useEffect(() => {
    bas.current?.scrollIntoView({ behavior: "smooth" });
  }, [cellules, occupe]);

  useEffect(() => {
    zone.current?.focus();
  }, []);

  const historique = cellules.map((c) => c.code);

  /** Ajoute à une cellule ce que le programme affiche après la fin de son exécution. */
  function ajouterTardif(id: number, m: Morceau) {
    setCellules((liste) =>
      liste.map((c) => {
        if (c.id !== id) return c;
        if ("image" in m) return { ...c, images: [...c.images, m.image] };
        return m.erreur ? { ...c, erreur: (c.erreur ?? "") + m.texte } : { ...c, sortie: c.sortie + m.texte };
      }),
    );
  }

  async function executer(source: string) {
    if (!source.trim() || occupeRef.current) return;
    occupeRef.current = true;
    setOccupe(true);
    setHistIndex(-1);
    const id = prochainId++;
    try {
      const r = await executerPython(source, setEtape, { sortieTardive: (m) => ajouterTardif(id, m) });
      setCellules((liste) => [...liste, { id, code: source, sortie: r.sortie, erreur: r.erreur, images: r.images }]);
      setCode((actuel) => (actuel === source ? "" : actuel));
    } catch (e) {
      setCellules((liste) => [...liste, { id, code: source, sortie: "", erreur: e instanceof Error ? e.message : "Exécution impossible.", images: [] }]);
    } finally {
      occupeRef.current = false;
      setOccupe(false);
      setEtape("");
      zone.current?.focus();
    }
  }
  const executerRef = useRef(executer);
  executerRef.current = executer;

  // Commandes venues de l'extérieur (bouton « Lancer » d'un fichier .py dans l'explorateur).
  useEffect(() => {
    const prendre = () => {
      const c = commandeEnAttente;
      commandeEnAttente = null;
      if (c) void executerRef.current(c);
    };
    const t = setTimeout(prendre, 0); // console ouverte par la commande elle-même
    window.addEventListener(EVENEMENT_COMMANDE, prendre);
    return () => {
      clearTimeout(t);
      window.removeEventListener(EVENEMENT_COMMANDE, prendre);
    };
  }, []);

  async function importer(e: ChangeEvent<HTMLInputElement>) {
    const liste = e.target.files;
    if (!liste?.length || occupeRef.current) return;
    occupeRef.current = true;
    setOccupe(true);
    const id = prochainId++;
    try {
      const noms = await importerFichiersConsole(liste, setEtape);
      setCellules((l) => [...l, { id, code: "# fichiers importés", sortie: noms.length ? `Importé dans le dossier courant : ${noms.join(", ")}` : "", erreur: noms.length ? undefined : "Aucun fichier importé.", images: [] }]);
    } catch (err) {
      setCellules((l) => [...l, { id, code: "# fichiers importés", sortie: "", erreur: err instanceof Error ? err.message : "Import impossible.", images: [] }]);
    } finally {
      e.target.value = "";
      occupeRef.current = false;
      setOccupe(false);
      setEtape("");
      zone.current?.focus();
    }
  }

  function clavier(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Entrée exécute ; Maj+Entrée = nouvelle ligne (code multiligne).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void executer(code);
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
        <span className="hidden text-[11px] text-muted-foreground sm:inline">· exécutée dans votre navigateur</span>
        {nbFichiersProjet > 0 && (
          <span className="hidden text-[11px] text-muted-foreground md:inline" title="Copiés dans le dossier courant de la console">
            · {nbFichiersProjet} fichier{nbFichiersProjet > 1 ? "s" : ""} du projet
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {nbFenetres > 0 && (
            <Button variant="outline" size="xs" title="Ferme les fenêtres des programmes (tkinter, turtle) et arrête leurs minuteries" onClick={() => fermerToutesFenetres()}>
              <AppWindow /> {nbFenetres} fenêtre{nbFenetres > 1 ? "s" : ""} · Fermer
            </Button>
          )}
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
            Tapez du Python et appuyez sur Entrée (Maj+Entrée pour une nouvelle ligne). Lancez un fichier avec <code>python main.py</code> : les fichiers du projet de la conversation et ceux importés avec le bouton ↑ sont dans le dossier courant. Les programmes tkinter et turtle ouvrent des fenêtres, <code>input()</code> ouvre une boîte de saisie, les graphiques matplotlib s&apos;affichent ici. Paquets : <code>pip install nom</code> ou <code>pip install -r requirements.txt</code>.
          </p>
        )}
        {cellules.map((c) => (
          <div key={c.id} className="mb-2">
            <div className="flex gap-2">
              <span className="shrink-0 select-none text-primary">&gt;&gt;&gt;</span>
              <pre className="whitespace-pre-wrap break-words">{c.code}</pre>
            </div>
            {c.sortie && <Sortie texte={tronquerSortie(c.sortie)} />}
            {c.erreur && <pre className="whitespace-pre-wrap break-words pl-6 text-destructive">{tronquerSortie(c.erreur, 60, 4000)}</pre>}
            {c.images.map((src, i) => (
              // Graphique matplotlib produit dans le navigateur (data: URL PNG).
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt={`Graphique ${i + 1}`} className="my-1 ml-6 max-h-96 max-w-[calc(100%-1.5rem)] rounded border bg-white" />
            ))}
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
          placeholder="print('Bonjour')  ou  python main.py"
          aria-label="Code Python à exécuter"
          className={cn("max-h-40 min-h-9 flex-1 resize-none rounded-md border bg-transparent px-2 py-1.5 font-mono text-[12.5px] outline-none focus-visible:border-ring", "field-sizing-content")}
          disabled={occupe}
        />
        <Button size="icon" aria-label="Exécuter" onClick={() => void executer(code)} disabled={occupe || !code.trim()}>
          {occupe ? <Loader2 className="animate-spin" /> : <CornerDownLeft className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
