"use client";

import { AppWindow, CornerDownLeft, Loader2, Square, Terminal, Trash2, Upload, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { lignesAffichees, texteLigne } from "@/lib/execution/ansi";
import { avecMorceaux, grouperMorceaux, tamponMorceaux } from "@/lib/execution/morceaux";
import { abonnerEtatExecution, arreterExecution, etatExecution, executerPython, importerFichiersConsole, type Morceau } from "@/lib/execution/python-navigateur";
import { abonnerProjetConsole, projetConsole } from "@/lib/execution/projet-console";
import { abonnerFenetres, fermerToutesFenetres, nombreFenetres } from "@/lib/execution/ui/fenetres";
import { cn } from "@/lib/utils";

interface Cellule {
  id: number;
  code: string;
  /** Sortie dans l'ordre exact du programme (textes, erreurs, images), y compris l'affichage tardif. */
  morceaux: Morceau[];
  /** Programme encore en cours (fenêtre ouverte, boucle, input) : sa sortie s'affiche en direct. */
  enCours?: boolean;
}

/** Commande envoyée à la console depuis l'extérieur (bouton « Lancer » de l'explorateur). */
const EVENEMENT_COMMANDE = "atelier:console-commande";
let commandeEnAttente: string | null = null;

/** Demande à la console d'exécuter une commande (elle s'ouvre si besoin : voir la coque). */
export function envoyerALaConsole(commande: string): void {
  commandeEnAttente = commande;
  window.dispatchEvent(new CustomEvent(EVENEMENT_COMMANDE));
}

/**
 * Texte d'un flux (sortie ou erreur) : couleurs ANSI et retours chariot « \r » interprétés (barres de
 * progression), lignes d'échec de pip (« ÉCHEC : », « ERREUR : ») en rouge, longueur limitée en gardant
 * la FIN comme un terminal (résultat final, dernière ligne d'un traceback ; en-tête du traceback aussi).
 */
function TexteFlux({ texte, erreur }: { texte: string; erreur?: boolean }) {
  const { lignes, avertissement, position } = useMemo(() => (erreur ? lignesAffichees(texte, 80, 6000, 3) : lignesAffichees(texte, 400, 40_000)), [texte, erreur]);
  const marque = avertissement ? <span className="text-muted-foreground">{`${avertissement}\n`}</span> : null;
  return (
    <span className={erreur ? "text-destructive" : undefined}>
      {lignes.map((ligne, i) => (
        <span key={i}>
          {i === position ? marque : null}
          <span className={!erreur && /^(ÉCHEC|ERREUR) :/.test(texteLigne(ligne)) ? "text-destructive" : undefined}>
            {ligne.map((s, j) => (
              <span key={j} style={s.couleur ? { color: s.couleur } : undefined} className={s.gras ? "font-bold" : undefined}>
                {s.texte}
              </span>
            ))}
            {i < lignes.length - 1 ? "\n" : ""}
          </span>
        </span>
      ))}
      {position >= lignes.length ? marque : null}
    </span>
  );
}

/**
 * Sortie d'un programme dans l'ordre exact où il l'a produite : textes (sortie et erreurs mêlées,
 * comme dans un terminal) et graphiques matplotlib à leur place. Partagée avec le bouton « Exécuter ».
 */
export function SortieOrdonnee({ morceaux, classeTexte, classeImage }: { morceaux: Morceau[]; classeTexte?: string; classeImage?: string }) {
  const { groupes, tronque } = grouperMorceaux(morceaux);
  return (
    <>
      {tronque && <pre className={cn("text-muted-foreground", classeTexte)}>[… début de la sortie masqué]</pre>}
      {groupes.map((g, i) =>
        "image" in g ? (
          // Graphique matplotlib produit dans le navigateur (data: URL PNG).
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={g.image} alt="Graphique" className={cn("rounded border bg-white", classeImage)} />
        ) : (
          <pre key={i} className={cn("whitespace-pre-wrap break-words", classeTexte)}>
            {g.textes.map((t, j) => (
              <TexteFlux key={j} texte={t.texte} erreur={t.erreur} />
            ))}
          </pre>
        ),
      )}
    </>
  );
}

/** Une cellule de la console (mémorisée : taper du code ne la redessine pas). */
const BlocCellule = memo(function BlocCellule({ cellule }: { cellule: Cellule }) {
  return (
    <div className="mb-2">
      <div className="flex gap-2">
        <span className="shrink-0 select-none text-primary">&gt;&gt;&gt;</span>
        <pre className="whitespace-pre-wrap break-words">{cellule.code}</pre>
      </div>
      <SortieOrdonnee morceaux={cellule.morceaux} classeTexte="pl-6 text-foreground/90" classeImage="my-1 ml-6 max-h-96 max-w-[calc(100%-1.5rem)]" />
    </div>
  );
});

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
  const enCours = useRef<Promise<void> | null>(null);
  const nbFichiersProjet = useSyncExternalStore(abonnerProjetConsole, () => projetConsole().length, () => 0);
  const nbFenetres = useSyncExternalStore(abonnerFenetres, nombreFenetres, () => 0);
  const enAttente = useSyncExternalStore(abonnerEtatExecution, () => etatExecution().attentes > 0, () => false);
  // input(), sys.stdin, getpass : le programme attend une ligne tapée dans la console (avec JSPI ; sinon boîte du navigateur).
  const [saisie, setSaisie] = useState<{ invite: string; masque: boolean; finDeFichier: boolean } | null>(null);
  const [reponse, setReponse] = useState("");
  const repondre = useRef<((v: string | null | false) => void) | null>(null);
  const demontee = useRef(false);

  useEffect(() => {
    bas.current?.scrollIntoView({ behavior: "smooth" });
  }, [cellules, occupe]);

  useEffect(() => {
    zone.current?.focus();
    demontee.current = false;
    // Console fermée : comme un terminal fermé, plus aucune saisie possible (fin de fichier : EOFError).
    return () => {
      demontee.current = true;
      repondre.current?.(false);
    };
  }, []);

  const historique = cellules.map((c) => c.code);

  /** Ajoute à une cellule, à la suite, ce que le programme affiche (en direct, puis après la fin de son exécution). */
  function ajouterTardif(id: number, ms: Morceau[]) {
    setCellules((liste) => liste.map((c) => (c.id === id ? { ...c, morceaux: avecMorceaux(c.morceaux, ms) } : c)));
  }

  async function executer(source: string, remplacer = false) {
    if (!source.trim()) return;
    if (occupeRef.current) {
      // « ▶ Lancer » pendant qu'un programme tourne encore (fenêtre ouverte) : on l'arrête d'abord.
      if (!remplacer || !enCours.current) return;
      arreterExecution();
      // Un programme peut intercepter l'interruption (except KeyboardInterrupt) et continuer : attente bornée.
      await Promise.race([enCours.current.catch(() => undefined), new Promise((ok) => setTimeout(ok, 3000))]);
      if (occupeRef.current) {
        const message: Morceau = { texte: `Le programme en cours ne s'est pas arrêté (il intercepte l'interruption) : « ${source} » n'a pas été lancé. Répondez-lui ou cliquez de nouveau sur « Arrêter ».`, erreur: true };
        setCellules((liste) => [...liste, { id: prochainId++, code: source, morceaux: [message] }]);
        return;
      }
    }
    occupeRef.current = true;
    setOccupe(true);
    setHistIndex(-1);
    const id = prochainId++;
    // La cellule apparaît tout de suite : un programme peut rester actif (fenêtre ouverte, boucle, input).
    setCellules((liste) => [...liste, { id, code: source, morceaux: [], enCours: true }]);
    setCode((actuel) => (actuel === source ? "" : actuel));
    let fin: () => void = () => undefined;
    enCours.current = new Promise<void>((ok) => (fin = ok));
    // Console fermée puis nouvelle saisie demandée (l'EOF de la fermeture a été ignoré, ex. boucle avec
    // « except: ») : programme tué, comme un terminal fermé (SIGHUP), au lieu de tourner sans fin en arrière-plan.
    const arretForce = new AbortController();
    // Une mise à jour d'état par image au plus, pas une par print (boucle de 1 million de lignes).
    const tampon = tamponMorceaux((ms) => ajouterTardif(id, ms));
    try {
      const r = await executerPython(source, setEtape, {
        sortieTardive: tampon.ajouter,
        enDirect: tampon.ajouter,
        signal: arretForce.signal,
        saisie: (invite, { masque, finDeFichier, signal }) => {
          if (demontee.current) {
            arretForce.abort();
            return new Promise<never>(() => undefined);
          }
          return new Promise((ok) => {
                repondre.current = ok;
                setReponse("");
                setSaisie({ invite, masque: Boolean(masque), finDeFichier: Boolean(finDeFichier) });
                // Demande abandonnée (Arrêter, fin du programme) : le champ disparaît.
                signal.addEventListener("abort", () => {
                  if (repondre.current !== ok) return;
                  repondre.current = null;
                  setSaisie(null);
                });
              });
        },
      });
      tampon.abandonner(); // déjà dans r.morceaux
      setCellules((liste) => liste.map((c) => (c.id === id ? { ...c, morceaux: r.morceaux, enCours: false } : c)));
    } catch (e) {
      const erreur: Morceau = { texte: e instanceof Error ? e.message : "Exécution impossible.", erreur: true };
      setCellules((liste) => liste.map((c) => (c.id === id ? { ...c, morceaux: [...c.morceaux, erreur], enCours: false } : c)));
    } finally {
      occupeRef.current = false;
      fin();
      repondre.current = null;
      setSaisie(null);
      setOccupe(false);
      setEtape("");
      zone.current?.focus();
    }
  }

  function envoyerReponse(v: string | null | false) {
    const f = repondre.current;
    repondre.current = null;
    setSaisie(null);
    f?.(v);
  }
  const executerRef = useRef(executer);
  executerRef.current = executer;

  // Commandes venues de l'extérieur (bouton « Lancer » d'un fichier .py dans l'explorateur).
  useEffect(() => {
    const prendre = () => {
      const c = commandeEnAttente;
      commandeEnAttente = null;
      if (c) void executerRef.current(c, true);
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
      setCellules((l) => [...l, { id, code: "# fichiers importés", morceaux: [noms.length ? { texte: `Importé dans le dossier courant : ${noms.join(", ")}` } : { texte: "Aucun fichier importé.", erreur: true }] }]);
    } catch (err) {
      setCellules((l) => [...l, { id, code: "# fichiers importés", morceaux: [{ texte: err instanceof Error ? err.message : "Import impossible.", erreur: true }] }]);
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
            Tapez du Python et appuyez sur Entrée (Maj+Entrée pour une nouvelle ligne). Lancez un fichier avec <code>python main.py</code> : les fichiers du projet de la conversation et ceux importés avec le bouton ↑ sont dans le dossier courant. Les programmes tkinter et turtle ouvrent des fenêtres (la commande se termine quand on les ferme, ou avec « Arrêter »), <code>input()</code> se répond ici, les graphiques matplotlib s&apos;affichent ici. Paquets : <code>pip install nom</code> ou <code>pip install -r requirements.txt</code>.
          </p>
        )}
        {cellules.map((c) => (
          <BlocCellule key={c.id} cellule={c} />
        ))}
        {saisie ? (
          <div className="flex items-center gap-2 pl-6">
            <span className="select-none text-primary">↳</span>
            <input
              autoFocus
              type={saisie.masque ? "password" : "text"}
              autoComplete="off"
              value={reponse}
              onChange={(e) => setReponse(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  envoyerReponse(reponse);
                } else if (e.key === "Escape") envoyerReponse(null);
              }}
              aria-label={saisie.invite || "Réponse au programme"}
              placeholder={saisie.finDeFichier ? "Ligne lue par le programme (Entrée pour valider, Échap pour finir la saisie)" : "Réponse au programme (Entrée pour valider, Échap pour annuler)"}
              className="min-w-0 flex-1 rounded border bg-transparent px-2 py-0.5 font-mono text-[12.5px] outline-none focus-visible:border-ring"
            />
            <Button variant="outline" size="xs" title="Arrête le programme (ses fenêtres se ferment)" onClick={() => arreterExecution()}>
              <Square /> Arrêter
            </Button>
          </div>
        ) : (
          occupe && (
            <p className="flex items-center gap-2 pl-6 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {enAttente ? "Programme en cours : il attend la fermeture de sa fenêtre." : etape || "Exécution…"}
              <Button variant="outline" size="xs" className="ml-1" title="Arrête le programme (ses fenêtres se ferment)" onClick={() => arreterExecution()}>
                <Square /> Arrêter
              </Button>
            </p>
          )
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
