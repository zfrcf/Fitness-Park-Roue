# Bot de vérification Discord (Minecraft)

## Installation
1. Crée un bot sur https://discord.com/developers/applications → copie le token, active **Server Members Intent**.
2. Sur ton serveur : salon staff → Paramètres → Intégrations → Webhooks → copie l'URL.
3. Remplis `.env` (token, URL webhook, GUILD_ID = ID de ton serveur pour une sync instantanée).
4. `pip install -r requirements.txt` puis `python bot.py`.
5. Dans Discord : `/verif` dans le salon voulu.

## Fonctionnement
- `/verif` affiche un embed + bouton vert **Vérification**.
- Étape 1 : formulaire pseudo Minecraft + email → envoyé au webhook staff avec un code à 6 caractères.
- Le staff envoie le code au joueur par email.
- Étape 2 : le joueur clique sur **Vérification** et saisit le code.
- Code bon → rôle `Vérifié` (créé automatiquement) + notification webhook. Configure tes salons/giveaways pour n'être visibles que par ce rôle.

## Permissions du bot
Gérer les rôles (rôle du bot au-dessus de "Vérifié"), Envoyer des messages, Utiliser des commandes slash.
