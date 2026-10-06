// Atelier IA — application de bureau (Electron).
//
// La fenêtre affiche l'application locale servie sur 127.0.0.1 par « atelier ui » (qui démarre
// le serveur puis lance cette application avec --url=…). Ce processus ne fait que l'habillage
// natif : fenêtre, menus en français, menu contextuel, liens externes dans le navigateur,
// téléchargements, mémoire de la taille de la fenêtre, et arrêt du serveur à la fermeture.
"use strict";

const { app, BrowserWindow, Menu, dialog, nativeTheme, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

app.setName("atelier-ia");

const argUrl = process.argv.find((a) => a.startsWith("--url="));
const URL_APP = (argUrl ? argUrl.slice(6) : process.env.ATELIER_URL || "http://127.0.0.1:3210").replace(/\/$/, "");
const ORIGINE = new URL(URL_APP).origin;
const LANCEUR = (() => {
  try {
    return JSON.parse(process.env.ATELIER_LANCEUR_JSON || "null");
  } catch {
    return null;
  }
})();
const ICONE = path.join(__dirname, "icone.png");
const FICHIER_FENETRE = () => path.join(app.getPath("userData"), "fenetre.json");

let fenetre = null;
let quitterPourDeBon = false;

// Une seule instance : relancer l'application ramène la fenêtre existante au premier plan.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!fenetre) return;
    if (fenetre.isMinimized()) fenetre.restore();
    fenetre.show();
    fenetre.focus();
  });
  app.whenReady().then(demarrer);
}

function lireGeometrie() {
  try {
    const g = JSON.parse(fs.readFileSync(FICHIER_FENETRE(), "utf8"));
    if (g && g.width >= 600 && g.height >= 400) return g;
  } catch {
    /* première ouverture */
  }
  return { width: 1280, height: 860 };
}

function enregistrerGeometrie() {
  if (!fenetre || fenetre.isDestroyed()) return;
  const g = { ...fenetre.getNormalBounds(), maximisee: fenetre.isMaximized() };
  try {
    fs.mkdirSync(path.dirname(FICHIER_FENETRE()), { recursive: true });
    fs.writeFileSync(FICHIER_FENETRE(), JSON.stringify(g));
  } catch {
    /* sans gravité */
  }
}

function estInterne(url) {
  try {
    return new URL(url).origin === ORIGINE;
  } catch {
    return false;
  }
}

function ouvrirDehors(url) {
  // Seuls les liens web partent vers le navigateur ; jamais file:, javascript:, etc.
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

function aller(chemin) {
  if (fenetre) void fenetre.loadURL(URL_APP + chemin);
}

function demarrer() {
  const g = lireGeometrie();
  fenetre = new BrowserWindow({
    title: "Atelier IA",
    icon: ICONE,
    x: g.x,
    y: g.y,
    width: g.width,
    height: g.height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#09090b" : "#ffffff",
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (g.maximisee) fenetre.maximize();
  try {
    fenetre.webContents.session.setSpellCheckerLanguages(["fr"]);
  } catch {
    /* dictionnaire indisponible : pas de correcteur */
  }

  fenetre.once("ready-to-show", () => fenetre.show());
  fenetre.on("resize", enregistrerGeometrie);
  fenetre.on("move", enregistrerGeometrie);

  // Liens externes : navigateur du système. Navigation limitée à l'application locale.
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (estInterne(url)) return { action: "allow" };
    ouvrirDehors(url);
    return { action: "deny" };
  });
  fenetre.webContents.on("will-navigate", (e, url) => {
    if (!estInterne(url)) {
      e.preventDefault();
      ouvrirDehors(url);
    }
  });

  // Serveur injoignable : page d'attente qui réessaie toute seule.
  fenetre.webContents.on("did-fail-load", (_e, code, _desc, url, principal) => {
    if (!principal || code === -3) return; // -3 : navigation annulée
    const page = `<!doctype html><meta charset="utf-8"><title>Atelier IA</title>
<body style="font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:${nativeTheme.shouldUseDarkColors ? "#09090b;color:#fafafa" : "#fff;color:#18181b"}">
<div style="text-align:center"><p>Le serveur de l'atelier ne répond pas encore…</p>
<p style="opacity:.6">Nouvel essai dans 2 s. Si cela dure, lancez « atelier ui » dans un terminal.</p></div>
<script>setTimeout(() => location.replace(${JSON.stringify(url || URL_APP)}), 2000)</script>`;
    void fenetre.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(page));
  });

  fenetre.webContents.on("context-menu", (_e, p) => menuContextuel(p).popup({ window: fenetre }));
  fenetre.on("close", (e) => {
    if (quitterPourDeBon) return;
    e.preventDefault();
    void confirmerFermeture();
  });

  Menu.setApplicationMenu(menuPrincipal());
  void fenetre.loadURL(URL_APP + "/");
}

