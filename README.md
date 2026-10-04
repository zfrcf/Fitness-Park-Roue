# Chat IA

Application de chat IA **personnelle, mono-utilisateur**, déployée sur Vercel. Elle enchaîne
automatiquement plusieurs fournisseurs compatibles OpenAI (Groq, Cloudflare Workers AI,
OpenRouter, …) : dès que l'un est à court de quota ou en panne, la réponse continue chez le
suivant, sans action de votre part.

- Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · shadcn/ui
- Vercel AI SDK 7 pour le streaming
- Postgres (Neon) pour l'historique · Redis (Upstash) pour l'état des fournisseurs
- Interface, README et messages en français

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Démarrage local](#démarrage-local)
3. [Variables d'environnement](#variables-denvironnement)
4. [Ajouter un fournisseur](#ajouter-un-fournisseur)
5. [Déploiement sur Vercel](#déploiement-sur-vercel)
6. [Stockage : Neon et Upstash, clic par clic](#stockage--neon-et-upstash-clic-par-clic)
7. [Comment fonctionne la rotation](#comment-fonctionne-la-rotation)
8. [Lecture des liens](#lecture-des-liens)
9. [Sécurité](#sécurité)
10. [Tests](#tests)
11. [Limites connues des offres gratuites](#limites-connues-des-offres-gratuites)
12. [Dépannage](#dépannage)

## Fonctionnalités

- **Chat en streaming** avec arrêt (Échap), régénération, édition d'un message, copie.
- **Markdown** complet (tableaux, listes, liens) et **blocs de code colorés** avec bouton copier.
- **Historique** en Postgres : renommer, supprimer, rechercher (titres et contenu), exporter
  une conversation (Markdown ou JSON) ou tout l'historique (JSON).
- **Réglages** persistants : prompt système, température, longueur maximale, raisonnement.
- **Rotation automatique** des fournisseurs (429, 402, 401, 5xx, délai dépassé, coupure) avec
  reprise exacte en plein flux, résumé automatique de l'historique si le contexte du suivant
  est plus court, mémoire des épuisements et de l'heure de réessai.
- **Lecture des liens** côté serveur (HTML, PDF, pages JavaScript via Jina Reader), avec
  pastilles « page lue » cliquables.
- **Page « État »** : chaque fournisseur, son quota connu, son heure de réessai, un bouton de
  test, et la dépense du mois pour un éventuel fournisseur payant.
- **Sous chaque réponse** : fournisseur, modèle, tokens consommés, durée, bascules.
- **Accès privé** : mot de passe, cookie signé, limite de tentatives, API protégée.
- Thème clair / sombre / système, barre latérale repliable, responsive mobile, raccourcis
  clavier (⌘K recherche, ⌘B barre latérale, ⌘⇧O nouvelle conversation, ⌘, réglages, `/` saisie).

## Démarrage local

Prérequis : Node.js 22 ou plus récent.

```bash
npm install
cp .env.example .env.local      # puis remplissez les valeurs (voir ci-dessous)
npm run dev                     # http://localhost:3000
```

Sans `DATABASE_URL`, une base **PGlite** (Postgres embarqué) est créée dans `./data/pglite` ;
sans variables Upstash, l'état des fournisseurs reste en mémoire. Tout fonctionne donc en local
sans créer de compte supplémentaire.

Scripts utiles :

| Commande | Rôle |
|---|---|
| `npm run dev` | serveur de développement |
| `npm run build` puis `npm start` | build et serveur de production |
| `npm test` | tests unitaires et tests de rotation (vitest) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |

## Variables d'environnement

Le fichier `.env.example` est commenté ligne par ligne. Résumé :

| Variable | Obligatoire | Rôle |
|---|---|---|
| `APP_PASSWORD` | oui | mot de passe de connexion |
| `SESSION_SECRET` | recommandé | secret aléatoire (32+ caractères) qui signe le cookie de session |
| `PROVIDER_n_NAME` | oui | nom affiché du fournisseur de rang *n* |
| `PROVIDER_n_BASE_URL` | oui | base de l'API compatible OpenAI (sans `/chat/completions`) |
| `PROVIDER_n_API_KEY` | oui | clé API |
| `PROVIDER_n_MODEL` | oui | identifiant du modèle |
| `PROVIDER_n_CONTEXT` | oui | fenêtre de contexte du modèle, en tokens |
| `PROVIDER_n_PAID` | non | `true` pour un fournisseur payant à l'usage (toujours en dernier) |
| `PROVIDER_n_PRICE_INPUT` / `_OUTPUT` | non | prix USD par million de tokens, pour estimer la dépense si l'API ne la renvoie pas |
| `PAID_MONTHLY_CAP` | non | plafond mensuel en USD pour les fournisseurs payants (`0` = jamais) |
| `DATABASE_URL` | en production | Postgres (injectée par l'intégration Neon) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | recommandé en production | Redis (injectées par l'intégration Upstash) |
| `JINA_API_KEY` | non | clé Jina Reader (sans clé : 20 lectures/min ; avec : 500/min) |
| `APP_URL` | non | URL publique, envoyée à OpenRouter dans `HTTP-Referer` |

Les clés API ne vont **que** dans `.env.local` (ignoré par git) et dans les variables
d'environnement de Vercel. Elles ne sont jamais envoyées au navigateur.

Les rangs sont lus dans l'ordre `1, 2, 3, …` et s'arrêtent au premier rang absent. Un rang
incomplet (variable manquante ou `BASE_URL` contenant encore un espace réservé comme
`VOTRE_ACCOUNT_ID`) est ignoré avec un avertissement dans les journaux.

Configuration validée au 4 octobre 2026 (modèles Qwen gratuits) :

| Rang | Fournisseur | Base URL | Modèle | Contexte |
|---|---|---|---|---|
| 1 | Groq | `https://api.groq.com/openai/v1` | `qwen/qwen3.8-27b` | 131 072 |
| 2 | Cloudflare | `https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1` | `@cf/qwen/qwen3.8-27b` | 262 144 |
| 3 | OpenRouter | `https://openrouter.ai/api/v1` | `qwen/qwen3.8-27b:free` | 262 144 |

**Trouver son Account ID Cloudflare** : connectez-vous sur dash.cloudflare.com, ouvrez votre
compte puis « Compute & AI » (ou « Workers & Pages ») : l'Account ID (32 caractères hexadécimaux)
est affiché dans la colonne de droite, avec un bouton copier. Il figure aussi dans l'URL,
juste après `dash.cloudflare.com/`.

## Ajouter un fournisseur

1. Prenez le prochain numéro libre, par exemple `4`.
2. Ajoutez `PROVIDER_4_NAME`, `PROVIDER_4_BASE_URL`, `PROVIDER_4_API_KEY`, `PROVIDER_4_MODEL`
   et `PROVIDER_4_CONTEXT` dans `.env.local` (et dans Vercel, voir plus bas).
3. Pour un fournisseur payant à l'usage, ajoutez `PROVIDER_4_PAID=true` et donnez une valeur
   à `PAID_MONTHLY_CAP` (par exemple `5` pour 5 $ par mois). Sans plafond, il n'est jamais appelé.
4. Redémarrez `npm run dev` (ou redéployez), puis ouvrez la page **État** et cliquez sur
   **Tester** : un appel réel vérifie la clé, le modèle et l'URL.

Pour choisir un modèle, interrogez `GET <BASE_URL>/models` avec la clé :

```bash
curl -s -H "Authorization: Bearer $CLE" https://openrouter.ai/api/v1/models | jq '.data[] | select(.pricing.prompt=="0") | {id, context_length}'
```

Particularités gérées automatiquement selon l'hôte de `BASE_URL` : désactivation du raisonnement
(`reasoning_effort` chez Groq et Cloudflare, `reasoning.enabled` chez OpenRouter), `max_tokens`
explicite chez Cloudflare (dont la valeur par défaut est très basse), en-têtes `HTTP-Referer` et
`X-Title` chez OpenRouter. Tout autre hôte est traité comme une API OpenAI standard.

## Déploiement sur Vercel

Le projet est prévu pour le runtime **Node.js + Fluid Compute** (par défaut sur Vercel) ; la
route de chat déclare `maxDuration = 300`, le maximum du plan Hobby (800 s en Pro). Le runtime
Edge n'est plus pris en charge par Next.js 16.3 et n'est donc pas utilisé.

1. **Importer le dépôt** : sur vercel.com, « Add New… » → « Project » → choisissez ce dépôt
   GitHub. Le framework **Next.js** est détecté. (Le projet `fitness-park-roue` est déjà relié.)
2. **Variables d'environnement** : « Settings » → « Environment Variables » → ajoutez chaque
   variable de la section précédente pour *Production* et *Preview*. Cochez **Sensitive** pour
   les clés et le mot de passe : elles sont chiffrées et ne sont plus lisibles ensuite.
3. **Stockage** : créez Neon et Upstash via le Marketplace (section suivante) : leurs variables
   sont injectées automatiquement.
4. **Déployer** : chaque `git push` sur `main` déclenche un déploiement de production.
   Après l'ajout de variables, relancez un déploiement (« Deployments » → « ⋯ » → « Redeploy »).
5. **Protection Vercel** : si « Vercel Authentication » est active pour la production dans
   « Settings » → « Deployment Protection », l'application demandera *en plus* une connexion
   Vercel. Le chat ayant son propre mot de passe, vous pouvez limiter cette protection aux
   déploiements de prévisualisation.

Rappel : le plan Hobby de Vercel est réservé à un usage non commercial.

## Stockage : Neon et Upstash, clic par clic

Vercel KV et Vercel Postgres n'existent plus : ils sont remplacés par **Upstash Redis** et
**Neon Postgres**, disponibles gratuitement via le Marketplace Vercel.

**Neon (Postgres, historique des conversations)**

1. Tableau de bord Vercel → onglet **Storage** (en haut) → **Create Database**.
2. Choisissez **Neon** → **Continue**. Acceptez les conditions.
3. Région : choisissez l'Europe (par exemple Francfort) → plan **Free** → **Continue**.
4. Nom de la base, par exemple `chat-ia` → **Create**.
5. Sur la page de la base, onglet **Projects** → **Connect Project** → sélectionnez
   `fitness-park-roue`, cochez *Production*, *Preview* et *Development* → **Connect**.
   La variable `DATABASE_URL` (et des variantes `POSTGRES_*`) sont ajoutées au projet.
6. Redéployez. Les tables sont créées automatiquement au premier accès.

**Upstash (Redis, état des fournisseurs et limite de tentatives)**

1. **Storage** → **Create Database** → **Upstash** → **Continue**.
2. Type **Redis**, région proche de vos fonctions (Europe) → plan **Free** → nom → **Create**.
3. Onglet **Projects** → **Connect Project** → `fitness-park-roue` → **Connect**.
   Les variables `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` sont ajoutées.
4. Redéployez.

Limites gratuites (octobre 2026) : Neon 1 Go et 100 heures de calcul par mois, mise en veille
après 5 minutes d'inactivité (première requête un peu plus lente) ; Upstash 500 000 commandes
par mois et 256 Mo. Largement suffisant pour un usage personnel.

Pour développer en local avec ces bases, copiez les valeurs depuis « Settings » →
« Environment Variables » dans `.env.local`, ou utilisez `vercel env pull .env.local` avec la
CLI Vercel.

## Comment fonctionne la rotation

- **Ordre** : les fournisseurs gratuits par rang, puis les payants. Une conversation reste sur le
  fournisseur qui lui a répondu tant qu'il répond ; une nouvelle conversation repart du meilleur
  disponible.
- **Bascule** sur 429 (limite de débit ou quota), 402 (crédits), 401/403 (clé refusée), 5xx,
  408, réseau, ou 60 s sans aucun octet reçu. Tout l'historique est renvoyé au suivant.
- **Coupure en plein flux** : le texte déjà affiché est conservé ; le suivant reçoit ce texte et
  l'instruction de continuer exactement à la suite (le chevauchement éventuel est supprimé). Si
  cette reprise échoue à son tour, la réponse est régénérée entièrement par le suivant.
- **Mémoire** : chaque épuisement est stocké en Redis avec l'heure de réessai, calculée depuis
  `Retry-After`, `x-ratelimit-reset-*` (format Groq `2m59.56s`), le message d'erreur
  (« try again in 9m38s »), ou minuit UTC pour les quotas journaliers (OpenRouter, Cloudflare
  code 3036). Le fournisseur redevient utilisable automatiquement à cette heure.
- **Contexte plus court** chez le suivant : les anciens messages sont **résumés** (par le modèle,
  résumé mis en cache) et le résumé est ajouté au prompt système ; les messages récents sont
  conservés intacts. Si un fournisseur renvoie malgré tout « contexte trop long », la fenêtre est
  recalibrée et la requête rejouée.
- **Requête trop grande pour la fenêtre de débit** (Groq limite à 7 000 tokens d'entrée par
  minute) : bascule vers un fournisseur capable de prendre la requête entière ; s'il n'y en a
  pas, résumé puis nouvel essai sur place.
- **Tout épuisé** : message clair avec le prochain fournisseur disponible et son heure de réessai.

Les mêmes réglages (prompt système, température, longueur, raisonnement) sont envoyés à tous.

## Lecture des liens

Toute URL `http(s)` dans un message (5 au plus) est lue côté serveur avant la réponse :

1. téléchargement direct (8 Mo et 20 s au plus), **Readability** puis conversion en Markdown ;
   PDF : extraction du texte ; texte brut et JSON pris en charge ;
2. si la page est vide ou rendue en JavaScript, ou si le site refuse : **Jina Reader**
   (`https://r.jina.ai/<url>`) ;
3. sinon : la page est marquée « non lue » avec la raison, et l'assistant propose de coller le texte.

Les pages longues sont réduites (titres et premières phrases) puis condensées par tranches via
les fournisseurs, avec un nombre d'appels borné pour ménager les quotas. Le contenu condensé est
conservé avec la réponse et réinjecté dans le contexte des tours suivants. Les pages lues sont
mises en cache 24 h.

## Sécurité

- **Accès** : toutes les pages et toutes les routes `/api/*` exigent un cookie de session signé
  (HMAC-SHA256, `httpOnly`, `Secure` en production, 30 jours). Cinq échecs de connexion par
  adresse IP bloquent les tentatives pendant 15 minutes.
- **Clés API** : lues côté serveur uniquement ; la page État n'expose jamais les clés.
- **Anti-SSRF** : seuls `http`/`https` sur les ports standard sont acceptés ; hôtes locaux
  (`localhost`, `.local`, `.internal`), adresses IP privées, de bouclage, de lien local et de
  métadonnées cloud sont refusés, après résolution DNS ; chaque redirection est revalidée.
  Limite : la connexion n'est pas épinglée sur l'adresse résolue (une réponse DNS qui changerait
  entre la vérification et la connexion n'est pas détectée).
- Aucune limite applicative sur le nombre ou la longueur des messages ; seules les limites des
  fournisseurs s'appliquent.

## Tests

```bash
npm test
```

- `src/lib/fournisseurs/*.test.ts` : lecture des en-têtes de quota, registre, classification des erreurs.
- `src/lib/chat/orchestrateur.test.ts` : **rotation** contre un faux serveur compatible OpenAI
  (`src/lib/chat/faux-serveur.ts`) : 429 avec `Retry-After`, 402, 401, 500, quotas journaliers
  OpenRouter et Cloudflare, coupure en plein flux (chunk d'erreur et coupure de connexion),
  fournisseur muet, régénération après échec de reprise, mémoire des épuisements et retour
  automatique, fournisseur de la conversation, payant plafonné, résumé de contexte, contexte
  trop long, requête trop grande.
- `src/lib/chat/contexte.test.ts` : ajustement au contexte et résumé par tranches.
- `src/lib/liens/*.test.ts` : détection d'URL, anti-SSRF, lecture (HTML, texte, redirection,
  404, taille, délai, Jina), condensation.
- `src/lib/db/*.test.ts`, `src/lib/depenses.test.ts` : historique, réglages et dépenses sur PGlite.

Pour simuler un 429 sur un fournisseur réel, remplacez temporairement sa clé par une valeur
invalide (401) ou attendez son quota : la page État et la bascule se comportent de la même façon.

## Limites connues des offres gratuites

| Fournisseur | Limite gratuite observée | Conséquence |
|---|---|---|
| Groq, `qwen/qwen3.8-27b` | 30 req/min, 1 000 req/jour, 8 000 tokens/min, 7 000 tokens d'entrée par requête et par minute | les conversations longues ou les pages lues passent vite au fournisseur suivant |
| Cloudflare Workers AI | 10 000 neurons/jour, 300 req/min ; `qwen3.8-27b` coûte environ 0,45 $ d'entrée et 3,20 $ de sortie par million de tokens en neurons | environ 240 000 tokens d'entrée par jour ; pas d'en-tête de quota restant, l'épuisement est détecté au code 3036 |
| OpenRouter, `:free` | 20 req/min, 50 req/jour (1 000 si 10 $ de crédits achetés) | réserve de fin de journée |
| Jina Reader sans clé | 20 lectures/min | suffisant pour un usage personnel |

## Dépannage

- **« Tous les fournisseurs sont épuisés »** : ouvrez la page État ; l'heure de réessai est
  indiquée. « Réinitialiser » force un nouvel essai immédiat.
- **La barre latérale affiche « Historique indisponible »** : `DATABASE_URL` est absente sur
  Vercel. Connectez Neon (section Stockage) puis redéployez. Le chat fonctionne malgré tout, sans
  sauvegarde.
- **Un fournisseur n'apparaît pas sur la page État** : une de ses variables manque ou sa
  `BASE_URL` contient encore `VOTRE_ACCOUNT_ID`. Les journaux Vercel indiquent lequel.
- **Réponse coupée après 5 minutes** : limite `maxDuration` du plan Hobby (300 s).
- **Page non lue** : le site bloque les robots ou exige JavaScript et Jina a échoué ; collez le
  texte dans le message.
