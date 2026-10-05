# Rapport de session — nuit du 04→05/10/2026

## Résumé en 5 lignes
Nuit de travail autonome sur la branche `nuit/2026-10-05`. Modèle Minecraft Fabric vérifié par
compilation réelle, puis traitement du backlog d'audit de 47 points. Toutes les failles
fonctionnelles (hautes et moyennes) et 10 des 11 basses sont corrigées, chacune avec tests, lint
et typecheck verts, un commit par correctif. 175 tests passent. Rien n'est déployé : le push/build
Vercel reste prévu pour aujourd'hui quand le quota se libère (déclencheur planifié).

## Tâches terminées (findings d'audit)
Chaque point ci-dessous = un commit poussé sur `nuit/2026-10-05`.

### Hautes
- **#5** verrou de tranche atomique (KV incr) + Pause/Arrêter respectés pendant la génération — `moteur.ts`
- **#6/#8** réponse vide/tronquée jamais prise pour complète ; persistance NUL robuste (déjà faits plus tôt)
- **#9** suivi GitHub tolérant aux erreurs passagères (déjà fait plus tôt)
- **#10** ne recompile pas un projet inchangé ; plafond 2 M tokens/tâche (déjà fait plus tôt)
- **#12/#13/#14** classification 429, estDegenere, budget de contexte (déjà faits plus tôt)
- **#18** suivi de tâche en direct par `tacheId` ; la tâche lit toute la conversation (déjà fait)
- **#20** branches `compilation/*` ne déclenchent plus de déploiement Vercel (déjà fait)
- **#24** version Minecraft lue dans le projet (pas le journal d'erreurs) + contexte au tour de clarification

### Moyennes
- **#7** relance différée hors du budget de la fonction mourante (attente portée par `repriseA`)
- **#11** reprise après coupure : redemande les fichiers complets (plus de fichier tronqué)
- **#15** un 400 propre à un fournisseur (param non supporté, modèle retiré) bascule
- **#16** réponse vide/blanche jamais un succès, même sans usage de sortie
- **#17** délai max sur le résumé de contexte + timeout classé « temporaire »
- **#19** défilement auto stable + bouton « Aller en bas » au-dessus de la saisie
- **#21** envoi GitHub en un seul arbre (contenu en ligne) + message 403 limite de débit
- **#22** URL dans un bloc de code (journal Gradle) non lues comme des liens
- **#23** régénération : texte d'avant le marqueur ignoré, pastilles conservées
- **#25/#26** contexte Minecraft : repli honnête non figé 6 h, Java par version, NeoForge sans modèle Fabric
- **#27** supprimer une conversation arrête sa tâche (plus de boucle de quota)
- **#28** panne du cache KV pendant la lecture de liens n'échoue plus toute la réponse
- **#38** extraction : titres numérotés, « **Fichier :** », annotations, fences imbriquées
- **#39** panneau projet visible même quand la dernière réponse n'a aucun fichier

### Basses
- **#29** quota journalier : délai explicite du message prioritaire sur minuit UTC
- **#30** borne de rotation 2×(fournisseurs)+2
- **#31** `reasoning_content` conservé pour NVIDIA/Kimi K3
- **#32** instruction recherche_web seulement quand l'outil est offert
- **#33** neutralisation des délimiteurs du contenu web + avertissement données non fiables
- **#34** verrou KV atomique (EXPIRE … NX) : plus de verrou permanent
- **#35** sessions révocables en changeant APP_PASSWORD
- **#36** erreur HTTP affichée en texte lisible (plus de JSON brut)
- **#37** sérialisation KV explicite (Upstash) : plus de « [object Object] »/cache manqué
- **#41** compteur « contexte ≈ N tokens » inclut pages lues et projet
- **#42** `maxCycles` compte les corrections (avec 1, une correction est tentée)
- **#43** ordre des messages déterministe (sous-requête + tri (ordre, creeA, id))
- **#44** validation de chemins (.git/, segments vides, « . ») + artefact expiré géré
- **#45** salutation sans décalage d'hydratation (heure locale)
- **#46** matcher du proxy : l'exemption par extension ne s'applique plus sous /api/

## Tâches partielles ou reportées
- **#47 (tests, reporté)** Hermétisme : la résolution DNS réelle via le garde anti-SSRF rend
  `recherche`/`lecture` dépendants du réseau ; l'injecter toucherait le chemin de sécurité pour un
  gain marginal. Horloge réelle dans `orchestrateur.test.ts` et absence de test de `tour.ts` :
  polissage d'infrastructure, sans impact fonctionnel. À reprendre à tête reposée.
- **#41 (partiel)** Le throttle du rendu par token (re-rendu de tous les messages à chaque delta)
  n'est pas fait : chemin de rendu critique, optimisation seule. Le compteur de tokens est corrigé.
- **#43 (partiel)** L'export complet en 1+2N requêtes séquentielles n'est pas optimisé : perf seule.
  La partie correctness (ordre déterministe) est faite.
- **#35 (partiel)** Renouvellement glissant du jeton et redirection 401 côté client non faits :
  la révocation (le cœur de la faille) est faite.

## Décisions prises à ta place (voir DECISIONS.md pour le détail)
1. Verrou de tranche : KV `incr` atomique plutôt qu'un refactor avec colonne `trancheId` (plus simple, réversible).
2. #15 : bascule uniquement sur les 400 « propres au fournisseur » (regex), pas sur tout 400 (évite de gaspiller tous les fournisseurs sur une requête malformée).
3. #37 : désactivation de la (dé)sérialisation Upstash + JSON manuel, compatible avec les données déjà stockées.
4. #35 : la clé de session est liée au mot de passe (révocation), au prix d'une reconnexion unique après déploiement.
5. #47 et quelques sous-parties perf reportés plutôt que bâclés (voir ci-dessus).

## Actions qui t'attendent
- **Déploiement (non exécuté, comme demandé)** : fusionner `nuit/2026-10-05` dans la branche par
  défaut puis déployer sur Vercel quand le quota 100/24 h est libéré. Un déclencheur planifié est
  prévu à cet effet ; sinon, le faire manuellement.
- **Reconnexion** : après déploiement, la session en cours devra se reconnecter une fois (#35).
- **Vérifications recommandées avant fusion** : `npm run lint`, `npx tsc --noEmit`, `npx vitest run`
  (tous verts au moment du rapport : 175 tests), puis une relecture rapide du diff de `moteur.ts`
  (verrou + pause) et de `kv.ts` (sérialisation).
- **À reprendre** : #47 (tests hermétiques) et les sous-parties perf reportées.