/** Tâches de fond en cours sur le serveur local (elles s'arrêtent avec lui). */
async function tachesActives() {
  try {
    const r = await fetch(URL_APP + "/api/taches", { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    return (j.taches || []).filter((t) => t.statut === "en_cours" || t.statut === "en_attente");
  } catch {
    return [];
  }
}

async function confirmerFermeture() {
  const actives = await tachesActives();
  let arreterServeur = true;
  if (actives.length) {
    const { response } = await dialog.showMessageBox(fenetre, {
      type: "question",
      title: "Tâche de fond en cours",
      message: actives.length === 1 ? "Une tâche de fond est en cours." : `${actives.length} tâches de fond sont en cours.`,
      detail:
        "Laisser tourner en arrière-plan : la fenêtre se ferme, le serveur continue et la tâche va jusqu'au bout (rouvrez Atelier IA pour voir le résultat).\n\nQuitter : tout s'arrête ; la tâche reprendra au prochain lancement.",
      buttons: ["Laisser tourner en arrière-plan", "Quitter", "Annuler"],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 2) return;
    arreterServeur = response === 1;
  }
  quitterPourDeBon = true;
  enregistrerGeometrie();
  if (arreterServeur) arreterLeServeur();
  app.quit();
}

function arreterLeServeur() {
  if (!Array.isArray(LANCEUR) || !LANCEUR.length) return;
  try {
    // Détaché : l'application se ferme tout de suite, l'arrêt se termine seul.
    const p = spawn(LANCEUR[0], [...LANCEUR.slice(1), "ui", "--arreter"], { detached: true, stdio: "ignore" });
    p.unref();
  } catch {
    /* le serveur restera actif ; « atelier ui --arreter » l'arrête */
  }
}

function menuContextuel(p) {
  const modele = [];
  for (const s of p.dictionarySuggestions || []) {
    modele.push({ label: s, click: () => fenetre.webContents.replaceMisspelling(s) });
  }
  if (p.misspelledWord) {
    modele.push(
      { label: "Ajouter au dictionnaire", click: () => fenetre.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) },
      { type: "separator" },
    );
  }
  if (p.linkURL) {
    modele.push(
      { label: "Ouvrir le lien dans le navigateur", click: () => ouvrirDehors(p.linkURL) },
      { label: "Copier l'adresse du lien", click: () => require("electron").clipboard.writeText(p.linkURL) },
      { type: "separator" },
    );
  }
  if (p.isEditable) {
    modele.push(
      { label: "Annuler", role: "undo", enabled: p.editFlags.canUndo },
      { label: "Rétablir", role: "redo", enabled: p.editFlags.canRedo },
      { type: "separator" },
      { label: "Couper", role: "cut", enabled: p.editFlags.canCut },
    );
  }
  modele.push({ label: "Copier", role: "copy", enabled: p.editFlags.canCopy });
  if (p.isEditable) modele.push({ label: "Coller", role: "paste", enabled: p.editFlags.canPaste });
  modele.push({ label: "Tout sélectionner", role: "selectAll" });
  return Menu.buildFromTemplate(modele);
}

function menuPrincipal() {
  const donnees = process.env.ATELIER_DONNEES;
  return Menu.buildFromTemplate([
    {
      label: "&Fichier",
      submenu: [
        { label: "Nouvelle conversation", accelerator: "CmdOrCtrl+N", click: () => aller("/chat") },
        { type: "separator" },
        ...(donnees
          ? [
              { label: "Ouvrir le dossier des compilations", click: () => void shell.openPath(path.join(donnees, "compilations", "jars")) },
              { label: "Ouvrir le journal du serveur", click: () => void shell.openPath(path.join(donnees, "ui", "ui.log")) },
              { type: "separator" },
            ]
          : []),
        { label: "Fermer la fenêtre", accelerator: "CmdOrCtrl+W", click: () => fenetre && fenetre.close() },
        { label: "Quitter", accelerator: "CmdOrCtrl+Q", click: () => fenetre && fenetre.close() },
      ],
    },
    {
      label: "É&dition",
      submenu: [
        { label: "Annuler", role: "undo" },
        { label: "Rétablir", role: "redo" },
        { type: "separator" },
        { label: "Couper", role: "cut" },
        { label: "Copier", role: "copy" },
        { label: "Coller", role: "paste" },
        { label: "Tout sélectionner", role: "selectAll" },
      ],
    },
    {
      label: "&Aller",
      submenu: [
        { label: "Accueil", accelerator: "Alt+1", click: () => aller("/") },
        { label: "Chat", accelerator: "Alt+2", click: () => aller("/chat") },
        { label: "Tâches de fond", accelerator: "Alt+3", click: () => aller("/taches") },
        { label: "État des fournisseurs", accelerator: "Alt+4", click: () => aller("/etat") },
        { type: "separator" },
        { label: "Précédent", accelerator: "Alt+Left", click: () => fenetre && fenetre.webContents.navigationHistory.goBack() },
        { label: "Suivant", accelerator: "Alt+Right", click: () => fenetre && fenetre.webContents.navigationHistory.goForward() },
      ],
    },
    {
      label: "&Affichage",
      submenu: [
        { label: "Recharger", role: "reload" },
        { type: "separator" },
        { label: "Zoom avant", role: "zoomIn" },
        { label: "Zoom arrière", role: "zoomOut" },
        { label: "Taille réelle", role: "resetZoom" },
        { type: "separator" },
        { label: "Plein écran", role: "togglefullscreen" },
        { label: "Outils de développement", role: "toggleDevTools" },
      ],
    },
    {
      label: "Ai&de",
      submenu: [
        {
          label: "À propos d'Atelier IA",
          click: () =>
            void dialog.showMessageBox(fenetre, {
              title: "À propos",
              message: `Atelier IA ${app.getVersion()}`,
              detail: `Chat IA, projets Gradle et mods Minecraft compilés sur cet ordinateur.\nServeur local : ${URL_APP}\nElectron ${process.versions.electron}`,
              icon: ICONE,
            }),
        },
      ],
    },
  ]);
}

app.on("window-all-closed", () => app.quit());
