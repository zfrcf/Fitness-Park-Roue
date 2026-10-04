# Chat IA

Application de chat IA personnelle, mono-utilisateur, déployable sur Vercel.
Elle enchaîne automatiquement plusieurs fournisseurs compatibles OpenAI
(Groq, Cloudflare Workers AI, OpenRouter, …) et bascule sur le suivant dès
que l'un d'eux est à court de quota.

> Projet en construction, étape par étape. Ce README est complété à chaque étape.

## Pile technique

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4 + shadcn/ui
- Vercel AI SDK 7 pour le streaming
- Postgres (Neon) pour l'historique, Redis (Upstash) pour l'état des fournisseurs

## Démarrage local

```bash
npm install
cp .env.example .env.local   # puis renseignez les valeurs
npm run dev                  # http://localhost:3000
```

## Variables d'environnement

Voir `.env.example`, commenté ligne par ligne. Les clés API ne vont **que**
dans `.env.local` (ignoré par git) et dans les variables chiffrées de Vercel.

## Avancement

- [x] Étape 1 : squelette, thème clair/sombre, interface en français
- [x] Étape 2 : accès privé par mot de passe
- [x] Étape 3 : registre des fournisseurs et page « État »
- [x] Étape 4 : chat en streaming avec rotation automatique
- [x] Étape 5 : historique des conversations
- [x] Étape 6 : interface complète
- [ ] Étape 7 : lecture des liens
- [ ] Étape 8 : fournisseur payant plafonné
- [ ] Étape 9 : déploiement Vercel
