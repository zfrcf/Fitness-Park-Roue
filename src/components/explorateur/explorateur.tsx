"use client";

/**
 * Explorateur de fichiers du projet, sur le modèle de VS Code :
 * arborescence (dossiers compactés, repliables), onglets (aperçu en italique, épinglé au double clic),
 * fil d'Ariane, éditeur coloré avec numéros de ligne et gouttière des lignes modifiées, barre d'état.
 * En direct : pendant que le modèle écrit, le fichier en cours s'ouvre et défile tout seul.
 */
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Download,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  PanelRightClose,
  Pencil,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fabriquerZip, telechargerFichier } from "@/components/chat/panneau-fichiers";
import { construireArbre, dossiersParents, lignesModifiees, type Noeud } from "@/lib/fichiers/explorateur";
import { nomArchive, type FichierGenere } from "@/lib/fichiers/extraire";
import { formatNombre } from "@/lib/format";
import { cn } from "@/lib/utils";
import { colorerParLigne, nomLangage } from "./coloration";

export type StatutFichier = "nouveau" | "modifie" | undefined;

export interface ProprietesExplorateur {
  fichiers: FichierGenere[];
  /** Contenu de chaque fichier AVANT la dernière réponse (décorations U/M, gouttière). */
  precedents: Map<string, string>;
  /** Fichier que le modèle est en train d'écrire (réponse en cours), sinon null. */
  enEcriture: { chemin: string; modification: boolean } | null;
  onFermer: () => void;
  className?: string;
  style?: React.CSSProperties;
}

function IconeFichier({ chemin, className }: { chemin: string; className?: string }) {
  const ext = chemin.split(".").pop()?.toLowerCase() ?? "";
  if (["json", "mcmeta", "json5"].includes(ext)) return <FileJson className={cn("text-yellow-600 dark:text-yellow-400", className)} />;
  if (ext === "java") return <FileCode2 className={cn("text-orange-600 dark:text-orange-400", className)} />;
  if (["gradle", "kts", "groovy"].includes(ext)) return <FileCode2 className={cn("text-teal-600 dark:text-teal-400", className)} />;
  if (["kt"].includes(ext)) return <FileCode2 className={cn("text-violet-600 dark:text-violet-400", className)} />;
  if (["md", "txt"].includes(ext)) return <FileText className={cn("text-sky-600 dark:text-sky-400", className)} />;
  if (["properties", "toml", "ini", "cfg", "yml", "yaml"].includes(ext)) return <FileText className={cn("text-muted-foreground", className)} />;
  if (["js", "ts", "tsx", "jsx", "py", "sh", "xml", "html", "css", "lua", "c", "cpp", "rs", "go"].includes(ext)) return <FileCode2 className={cn("text-blue-600 dark:text-blue-400", className)} />;
  return <File className={cn("text-muted-foreground", className)} />;
}

const LETTRE: Record<NonNullable<StatutFichier>, { lettre: string; classe: string; titre: string }> = {
  nouveau: { lettre: "U", classe: "text-emerald-600 dark:text-emerald-400", titre: "Nouveau (dernière réponse)" },
  modifie: { lettre: "M", classe: "text-amber-600 dark:text-amber-400", titre: "Modifié (dernière réponse)" },
};

