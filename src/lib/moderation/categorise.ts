/**
 * Modération du contenu des messages des MEMBRES (les administrateurs ne sont jamais filtrés).
 * Trois catégories : contenu sexuel explicite, fabrication/obtention d'armes réelles, et
 * déclaration d'être mineur.
 *
 * Filtre par motifs (rapide, mais imparfait par nature) : il vise les cas réels sans casser l'usage
 * principal de l'app (mods Minecraft : épées, « gun », « sword », blocs TNT du jeu ne sont PAS des
 * armes réelles). L'administrateur peut débloquer un faux positif.
 */
export type Categorie = "sexuel" | "armes" | "mineur";

export interface Verdict {
  /** Catégorie bloquante détectée, ou null si le message passe. */
  categorie: Categorie | null;
  /** Motif technique (journal interne), jamais montré tel quel à l'utilisateur. */
  motif?: string;
}

/** Normalise : minuscules, accents retirés, apostrophes → espace, espaces compactés. Déjoue « s3xe ». */
function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // diacritiques combinants (accents)
    .replace(/[0@]/g, (c) => (c === "0" ? "o" : "a"))
    .replace(/['’`]/g, " ") // « j'ai » → « j ai », « d'une » → « d une »
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Le message parle-t-il d'un jeu / de fiction ? (protège les mods Minecraft des faux positifs « armes ».) */
function contexteJeu(t: string): boolean {
  return /\b(minecraft|fabric|neoforge|forge|datapack|mod|mods|modpack|texture|resource ?pack|plugin|spigot|bukkit|roblox|unity|unreal|jeu video|jeu-video|jeu|game|gaming|fps|rpg|npc|pnj|skin|loot|craft|crafting|schematic)\b/.test(t);
}

/** Contexte éducatif / médical : on ne bloque pas une question de santé ou d'éducation. */
function contexteEducatif(t: string): boolean {
  return /\b(education sexuelle|sante sexuelle|sexuellement transmissible|ist|mst|contraception|puberte|gyneco|medecin|consentement|prevention|sex education|sexual health|std|sti)\b/.test(t);
}

// ───────────── Mineur : déclaration à la première personne ─────────────
const MINEUR: RegExp[] = [
  /\bje suis (une? )?mineure?\b/,
  /\bj ?ai moins de 18 ans\b/,
  /\bje n ?ai pas (encore )?18 ans\b/,
  /\bj ?ai pas (encore )?18 ans\b/,
  // « j'ai 15 ans » (1 à 17), mais pas « 15 ans d'expérience / de métier / de mariage »
  /\bj ?ai (1[0-7]|[1-9]) ans\b(?! ?(d |de ))/,
  /\bi ?m a minor\b/,
  /\bi am a minor\b/,
  /\bi ?m (1[0-7]|[1-9]) (years? old|yo|yrs?)\b/,
  /\bi am (1[0-7]|[1-9]) (years? old|yo)\b/,
];

// ───────────── Sexuel : contenu explicite / demande érotique ─────────────
const SEXUEL: RegExp[] = [
  /\b(porno?|pornographi|xxx|nsfw|hentai|rule ?34)\b/,
  /\b(scene|contenu|histoire|recit|texte|roleplay|jeu de role|rp)s? (sexuel|erotique|porno|xxx|hot|de sexe|de cul|de baise)\b/,
  /\b(ecris|raconte|decris|genere|fais)[^.]{0,30}(scene|histoire|texte)[^.]{0,20}(de sexe|sexuel|erotique|porno)/,
  /\b(sexe explicite|relation sexuelle explicite|acte sexuel explicite|rapport sexuel explicite)\b/,
  /\b(fella?tion|cunniling|sodomi|masturb|ejacul|orgasme|penetration|penetr[ea]|gorge profonde|levrette|fisting|gangbang|bukkake|creampie)\b/,
  /\b(bite|penis|verge|chatte|vagin|clitoris|teton|nichon|seins nus|nichons|couilles|testicule|anus|penetrer)\b.{0,40}\b(suce|lech|branl|carr|baise|encul|defonc|petrir)\b/,
  /\b(baiser|baise|baisee|niquer|nique|enculer|encule|suce ma|suce sa|branler|branle|se doigter)\b/,
  /\b(blowjob|handjob|cumshot|deepthroat|creampie|bdsm|dildo|anal sex|oral sex|make love to|sexual roleplay|erotic (story|roleplay|scene)|explicit sex)\b/,
  /\b(nudes?|photo de cul|photo nue|montre moi tes|dick pic)\b/,
];

// ───────────── Armes réelles : fabrication / obtention ─────────────
// Explosifs sans ambiguïté (le bloc « TNT » de Minecraft n'y figure pas).
const EXPLOSIFS = /\b(nitroglyc[ée]?rine|semtex|tatp|peroxyde d acetone|c ?4|cocktail molotov|molotov|poudre a canon|poudre noire|detonateur|amorce explosive|charge explosive|ceinture explosive|voiture piegee|bombe artisanale|ied)\b/;
// Verbes de fabrication / obtention (radicaux : pas de \b final, « fabriqu » doit couvrir « fabriquer »).
const VERBE_FAB = /\b(fabriqu|fabric|construi|assembl|monter un|faire (un|une|du|de la|de l|des)|cree?r? (un|une|de)|synthetis|imprim|3d print|how to (make|build|craft)|build a|make a|poser une|amorc|detonn|faire exploser)/;
// Verbes d'acquisition illégale.
const VERBE_ACQ = /\b(achet|obtenir|obtien|procurer|se procurer|trouver (un|une|des)|ou acheter|buy |acquire|get a |where to (buy|get)|au marche noir|sans licence|sans autorisation|illegal)/;
// Objets « arme à feu » (réels).
const ARME_FEU = /\b(arme a feu|armes a feu|pistolet|revolver|fusil(?! a eau| a billes| a pompe a eau)|carabine|kalachnikov|kalash|ak ?47|ar ?15|m16|glock|uzi|silencieux|lance ?roquette|grenade|munition|cartouche|balle reelle|firearm|handgun|shotgun|assault rifle|ghost gun)\b/;

export function categoriserMessage(texteBrut: string): Verdict {
  if (!texteBrut || !texteBrut.trim()) return { categorie: null };
  const t = normaliser(texteBrut);

  for (const re of MINEUR) if (re.test(t)) return { categorie: "mineur", motif: re.source };

  if (!contexteEducatif(t)) {
    for (const re of SEXUEL) if (re.test(t)) return { categorie: "sexuel", motif: re.source };
  }

  // Armes : jamais dans un contexte de jeu (mods Minecraft), seulement pour des armes réelles.
  if (!contexteJeu(t)) {
    if (EXPLOSIFS.test(t) && (VERBE_FAB.test(t) || VERBE_ACQ.test(t) || /\b(bombe|explosif)\b/.test(t))) return { categorie: "armes", motif: "explosif" };
    if (/\b(bombe|pipe bomb|bomb)\b/.test(t) && VERBE_FAB.test(t)) return { categorie: "armes", motif: "bombe" };
    if (ARME_FEU.test(t) && (VERBE_FAB.test(t) || VERBE_ACQ.test(t))) return { categorie: "armes", motif: "arme a feu" };
  }

  return { categorie: null };
}

/** Message montré à l'utilisateur selon la catégorie. */
export function messageRefus(c: Categorie): string {
  switch (c) {
    case "sexuel":
      return "Ce message a été bloqué : le contenu sexuel explicite n'est pas autorisé sur ce service.";
    case "armes":
      return "Ce message a été bloqué : les demandes liées à la fabrication ou à l'obtention d'armes réelles ne sont pas autorisées.";
    case "mineur":
      return "Ce service est réservé aux personnes majeures. Votre accès a été bloqué.";
  }
}
