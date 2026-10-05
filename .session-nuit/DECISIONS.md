# Décisions prises à la place de l'utilisateur

## D1 — Déploiement « demain »
Contexte : quota Vercel (100 déploiements / 24 h glissantes) épuisé ; libération à partir de ~23:03 Paris le 05/10.
Choix : aucun déploiement pendant la nuit ; le rappel automatique de 23:15 fusionne la branche de nuit dans
`main`, lance le déploiement et vérifie la production. Réversible : annuler le rappel.

## D2 — Branche de travail
Choix : `nuit/2026-10-05`, poussée régulièrement (sauvegarde), fusionnée dans `main` seulement au moment du
déploiement. Les tentatives de prévisualisation Vercel déclenchées par ces pushes sont refusées (quota) et sans effet.