export function Explorateur({ fichiers: fichiersDirects, precedents, enEcriture, onFermer, className, style }: ProprietesExplorateur) {
  // Le flux met à jour les fichiers à chaque morceau : rendu différé pour rester fluide.
  const fichiers = useDeferredValue(fichiersDirects);
  const parChemin = useMemo(() => new Map(fichiers.map((f) => [f.chemin, f])), [fichiers]);
  const statuts = useMemo(() => {
    const s = new Map<string, StatutFichier>();
    for (const f of fichiers) {
      const avant = precedents.get(f.chemin);
      if (avant === undefined) s.set(f.chemin, "nouveau");
      else if (avant !== f.contenu) s.set(f.chemin, "modifie");
    }
    return s;
  }, [fichiers, precedents]);
  const arbre = useMemo(() => construireArbre(fichiers.map((f) => f.chemin)), [fichiers]);
  const nom = nomArchive(fichiers, "projet");

  const [replies, setReplies] = useState<Set<string>>(new Set());
  const [ongletsBruts, setOnglets] = useState<string[]>([]);
  const [apercu, setApercu] = useState<string | null>(null); // onglet d'aperçu (italique), remplacé au prochain clic simple
  const [actifBrut, setActif] = useState<string | null>(null);
  // Un fichier supprimé par le modèle disparaît de ses onglets.
  const onglets = useMemo(() => ongletsBruts.filter((c) => parChemin.has(c)), [ongletsBruts, parChemin]);
  const actif = actifBrut && parChemin.has(actifBrut) ? actifBrut : null;
  const [suivre, setSuivre] = useState(true);


  function ouvrir(chemin: string, epingler: boolean) {
    setReplies((r) => {
      const parents = dossiersParents(chemin).filter((d) => r.has(d));
      if (!parents.length) return r;
      const n = new Set(r);
      parents.forEach((d) => n.delete(d));
      return n;
    });
    setOnglets((o) => {
      if (o.includes(chemin)) return o;
      // Clic simple : remplace l'onglet d'aperçu (comme VS Code) ; double clic : nouvel onglet épinglé.
      if (!epingler && apercu && o.includes(apercu)) return o.map((c) => (c === apercu ? chemin : c));
      return [...o, chemin];
    });
    if (epingler) setApercu((a) => (a === chemin ? null : a));
    else if (!onglets.includes(chemin)) setApercu(chemin);
    setActif(chemin);
  }

  function fermer(chemin: string) {
    setOnglets((o) => {
      const i = o.indexOf(chemin);
      const n = o.filter((c) => c !== chemin);
      if (actif === chemin) setActif(n[Math.min(i, n.length - 1)] ?? null);
      return n;
    });
    if (apercu === chemin) setApercu(null);
  }

  // En direct : le fichier que le modèle écrit s'ouvre tout seul (si « suivre » est actif).
  const cheminEcrit = enEcriture?.chemin;
  useEffect(() => {
    if (!cheminEcrit || !suivre) return;
    const t = setTimeout(() => {
      if (parChemin.has(cheminEcrit)) ouvrir(cheminEcrit, false);
    }, 0);
    return () => clearTimeout(t);
    // ouvrir() lit l'état courant ; on ne réagit qu'au changement de fichier écrit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheminEcrit, suivre, parChemin.has(cheminEcrit ?? "")]);

  // Clic sur un fichier dans la conversation : ouvert (épinglé) dans l'explorateur.
  useEffect(() => {
    const ecouter = (e: Event) => {
      const chemin = (e as CustomEvent<string>).detail;
      if (typeof chemin === "string") ouvrir(chemin, true);
    };
    window.addEventListener("atelier:ouvrir-fichier", ecouter);
    return () => window.removeEventListener("atelier:ouvrir-fichier", ecouter);
  });

  // Premier fichier ouvert d'office : la classe principale ou le premier fichier.
  useEffect(() => {
    if (actif || !fichiers.length) return;
    const principal = fichiers.find((f) => /\.(java|kt)$/.test(f.chemin) && !/mixin/i.test(f.chemin)) ?? fichiers[0];
    const t = setTimeout(() => ouvrir(principal.chemin, false), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fichiers.length > 0]);

  const fichierActif = actif ? parChemin.get(actif) : undefined;

  async function zip() {
    try {
      const blob = await fabriquerZip(fichiers);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${nom}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      toast.error("Impossible de créer l'archive.");
    }
  }

  const dossiersAvecChangements = useMemo(() => {
    const s = new Set<string>();
    for (const [chemin, st] of statuts) if (st) dossiersParents(chemin).forEach((d) => s.add(d));
    if (cheminEcrit) dossiersParents(cheminEcrit).forEach((d) => s.add(d));
    return s;
  }, [statuts, cheminEcrit]);

  return (
    <section aria-label="Explorateur de fichiers" style={style} className={cn("flex min-h-0 min-w-0 flex-col bg-background", className)}>
      <div className="flex min-h-0 flex-1">
        {/* Barre latérale : arborescence */}
        <div className="flex w-52 shrink-0 flex-col border-r bg-muted/40 max-sm:w-40">
          <div className="flex h-9 items-center gap-1 border-b px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">Explorateur</span>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Tout replier" onClick={() => setReplies(new Set(arbreDossiers(arbre)))} />}>
                <ChevronsDownUp />
              </TooltipTrigger>
              <TooltipContent>Tout replier</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Télécharger le projet (.zip)" onClick={() => void zip()} />}>
                <Archive />
              </TooltipTrigger>
              <TooltipContent>Télécharger le projet (.zip)</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex items-center gap-1 px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide">
            <ChevronDown className="size-3.5" />
            <span className="truncate" title={nom}>
              {nom}
            </span>
            <span className="ml-auto font-normal normal-case text-muted-foreground">{fichiers.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2 text-[13px]" role="tree">
            <Arbre
              noeuds={arbre}
              profondeur={0}
              replies={replies}
              basculer={(d) =>
                setReplies((r) => {
                  const n = new Set(r);
                  if (n.has(d)) n.delete(d);
                  else n.add(d);
                  return n;
                })
              }
              actif={actif}
              statuts={statuts}
              enEcriture={cheminEcrit}
              dossiersAvecChangements={dossiersAvecChangements}
              ouvrir={ouvrir}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 border-t px-2 py-1.5 text-[11px] text-muted-foreground select-none">
            <input type="checkbox" className="accent-primary" checked={suivre} onChange={(e) => setSuivre(e.target.checked)} />
            Suivre l&apos;écriture en direct
          </label>
        </div>

        {/* Zone d'édition : onglets, fil d'Ariane, code */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-stretch border-b bg-muted/40">
            <div className="flex min-w-0 flex-1 overflow-x-auto" role="tablist">
              {onglets.map((c) => {
                const st = statuts.get(c);
                const ecrit = c === cheminEcrit;
                return (
                  <div
                    key={c}
                    role="tab"
                    aria-selected={c === actif}
                    title={c}
                    onClick={() => setActif(c)}
                    onDoubleClick={() => setApercu((a) => (a === c ? null : a))}
                    onAuxClick={(e) => e.button === 1 && fermer(c)}
                    className={cn(
                      "group flex max-w-52 shrink-0 cursor-pointer items-center gap-1.5 border-r px-3 text-[13px]",
                      c === actif ? "border-t-2 border-t-primary bg-background" : "text-muted-foreground hover:bg-background/60",
                    )}
                  >
                    <IconeFichier chemin={c} className="size-3.5 shrink-0" />
                    <span className={cn("truncate", c === apercu && "italic", st && LETTRE[st].classe)}>{c.split("/").pop()}</span>
                    {ecrit ? (
                      <Pencil className="size-3 shrink-0 animate-pulse text-primary" aria-label="en cours d'écriture" />
                    ) : (
                      <button
                        type="button"
                        aria-label={`Fermer ${c}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          fermer(c);
                        }}
                        className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted aria-selected:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="m-0.5 shrink-0" aria-label="Fermer l'explorateur" onClick={onFermer} />}>
                <PanelRightClose />
              </TooltipTrigger>
              <TooltipContent>Fermer l&apos;explorateur (Ctrl+Maj+E)</TooltipContent>
            </Tooltip>
          </div>

          {fichierActif ? (
            <Editeur
              key={fichierActif.chemin}
              fichier={fichierActif}
              precedent={precedents.get(fichierActif.chemin)}
              enEcriture={fichierActif.chemin === cheminEcrit}
              modification={enEcriture?.modification ?? false}
              suivre={suivre}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <FolderOpen className="size-8 opacity-40" />
              Sélectionnez un fichier dans l&apos;explorateur.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function arbreDossiers(noeuds: Noeud[]): string[] {
  return noeuds.flatMap((n) => (n.type === "dossier" ? [n.chemin, ...arbreDossiers(n.enfants)] : []));
}

function Arbre(props: {
  noeuds: Noeud[];
  profondeur: number;
  replies: Set<string>;
  basculer: (dossier: string) => void;
  actif: string | null;
  statuts: Map<string, StatutFichier>;
  enEcriture?: string;
  dossiersAvecChangements: Set<string>;
  ouvrir: (chemin: string, epingler: boolean) => void;
}) {
  const { noeuds, profondeur, replies, basculer, actif, statuts, enEcriture, dossiersAvecChangements, ouvrir } = props;
  const retrait = { paddingLeft: `${8 + profondeur * 12}px` };
  return (
    <ul role="group">
      {noeuds.map((n) => {
        if (n.type === "dossier") {
          const ouvert = !replies.has(n.chemin);
          return (
            <li key={n.chemin} role="treeitem" aria-expanded={ouvert} aria-selected={false}>
              <button
                type="button"
                onClick={() => basculer(n.chemin)}
                style={retrait}
                className="flex h-[22px] w-full items-center gap-1 pr-2 text-left hover:bg-muted"
                title={n.chemin}
              >
                {ouvert ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                {ouvert ? <FolderOpen className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" /> : <Folder className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />}
                <span className="truncate">{n.nom}</span>
                {dossiersAvecChangements.has(n.chemin) && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />}
              </button>
              {ouvert && n.enfants.length > 0 && (
                // Guide d'indentation vertical, comme VS Code.
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 w-px bg-border" style={{ left: `${8 + profondeur * 12 + 7}px` }} aria-hidden />
                  <Arbre {...props} noeuds={n.enfants} profondeur={profondeur + 1} />
                </div>
              )}
            </li>
          );
        }
        const st = statuts.get(n.chemin);
        const ecrit = n.chemin === enEcriture;
        return (
          <li key={n.chemin} role="treeitem" aria-selected={n.chemin === actif}>
            <button
              type="button"
              onClick={() => ouvrir(n.chemin, false)}
              onDoubleClick={() => ouvrir(n.chemin, true)}
              style={{ paddingLeft: `${8 + profondeur * 12 + 18}px` }}
              className={cn("flex h-[22px] w-full items-center gap-1.5 pr-2 text-left hover:bg-muted", n.chemin === actif && "bg-primary/10 hover:bg-primary/15")}
              title={n.chemin}
            >
              <IconeFichier chemin={n.chemin} className="size-3.5 shrink-0" />
              <span className={cn("truncate", st && LETTRE[st].classe)}>{n.nom}</span>
              {ecrit ? (
                <Loader2 className="ml-auto size-3 shrink-0 animate-spin text-primary" aria-label="en cours d'écriture" />
              ) : (
                st && (
                  <span className={cn("ml-auto shrink-0 text-[11px] font-semibold", LETTRE[st].classe)} title={LETTRE[st].titre}>
                    {LETTRE[st].lettre}
                  </span>
                )
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Editeur({
  fichier,
  precedent,
  enEcriture,
  modification,
  suivre,
}: {
  fichier: FichierGenere;
  precedent: string | undefined;
  enEcriture: boolean;
  modification: boolean;
  suivre: boolean;
}) {
  const contenu = useDeferredValue(fichier.contenu);
  const lignes = useMemo(() => colorerParLigne(fichier.chemin, contenu.replace(/\n$/, "")), [fichier.chemin, contenu]);
  // Gouttière : lignes ajoutées/modifiées par la dernière réponse (pas pour un fichier nouveau : tout serait vert).
  const changees = useMemo(() => (precedent === undefined ? new Set<number>() : lignesModifiees(precedent.replace(/\n$/, ""), contenu.replace(/\n$/, ""))), [precedent, contenu]);
  const zone = useRef<HTMLDivElement>(null);
  const largeurNumeros = String(lignes.length).length;

  // En direct : on suit la fin du fichier qui s'écrit ; après une modification, on montre la première ligne changée.
  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    if (enEcriture && suivre && !modification) el.scrollTop = el.scrollHeight;
  }, [lignes.length, enEcriture, suivre, modification]);
  const premiereChangee = changees.size ? Math.min(...changees) : 0;
  useEffect(() => {
    const el = zone.current;
    if (!el || !premiereChangee || (enEcriture && !modification)) return;
    el.querySelector(`[data-ligne="${premiereChangee}"]`)?.scrollIntoView({ block: "center" });
    // Seulement quand une nouvelle modification apparaît.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [premiereChangee]);

  const segments = fichier.chemin.split("/");
  return (
    <>
      <div className="flex h-7 shrink-0 items-center gap-1 border-b px-3 text-xs text-muted-foreground">
        <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
          {segments.map((s, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3 shrink-0 opacity-60" />}
              <span className={cn(i === segments.length - 1 && "text-foreground")}>{s}</span>
            </span>
          ))}
        </span>
        {enEcriture && (
          <span className="flex shrink-0 items-center gap-1 text-primary">
            <Pencil className="size-3 animate-pulse" /> {modification ? "modification en cours…" : "écriture en cours…"}
          </span>
        )}
        <Button variant="ghost" size="icon-xs" aria-label={`Télécharger ${fichier.chemin}`} onClick={() => telechargerFichier(fichier)}>
          <Download />
        </Button>
      </div>
      <div ref={zone} className="min-h-0 flex-1 overflow-auto bg-background font-mono text-[12.5px] leading-[19px]">
        <div className="hljs min-w-max !bg-transparent py-1">
          {lignes.map((html, i) => {
            const n = i + 1;
            const changee = changees.has(n);
            return (
              <div key={i} data-ligne={n} className={cn("flex", changee && "bg-emerald-500/10")}>
                <span
                  className={cn("sticky left-0 shrink-0 select-none bg-background pr-3 pl-2 text-right text-muted-foreground/60", changee && "border-l-2 border-emerald-500")}
                  style={{ width: `${largeurNumeros + 3}ch` }}
                  aria-hidden
                >
                  {n}
                </span>
                {/* HTML produit et échappé par highlight.js (ou échappé à la main en texte brut). */}
                <span className="pr-6 whitespace-pre" dangerouslySetInnerHTML={{ __html: html || " " }} />
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex h-6 shrink-0 items-center gap-3 overflow-hidden border-t bg-primary px-3 text-[11px] whitespace-nowrap text-primary-foreground">
        <span>{nomLangage(fichier.chemin)}</span>
        <span>{formatNombre(lignes.length)} lignes</span>
        {changees.size > 0 && (
          <span title="lignes ajoutées ou modifiées par la dernière réponse">
            ● {formatNombre(changees.size)} modifiée{changees.size > 1 ? "s" : ""}
          </span>
        )}
        <span className="ml-auto max-md:hidden">UTF-8</span>
        <span className="max-md:hidden">Lecture seule</span>
      </div>
    </>
  );
}
