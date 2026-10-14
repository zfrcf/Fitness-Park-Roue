# -*- coding: utf-8 -*-
"""
Interface terminal (TUI) pour le bot Discord de vérification.
Affiche les logs en temps réel, le statut du bot, et les vérifications en cours.
Nécessite : pip install textual
"""

import asyncio
import os
import signal
import subprocess
import sys
from datetime import datetime

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.widgets import (
    Button,
    DataTable,
    Footer,
    Header,
    Label,
    Log,
    Static,
)
from textual import work
from textual.worker import Worker, WorkerState


class BotLauncher(App):
    """TUI principale du launcher."""

    TITLE = "🤖 Bot Vérification Discord"
    SUB_TITLE = "Gestion & Logs"

    CSS = """
    #status-bar {
        height: 3;
        padding: 0 2;
        background: $surface;
        border-bottom: solid $primary;
    }
    #status-label {
        width: 1fr;
        text-style: bold;
        content-align: left middle;
    }
    #btn-row {
        height: 5;
        padding: 0 2;
        align: center middle;
    }
    Button {
        margin: 0 1;
    }
    #logs {
        height: 1fr;
        border: solid $primary;
        padding: 0 1;
    }
    #table-container {
        height: 12;
        border: solid $secondary;
        padding: 0 1;
    }
    DataTable {
        height: 1fr;
    }
    """

    BINDINGS = [
        Binding("ctrl+c", "quit", "Quitter"),
        Binding("s", "start_bot", "Démarrer"),
        Binding("k", "stop_bot", "Arrêter"),
        Binding("l", "clear_logs", "Effacer logs"),
    ]

    bot_process: subprocess.Popen | None = None

    def compose(self) -> ComposeResult:
        yield Header()
        with Horizontal(id="status-bar"):
            yield Label("🔴 Bot arrêté", id="status-label")
            yield Label("", id="uptime-label")
        with Horizontal(id="btn-row"):
            yield Button("▶ Démarrer", id="btn-start", variant="success")
            yield Button("⏹ Arrêter", id="btn-stop", variant="error", disabled=True)
            yield Button("🧹 Effacer logs", id="btn-clear", variant="default")
            yield Button("❌ Quitter", id="btn-quit", variant="warning")
        yield Log(id="logs", max_lines=500)
        with Vertical(id="table-container"):
            yield Static("📋 Vérifications en cours", id="table-title")
            yield DataTable(id="pending-table")
        yield Footer()

    def on_mount(self) -> None:
        table = self.query_one("#pending-table", DataTable)
        table.add_columns("Membre", "Pseudo MC", "Email", "Code", "Statut")
        self.log_line("🚀 Launcher prêt. Clique sur ▶ Démarrer ou appuie sur [s].")
        self.log_line(f"📁 Dossier : {os.getcwd()}")
        self._check_env()

    def _check_env(self):
        """Vérifie que le .env est correctement rempli."""
        from dotenv import load_dotenv
        load_dotenv()
        token = os.getenv("DISCORD_TOKEN", "")
        webhook = os.getenv("WEBHOOK_URL", "")
        guild = os.getenv("GUILD_ID", "0")
        role = os.getenv("VERIFIED_ROLE_NAME", "Vérifié")

        if token:
            self.log_line(f"✅ DISCORD_TOKEN : ...{token[-6:]}")
        else:
            self.log_line("❌ DISCORD_TOKEN manquant dans .env")

        if webhook:
            self.log_line(f"✅ WEBHOOK_URL : ...{webhook[-20:]}")
        else:
            self.log_line("❌ WEBHOOK_URL manquant dans .env")

        self.log_line(f"ℹ️  GUILD_ID : {guild} | Rôle : {role}")

    def log_line(self, text: str):
        """Ajoute une ligne horodatée dans les logs."""
        ts = datetime.now().strftime("%H:%M:%S")
        log_widget = self.query_one("#logs", Log)
        log_widget.write_line(f"[{ts}] {text}")

    # ---------- Boutons ----------

    def on_button_pressed(self, event: Button.Pressed) -> None:
        btn = event.button.id
        if btn == "btn-start":
            self.action_start_bot()
        elif btn == "btn-stop":
            self.action_stop_bot()
        elif btn == "btn-clear":
            self.action_clear_logs()
        elif btn == "btn-quit":
            self.exit()

    # ---------- Actions ----------

    def action_start_bot(self) -> None:
        if self.bot_process and self.bot_process.poll() is None:
            self.log_line("⚠️  Le bot tourne déjà.")
            return

        self.log_line("▶ Lancement du bot...")
        self.query_one("#status-label", Label).update("🟡 Démarrage...")
        self.query_one("#btn-start", Button).disabled = True
        self.query_one("#btn-stop", Button).disabled = False

        try:
            self.bot_process = subprocess.Popen(
                [sys.executable, "bot.py"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            self._read_output()
        except Exception as e:
            self.log_line(f"❌ Erreur lancement : {e}")
            self.query_one("#status-label", Label).update("🔴 Erreur")
            self.query_one("#btn-start", Button).disabled = False
            self.query_one("#btn-stop", Button).disabled = True

    @work(thread=True)
    def _read_output(self):
        """Lit la sortie du bot en arrière-plan et l'affiche dans les logs."""
        if not self.bot_process or not self.bot_process.stdout:
            return

        for line in self.bot_process.stdout:
            line = line.rstrip()
            if line:
                self.call_from_thread(self._handle_bot_line, line)

        # Processus terminé
        code = self.bot_process.poll()
        self.call_from_thread(self._on_bot_exit, code)

    def _handle_bot_line(self, line: str):
        """Traite une ligne de sortie du bot."""
        self.log_line(f"🤖 {line}")

        # Détection du statut
        if "Connecté en tant que" in line:
            self.query_one("#status-label", Label).update(f"🟢 {line.strip()}")
        elif "❌" in line or "ERREUR" in line.upper():
            self.query_one("#status-label", Label).update("🔴 Erreur — voir logs")

        # Détection des vérifications pour le tableau
        if "Nouvelle demande" in line or "Membre vérifié" in line:
            self._refresh_pending_table()

    def _refresh_pending_table(self):
        """Met à jour le tableau depuis bot.py (import du dictionnaire)."""
        try:
            import importlib
            import bot as bot_module
            importlib.reload(bot_module)
            table = self.query_one("#pending-table", DataTable)
            table.clear()
            for uid, data in bot_module.pending_codes.items():
                table.add_row(
                    str(uid),
                    data.get("pseudo", "?"),
                    data.get("email", "?"),
                    data.get("code", "?"),
                    "⏳ En attente",
                )
        except Exception:
            pass  # bot.py pas encore importable ou pas de données

    def _on_bot_exit(self, code: int | None):
        """Callback quand le processus du bot se termine."""
        self.log_line(f"⏹ Bot arrêté (code {code})")
        self.query_one("#status-label", Label).update("🔴 Bot arrêté")
        self.query_one("#btn-start", Button).disabled = False
        self.query_one("#btn-stop", Button).disabled = True

    def action_stop_bot(self) -> None:
        if self.bot_process and self.bot_process.poll() is None:
            self.log_line("⏹ Arrêt du bot...")
            self.bot_process.send_signal(signal.SIGTERM)
            try:
                self.bot_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.bot_process.kill()
                self.log_line("💀 Bot tué (SIGKILL)")
            self._on_bot_exit(self.bot_process.returncode)
        else:
            self.log_line("⚠️  Aucun bot en cours.")

    def action_clear_logs(self) -> None:
        self.query_one("#logs", Log).clear()
        self.log_line("🧹 Logs effacés.")


if __name__ == "__main__":
    app = BotLauncher()
    app.run()
