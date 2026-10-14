# -*- coding: utf-8 -*-
"""
Bot Discord de vérification Minecraft.
Commande /verif : formulaire (pseudo Minecraft + email) -> webhook staff avec code,
puis saisie du code -> rôle "Vérifié" qui ouvre l'accès aux salons et giveaways.
"""

import os
import random
import string
import sys
import discord
from discord import app_commands
from discord.ext import commands
from dotenv import load_dotenv

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN")
WEBHOOK_URL = os.getenv("WEBHOOK_URL")          # Webhook du salon staff
VERIFIED_ROLE_NAME = os.getenv("VERIFIED_ROLE_NAME", "Vérifié")
GUILD_ID = int(os.getenv("GUILD_ID", "0"))      # 0 = sync globale

intents = discord.Intents.default()
intents.members = True
bot = commands.Bot(command_prefix="!", intents=intents)

# Stockage en mémoire : {user_id: {"code": str, "pseudo": str, "email": str}}
pending_codes: dict[int, dict] = {}


def generate_code(length: int = 6) -> str:
    """Génère un code aléatoire de 6 caractères (chiffres + lettres majuscules)."""
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=length))


async def send_webhook(content: str = None, embed: discord.Embed = None):
    """Envoie un message dans le salon staff via le webhook."""
    async with bot.session.post(WEBHOOK_URL, json={
        "content": content,
        "embeds": [embed.to_dict()] if embed else [],
        "username": "Vérification Bot",
    }) as resp:
        return resp.status in (200, 204)


# ---------- Étape 1 : formulaire pseudo + email ----------

class VerifModal(discord.ui.Modal, title="Vérification — Étape 1/2"):
    pseudo = discord.ui.TextInput(
        label="Pseudo Minecraft",
        placeholder="Ex : Steve_2024",
        min_length=3, max_length=16,
    )
    email = discord.ui.TextInput(
        label="Adresse email",
        placeholder="exemple@mail.com",
        min_length=5, max_length=100,
    )

    async def on_submit(self, interaction: discord.Interaction):
        code = generate_code()
        pending_codes[interaction.user.id] = {
            "code": code,
            "pseudo": str(self.pseudo),
            "email": str(self.email),
        }

        # Envoi au webhook staff : pseudo + email + code à transmettre au joueur
        embed = discord.Embed(title="📩 Nouvelle demande de vérification", color=discord.Color.orange())
        embed.add_field(name="Membre", value=f"{interaction.user.mention} (`{interaction.user.id}`)", inline=False)
        embed.add_field(name="Pseudo Minecraft", value=str(self.pseudo), inline=True)
        embed.add_field(name="Email", value=str(self.email), inline=True)
        embed.add_field(name="🔑 Code à envoyer au joueur", value=f"**{code}**", inline=False)
        embed.set_footer(text="Envoyez ce code au joueur par email, il devra le saisir à l'étape 2.")
        await send_webhook(embed=embed)

        view = CodeButtonView()
        await interaction.response.send_message(
            "✅ **Étape 1 terminée !**\n"
            "Un code de vérification va t'être envoyé par **email**.\n"
            "Quand tu l'as reçu, clique sur le bouton vert **Vérification** ci-dessous pour le saisir.",
            view=view, ephemeral=True,
        )


# ---------- Étape 2 : saisie du code ----------

class CodeModal(discord.ui.Modal, title="Vérification — Étape 2/2"):
    code = discord.ui.TextInput(
        label="Code reçu par email",
        placeholder="Ex : A1B2C3",
        min_length=6, max_length=6,
    )

    async def on_submit(self, interaction: discord.Interaction):
        data = pending_codes.get(interaction.user.id)
        if not data:
            await interaction.response.send_message(
                "❌ Aucune demande en cours. Refais `/verif`.", ephemeral=True)
            return

        if str(self.code).strip().upper() != data["code"]:
            await interaction.response.send_message(
                "❌ **Code incorrect.** Vérifie ton email et réessaie.", ephemeral=True)
            return

        # Code bon : attribution du rôle
        role = discord.utils.get(interaction.guild.roles, name=VERIFIED_ROLE_NAME)
        if role is None:
            role = await interaction.guild.create_role(name=VERIFIED_ROLE_NAME, color=discord.Color.green())
        await interaction.user.add_roles(role, reason="Vérification réussie")
        del pending_codes[interaction.user.id]

        # Notification au webhook staff
        embed = discord.Embed(title="✅ Membre vérifié", color=discord.Color.green())
        embed.add_field(name="Membre", value=interaction.user.mention, inline=True)
        embed.add_field(name="Pseudo Minecraft", value=data["pseudo"], inline=True)
        embed.add_field(name="Email", value=data["email"], inline=False)
        await send_webhook(embed=embed)

        await interaction.response.send_message(
            f"🎉 **Vérification réussie !** Tu as reçu le rôle **{VERIFIED_ROLE_NAME}**.\n"
            "Tu as maintenant accès aux salons et aux giveaways. 🎁", ephemeral=True)


