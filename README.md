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
8. [Recherche web](#recherche-web)
9. [Fichiers générés et archive .zip](#fichiers-générés-et-archive-zip)
10. [Compilation sur GitHub](#compilation-sur-github-mods-minecraft-projets-gradle)
11. [Tâches de fond](#tâches-de-fond-agents-qui-tournent-sans-vous)
12. [Lecture des liens](#lecture-des-liens)
13. [Sécurité](#sécurité)
14. [Tests](#tests)
15. [Limites connues des offres gratuites](#limites-connues-des-offres-gratuites)
16. [Dépannage](#dépannage)

## Fonctionnalités

- **Chat en streaming** avec arrêt (Échap), régénération, édition d'un message, copie.
- **Markdown** complet (tableaux, listes, liens) et **blocs de code colorés** avec bouton copier.
- **Historique** en Postgres : renommer, supprimer, rechercher (titres et contenu), exporter
  une conversation (Markdown ou JSON) ou tout l'historique (JSON).
- **Réglages** persistants : prompt système, température, longueur maximale, raisonnement,
  recherche web automatique.
- **Recherche web** : outil que le modèle déclenche lui-même, ou bouton globe pour forcer une
  recherche ; sources citées et cliquables.
- **Tâches de fond** : des agents qui tournent sur le serveur sans vous (génération → compilation → correction en boucle), plusieurs en parallèle, avec reprise automatique après un quota.
- **Fichiers générés** téléchargeables un par un ou en .zip ; **compilation des mods Minecraft**
  (projets Gradle) sur GitHub Actions avec téléchargement du .jar et renvoi des erreurs au modèle.
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
| `JINA_API_KEY` | non | clé Jina Reader (sans clé : 20 lectures/min ; avec : 500/min) et Jina Search |
| `BRAVE_API_KEY` / `TAVILY_API_KEY` | non | moteurs de recherche de secours si DuckDuckGo est bloqué |
| `GITHUB_REPO` / `GITHUB_TOKEN` | pour compiler | dépôt et jeton fin utilisés par la compilation GitHub Actions |
| `QSTASH_TOKEN` | non | jeton Upstash QStash pour relancer les tâches de fond (sinon relance interne et cron GitHub) |
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

### NVIDIA NIM (recommandé en rang 1)

Clé gratuite sur <https://build.nvidia.com/settings/api-keys> (compte NVIDIA, « Generate API Key »).
Base URL `https://integrate.api.nvidia.com/v1`. Pas de quota journalier : la seule limite est
d'environ 40 requêtes par minute, partagée entre tous les modèles. Les modèles Qwen y ont été
retirés ; le modèle retenu est **`moonshotai/kimi-k3`** (Kimi K3, fenêtre de 1 048 576 tokens,
très bon en code, appels d'outils). Particularités gérées par la famille `nvidia` :

- la réflexion se pilote par `chat_template_kwargs.thinking` ; « Aucun » la coupe, sauf quand
  des outils sont envoyés (sans réflexion, Kimi K3 ne sait pas appeler d'outil) ;
- « Moyen » et « Élevé » envoient `reasoning_effort` `high` et `max` (`low` donne parfois une
  réponse vide, il n'est pas utilisé).

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
- **Requête trop grande pour la fenêtre de débit** (Groq limite à 7 000 tokens d'entrée et
  1 000 tokens de sortie par minute) : bascule vers un fournisseur capable de prendre la requête
  entière ; s'il n'y en a pas, résumé puis nouvel essai sur place. Les limites lues dans le message
  d'erreur sont **mémorisées 24 h** : ensuite, un fournisseur dont la limite ne couvre pas la
  requête est évité d'emblée, ou utilisé avec la sortie plafonnée à sa limite s'il est le seul.
- **Réponse coupée par « Tokens max »** (`finish_reason: length`) : le même fournisseur est relancé
  automatiquement jusqu'à 4 fois pour continuer exactement à la suite (notification « suite
  automatique »).
- **Réponse vide** alors que des tokens ont été produits (le raisonnement a consommé toute la
  sortie, fréquent chez Cloudflare) : bascule immédiate vers le suivant, sans marquer le
  fournisseur indisponible.
- **Tout épuisé** : message clair avec le prochain fournisseur disponible et son heure de réessai.

Les mêmes réglages (prompt système, température, longueur, raisonnement) sont envoyés à tous.

## Recherche web

Le modèle ne connaît ni la date du jour ni ce qui est sorti après son entraînement. L'application
lui donne la date dans le prompt système et lui offre deux façons de chercher sur le web :

- **Automatique** : le modèle dispose d'un outil `recherche_web` qu'il appelle lui-même quand la
  question porte sur quelque chose de récent ou d'incertain (deux recherches par réponse au plus).
  Désactivable dans les réglages. Un fournisseur qui refuse les outils est détecté et retenté sans.
- **Forcée** : le bouton globe de la zone de saisie cherche le message tel quel avant la réponse.

Chaque recherche apparaît au-dessus de la réponse (requête, moteur, résultats cliquables) et le
modèle doit citer ses sources en liens Markdown.

Moteurs, en cascade : les moteurs à clé s'ils sont configurés (**Brave** `BRAVE_API_KEY`,
2 000 requêtes/mois gratuites ; **Tavily** `TAVILY_API_KEY`, 1 000/mois ; **Jina Search**
`JINA_API_KEY`), puis **Bing** (page HTML, sans clé, joignable depuis Vercel), **DuckDuckGo**
(page HTML, sans clé, bloque les adresses de centres de données), et enfin **Wikipédia** (sans
clé, sujets encyclopédiques seulement). Les deux premiers résultats sont lus et réduits (sans appel au modèle)
pour fournir du contenu, pas seulement des extraits. Les recherches sont mises en cache une heure.

Coût en contexte : environ 2 000 tokens par recherche. Chez Groq, dont la limite est de 7 000 tokens
d'entrée par minute, une réponse avec recherche bascule souvent vers Cloudflare : c'est normal.

## Fichiers générés et archive .zip

Quand une réponse contient des blocs de code nommés (chemin sur la ligne d'ouverture, par exemple
\`\`\`java src/main/java/com/exemple/Mod.java), un panneau « Fichiers » apparaît sous la réponse :
téléchargement de chaque fichier, ou de tout le projet en **.zip** avec son arborescence (fabriqué
dans le navigateur). Le prompt système demande au modèle ce format et des projets complets. Cela
couvre les datapacks et resource packs Minecraft, les scripts, les configurations, les sites statiques.

**État du projet.** Les fichiers de toutes les réponses d'une conversation sont fusionnés (la
version la plus récente de chaque chemin fait foi). À chaque tour, cet état complet est donné au
modèle une seule fois dans le prompt système, et les blocs de code des réponses passées sont
remplacés par des renvois : le modèle ne renvoie que les fichiers nouveaux ou modifiés, en entier,
sans jamais réécrire le reste (il peut aussi écrire « Supprimer : chemin »). Sous la dernière
réponse, le panneau montre le **projet complet** (fichiers de cette réponse marqués « modifié ») :
c'est lui qui est téléchargé en .zip et compilé.

## Compilation sur GitHub (mods Minecraft, projets Gradle)

Un `.jar` de mod ne peut pas être compilé sur Vercel (ni Java ni Gradle, 300 s maximum). La
compilation est donc confiée à **GitHub Actions**, gratuit pour un dépôt public :

1. Sous un projet Gradle généré (présence de `build.gradle`), le bouton **Compiler sur GitHub**
   pousse les fichiers sur une branche `compilation/<id>` du dépôt `GITHUB_REPO`, avec le workflow
   `.github/workflows/compiler.yml` (JDK 25, Gradle 9.7.1, `gradle build -x test`).
2. L'application suit l'exécution (file d'attente, en cours, réussie, échouée) et affiche le lien
   vers le journal GitHub. Un mod Fabric met 3 à 8 minutes.
3. Réussite : bouton **Télécharger le .jar** (l'application récupère l'artefact et le transmet,
   car les artefacts GitHub exigent une session GitHub). Échec : les erreurs de compilation sont
   extraites du journal et un bouton **Demander une correction** les renvoie au modèle, qui
   renvoie les fichiers corrigés. La branche est supprimée une fois le résultat récupéré.

Pour que le modèle produise un projet compilable, toute demande de mod Minecraft injecte un
**contexte à jour** : versions actuelles (Minecraft, Fabric Loader, Fabric API, Loom, NeoForge,
récupérées des API Fabric meta, Modrinth et Maven, cache 6 h) et un modèle de projet Fabric minimal
avec mappings Mojang, un seul source set, sans wrapper Gradle. Le wrapper (`gradlew`) est refusé à
l'envoi : la chaîne fournit Gradle.

Variables : `GITHUB_REPO` (par défaut `zfrcf/Fitness-Park-Roue`) et `GITHUB_TOKEN`, un jeton
d'accès fin créé sur github.com → Settings → Developer settings → Fine-grained tokens, limité à ce
dépôt, avec les permissions **Contents : lecture et écriture**, **Actions : lecture et écriture**
et **Metadata : lecture**. Sans jeton, le bouton renvoie une erreur explicite.

Limites : les modèles gratuits écrivent du code Minecraft imparfait ; comptez un ou deux
allers-retours de correction. Les artefacts sont conservés 14 jours. Seuls les projets Gradle
(Fabric, NeoForge, Java, Kotlin) sont compilés ; les autres fichiers se téléchargent en .zip.

## Tâches de fond (agents qui tournent sans vous)

L'onglet **Tâches** lance un travail que le serveur mène à son terme même si vous fermez le site :
décrivez l'objectif comme dans le chat, la tâche crée une conversation, obtient une réponse, envoie
le projet à GitHub, lit le journal de compilation, demande la correction au modèle, recompile… jusqu'au
`.jar` ou jusqu'au nombre maximal de corrections (8 par défaut, réglable). Sous une compilation
échouée dans le chat, **Corriger en tâche de fond** fait la même chose sur la conversation courante.

- **Parallélisme** : chaque tâche prend le premier fournisseur libre (les fournisseurs occupés par
  une autre tâche passent en fin de liste), donc deux tâches tournent par exemple sur Groq et
  Cloudflare en même temps. Le vrai plafond reste les quotas gratuits, pas le nombre de tâches.
- **Quotas** : quand tout est épuisé, la tâche passe « en attente de quota » avec l'heure de reprise
  et repart seule.
- **Mécanique** (Vercel Hobby : 300 s par fonction, pas de cron fréquent) : le travail est découpé en
  tranches d'environ 4 min 30 ; chaque tranche programme la suivante par un appel HTTP différé
  (`/api/taches/executer`, jeton interne dérivé de `SESSION_SECRET`, maintenu par `waitUntil`).
  Filet de sécurité : `.github/workflows/reveil.yml` appelle `/api/taches/reveiller` toutes les
  10 minutes (tâches dues ou tranche perdue), et la page Tâches le fait aussi à chaque affichage.
  Avec `QSTASH_TOKEN` (Upstash QStash, 1 000 messages/jour gratuits), les relances passent par
  QStash avec reprises automatiques.
- **Suivi** : statut, étape, cycle, fournisseur, tokens, journal horodaté, pause / reprise / arrêt,
  téléchargement du `.jar`, lien vers la conversation (fichiers et projet complet).

Le workflow de réveil utilise la variable de dépôt `APP_URL` si elle existe (Settings → Secrets and
variables → Actions → Variables), sinon `https://fitness-park-roue.vercel.app`.

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

« Tokens max » vaut 16 384 par défaut : chez Cloudflare le raisonnement entre dans ce budget, et
une réponse de mod complète dépasse facilement 4 096 tokens. Les réponses plus longues sont
poursuivies automatiquement (voir la rotation).

## Limites connues des offres gratuites

| Fournisseur | Limite gratuite observée | Conséquence |
|---|---|---|
| Groq, `qwen/qwen3.8-27b` | 30 req/min, 1 000 req/jour, 7 000 tokens d'entrée et **1 000 tokens de sortie** par minute | inutilisable pour générer du code long : avec « Tokens max » au-dessus de 1 000, Groq est évité dès que sa limite est connue, et ne sert qu'aux réponses courtes |
| Cloudflare Workers AI | 10 000 neurons/jour, 300 req/min ; `qwen3.8-27b` coûte environ 0,45 $ d'entrée et 3,20 $ de sortie par million de tokens en neurons ; le raisonnement est toujours actif (`reasoning_effort` low au minimum) et compte dans « Tokens max » | 6 à 8 réponses longues par jour ; l'épuisement est détecté aux codes 3036 et 4006 et levé à minuit UTC |
| NVIDIA NIM, `moonshotai/kimi-k3` | ~40 req/min, pas de quota journalier observé | fournisseur principal ; 69 000 tokens d'entrée testés sans problème |
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
