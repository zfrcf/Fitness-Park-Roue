# Plan de la nuit du 05/10/2026

Objectif donné : « Travaille toute la nuit sur le site / l'IA / les bugs, puis demain lance le push et le build Vercel. »

Contraintes : aucun déploiement cette nuit (quota Vercel épuisé jusqu'à ~23:03 Paris ; déploiement programmé
à 23:15 par un rappel automatique), tout reste gratuit, aucune action irréversible.

## Priorités (valeur d'abord)

1. **Audit complet du code** (workflow multi-agents, vérification contradictoire) → correction des bugs confirmés,
   un commit par correction, tests à chaque fois.
2. **Modèle de mod Minecraft vérifié par compilation réelle** (GitHub Actions) pour la version courante (26.3) :
   la règle « mappings » est fausse depuis 26.x (jeu non obfusqué → aucune ligne mappings), le modèle a dû
   le découvrir seul dans la dernière conversation. Boucle : générer → pousser → lire le journal → corriger
   le modèle de projet jusqu'au build vert ; vérifier aussi 1.21.11.
3. **Limiteur de débit partagé par fournisseur** (NVIDIA : 40 req/min) pour que plusieurs tâches en parallèle
   ne se fassent pas rejeter en cascade.
4. **Chat qui continue si l'onglet se ferme** (la génération se poursuit côté serveur, bouton Stop via un
   signal, reprise de l'affichage à la réouverture).
5. **Nettoyage des branches `compilation/*` orphelines** sur GitHub depuis l'application (réveil périodique).
6. **Page État** : limites apprises (ITPM/OTPM), fournisseurs occupés par une tâche.
7. **Depuis le chat** : proposer de basculer en tâche de fond quand l'utilisateur écrit « travaille jusqu'à… ».
8. Robustesse, tests, documentation ; rapport final.