class CodeButtonView(discord.ui.View):
    """Bouton vert 'Vérification' pour saisir le code."""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Vérification", style=discord.ButtonStyle.green, emoji="✅", custom_id="verif_code_btn")
    async def verif_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(CodeModal())


class StartButtonView(discord.ui.View):
    """Bouton vert affiché par /verif pour ouvrir le formulaire."""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Vérification", style=discord.ButtonStyle.green, emoji="📝", custom_id="verif_start_btn")
    async def start_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.id in pending_codes:
            await interaction.response.send_message(
                "⏳ Tu as déjà une demande en cours. Clique sur **Vérification** sous ton message pour entrer le code.",
                ephemeral=True)
            return
        await interaction.response.send_modal(VerifModal())


# ---------- Commande /verif ----------

@bot.tree.command(name="verif", description="Lancer la vérification (pseudo Minecraft + email)")
async def verif(interaction: discord.Interaction):
    embed = discord.Embed(
        title="🔒 Vérification du serveur",
        description=(
            "Pour accéder aux salons et aux **giveaways**, suis ces étapes :\n\n"
            "**1.** Clique sur le bouton vert **Vérification** ci-dessous.\n"
            "**2.** Remplis le formulaire : pseudo Minecraft + email.\n"
            "**3.** Tu recevras un **code par email**.\n"
            "**4.** Saisis ce code pour être vérifié ✅"
        ),
        color=discord.Color.green(),
    )
    await interaction.response.send_message(embed=embed, view=StartButtonView())


@bot.event
async def on_ready():
    import aiohttp
    import logging
    log = logging.getLogger("bot")
    if not hasattr(bot, "session"):
        bot.session = aiohttp.ClientSession()
    # Boutons persistants (fonctionnent même après redémarrage)
    bot.add_view(StartButtonView())
    bot.add_view(CodeButtonView())
    if GUILD_ID:
        guild = discord.Object(id=GUILD_ID)
        bot.tree.copy_global_to(guild=guild)
        await bot.tree.sync(guild=guild)
    else:
        await bot.tree.sync()
    log.info(f"✅ Connecté en tant que {bot.user} — commandes synchronisées.")


if __name__ == "__main__":
    missing = []
    if not TOKEN:
        missing.append("DISCORD_TOKEN")
    if not WEBHOOK_URL:
        missing.append("WEBHOOK_URL")
    if missing:
        print(f"\n❌ Variables manquantes dans .env : {', '.join(missing)}")
        print("   Remplis le fichier .env puis relance : python bot.py")
        input("\n⏎ Appuie sur Entrée pour fermer...")
        sys.exit(1)

    # --- Lancement : TUI Textual + bot dans un thread ---
    from ui import BotApp, TUILogHandler, setup_logging
    import threading

    setup_logging()
    app = BotApp()
    TUILogHandler.app = app

    def run_bot_thread():
        import asyncio
        import logging
        log = logging.getLogger("bot")
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(bot.start(TOKEN))
        except discord.LoginFailure:
            log.error("TOKEN INVALIDE — régénère-le sur le portail dev Discord.")
        except discord.PrivilegedIntentsRequired:
            log.error("INTENT NON ACTIVÉ — active SERVER MEMBERS INTENT sur le portail dev.")
        except Exception as e:
            log.error(f"ERREUR : {type(e).__name__}: {e}")

    t = threading.Thread(target=run_bot_thread, daemon=True)
    t.start()
    app.run()
