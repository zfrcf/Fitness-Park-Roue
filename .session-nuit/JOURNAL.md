# Journal de la nuit du 05/10/2026 (heures de Paris)

- 04:35 — Démarrage. Branche `nuit/2026-10-05` créée depuis `claude/chat-ia` (= `main` 23102ca). Plan écrit.
- 04:59 — Limiteur de débit partagé par fournisseur (KV, requêtes/min) : commit b06a53b. Audit (workflow) et vérification du modèle Fabric (workflow) en cours.
- 05:02 — Ménage des branches compilation/* orphelines (réveil, verrou KV 30 min) : commit eb315f5.
- 05:05 — Bandeau « lancer en tâche de fond » quand le message demande un travail long : commit 1e913d7.
- 05:06 — Page État : débit/min, limites apprises, badge « tâche en cours » : commit 29e697c.
- 05:09 — Vérif locale (Playwright) : page État affiche débit/limites ; bandeau « lancer en tâche de fond » OK (NVIDIA Kimi K3 répond). Dev arrêté.
- 05:13 — Modèle Fabric vérifié par compilation réelle sur GitHub Actions (JDK 25, Gradle 9.7.1) : 26.3 (plugin fabric-loom, aucune ligne mappings, run 37257906221) et 1.21.11 (plugin fabric-loom-remap, mappings Mojang, release 21 sous JDK 25, run 37258299909), les deux BUILD SUCCESSFUL avec jar. Modèle conditionnel par génération + 9 tests vitest ; lint/tsc/vitest verts (130 tests). Commit sur nuit/2026-10-05 (non poussé).
- 05:15 — Workflow modèle Fabric TERMINÉ : commit f60913a (26.x sans mappings / 1.21.x avec remap+mappings), 2 builds réels verts, 130 tests. README à jour. Audit en cours.
- 05:46 — Check-in : audit en phase « Vérifier » (9 explorations faites). Attente du backlog pour appliquer les correctifs. Tree propre, 11 commits poussés.
- 06:20 — CLAUDE.md ajouté (architecture/conventions). Audit toujours en vérification (29 agents). Attente de la complétion.
- 08:14 — BUG utilisateur « chemin réservé .github/workflows/build.yml » : retrait silencieux des chemins réservés (validation + creerBranche, 2 points d'entrée) + plafond 2 M tokens/tâche. commit 5a17cc2. 133 tests.
- 08:20 — DEMANDE utilisateur : mode automatique des tâches (corriger jusqu'au jar sans limite, borné par 2 M tokens). DB+API+moteur+UI+chat. commit 874eb0c. 134 tests. Migration PGlite OK.
