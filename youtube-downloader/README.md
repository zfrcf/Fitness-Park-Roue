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

## Variables d'environnement (optionnelles)

| Variable | Rôle |
| --- | --- |
| `YT_COOKIES` | Chaîne de cookies d'un compte YouTube connecté. À renseigner si YouTube répond « connexion requise » (détection anti-robot depuis les IP de datacenter). |
| `YT_PO_TOKEN` | Jeton « Proof of Origin » pour le client web. |
| `YT_VISITOR_DATA` | `visitorData` associé au jeton ci-dessus. |

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
