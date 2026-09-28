# Téléchargeur YouTube

Site web qui télécharge une vidéo YouTube à partir de son lien, y compris les
replays de directs de plusieurs heures. Interface en français, déployé sur Vercel.

## Liens acceptés

`youtube.com/watch?v=…`, `youtu.be/…`, `youtube.com/live/…`, `/shorts/…`,
`/embed/…`, `/v/…`, `music.youtube.com`, `m.youtube.com`, `youtube-nocookie.com`,
ainsi qu'un identifiant nu. Les paramètres superflus (`si=`, `t=`, `list=`) sont ignorés.

## Fonctionnement

- `api/info.js` : résout le lien, interroge YouTube (bibliothèque `youtubei.js`) en
  essayant plusieurs clients à la suite (iOS, web mobile, web, Android, TV) et renvoie
  la liste des flux.
- `api/download.js` : relaie le flux vers le navigateur avec prise en charge des
  requêtes `Range`. Chaque invocation résout une URL fraîche, car les URL de
  YouTube sont liées à l'adresse IP qui les demande.
- `public/index.html` : interface. Sur Chrome et Edge, le fichier est écrit sur le
  disque par morceaux de 48 Mo téléchargés 4 par 4 (rapide, sans limite de durée,
  reprise automatique). Sur les autres navigateurs, téléchargement en flux continu.

Les qualités « Vidéo + son » sont les fichiers complets (360p, parfois 720p).
Au-dessus, YouTube fournit vidéo et audio en pistes séparées, à assembler
ensuite (VLC, ffmpeg).

## Anti-robot YouTube (important)

Depuis une IP de datacenter, YouTube répond « Sign in to confirm you're not a
bot » pour la plupart des vidéos. Le serveur applique déjà deux parades :

1. génération automatique d'un jeton « Proof of Origin » (BotGuard, via
   `bgutils-js` et un DOM simulé `jsdom`), lié au `visitorData`, mis en cache
   6 h dans `/tmp` (moins d'une seconde à produire) ;
2. chaîne de clients de repli (web mobile, iOS, Android, TV, web) et
   régénération de la session en cas de refus.

Cela suffit depuis certaines IP, mais **pas depuis les IP AWS de Vercel** : lors
des tests, tous les clients répondaient « connexion requise » pour le lien de
test (`/live/Jr_EcIG_gAM`), alors qu'une vidéo très populaire passait. La
solution fiable est de donner au serveur une session YouTube connectée via la
variable `YT_COOKIES`.

### Configurer `YT_COOKIES` (une fois)

1. Dans un navigateur, ouvre une **fenêtre de navigation privée**, connecte-toi à
   youtube.com (de préférence avec un compte secondaire : YouTube peut
   restreindre un compte utilisé pour du téléchargement massif).
2. Exporte les cookies du site youtube.com avec une extension du type
   « Get cookies.txt LOCALLY » (format Netscape) ou copie l'en-tête `Cookie`
   d'une requête vers youtube.com dans les outils de développement.
3. Ferme la fenêtre privée **sans te déconnecter** (une déconnexion invalide
   les cookies).
4. Sur Vercel : projet `telechargeur-youtube` → Settings → Environment
   Variables → ajoute `YT_COOKIES` (type Sensitive, environnement Production)
   et colle le contenu du fichier cookies.txt ou la chaîne `a=b; c=d`.
5. Redéploie (Deployments → ⋯ → Redeploy). Les deux formats sont acceptés.

## Développement local

```bash
npm install
npm run dev            # http://localhost:3000
npm test               # tests hors ligne (extraction des identifiants)
node test/smoke.js --online   # nécessite le serveur de dev lancé
```

## Déploiement Vercel

Projet Vercel avec `Root Directory` = `youtube-downloader`, sans framework ni
commande de build. `vercel.json` fixe la région `cdg1` (Paris) et une durée
maximale de 300 s par fonction.
