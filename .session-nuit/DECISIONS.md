# Décisions prises à la place de l'utilisateur

## D1 — Déploiement « demain »
Contexte : quota Vercel (100 déploiements / 24 h glissantes) épuisé ; libération à partir de ~23:03 Paris le 05/10.
Choix : aucun déploiement pendant la nuit ; le rappel automatique de 23:15 fusionne la branche de nuit dans
`main`, lance le déploiement et vérifie la production. Réversible : annuler le rappel.

## D2 — Branche de travail
Choix : `nuit/2026-10-05`, poussée régulièrement (sauvegarde), fusionnée dans `main` seulement au moment du
déploiement. Les tentatives de prévisualisation Vercel déclenchées par ces pushes sont refusées (quota) et sans effet.

## D3 — Modèle de mod Fabric : deux générations, une seule chaîne JDK 25
Contexte : la consigne « mappings Mojang pour tout mod » contredisait le template 26.x (Loom 1.18.2 refuse
`officialMojangMappings()` en environnement non obfusqué) ; la chaîne GitHub Actions n'a qu'un JDK 25.
Choix : garder la chaîne telle quelle (pas de setup-java 21) et rendre le modèle conditionnel par version :
26.x → `net.fabricmc.fabric-loom`, aucune ligne mappings, `implementation` ; 1.21.x et antérieur →
`net.fabricmc.fabric-loom-remap`, `mappings loom.officialMojangMappings()`, `modImplementation`,
`options.release = 21` compilé par le JDK 25. Vérifié par compilation réelle des deux variantes (runs
37257906221 et 26.3 ; 37258299909 et 1.21.11). Les branches `compilation/verif-mc-*` sont laissées en place
(règle : aucune suppression de branche distante). Réversible : revenir sur le commit du modèle.
