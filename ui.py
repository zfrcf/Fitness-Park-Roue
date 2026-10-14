# -*- coding: utf-8 -*-
"""
Interface terminal (TUI) du bot — Textual.
Affiche : statut du bot, stats, vérifications en attente, logs en direct.
"""
import logging
from collections import deque
from datetime import datetime

from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical
from textual.widgets import Header, Footer, RichLog, Static, DataTable
from textual.reactive import reactive

# Buffer partagé avec le bot (le handler y écrit, la TUI lit)
log_buffer: deque = deque(maxlen=500)


class TUILogHandler(logging.Handler):
    """Envoie chaque log dans le buffer (thread-safe via call_from_thread)."""

    app = None  # référence à l'app Textual, posée au démarrage

    def emit(self, record):
        try:
            msg = self.format(record)
            entry = (record.levelname, record.name, msg)
            log_buffer.append(entry)
            if TUILogHandler.app is not None:
                TUILogHandler.app.call_from_thread(
                    TUILogHandler.app.write_log, *entry)
        except Exception:
            pass


def setup_logging():
    """Configure le logging : TUI + fichier bot.log."""
    fmt = logging.Formatter("[%(asctime)s] %(message)s", datefmt="%H:%M:%S")

    h_tui = TUILogHandler()
    h_tui.setFormatter(fmt)
    h_tui.setLevel(logging.DEBUG)

    h_file = logging.FileHandler("bot.log", encoding="utf-8")
    h_file.setFormatter(logging.Formatter(
        "[%(asctime)s] %(levelname)-8s %(name)s: %(message)s"))
    h_file.setLevel(logging.DEBUG)

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    root.addHandler(h_tui)
    root.addHandler(h_file)

    logging.getLogger("aiohttp").setLevel(logging.WARNING)
    logging.getLogger("discord").setLevel(logging.INFO)
    logging.getLogger("textual").setLevel(logging.WARNING)


LEVEL_STYLE = {
    "DEBUG": "dim",
    "INFO": "green",
    "WARNING": "yellow",
    "ERROR": "red",
    "CRITICAL": "bold red",
}


class BotApp(App):
    """Application terminal principale."""

    CSS = """
    #stats { height: 5; border: solid $primary; padding: 0 1; }
    #main { height: 1fr; }
    #pending { width: 38; border: solid $secondary; }
    #logs { border: solid $primary; }
    #status { dock: top; height: 3; border: solid $accent; padding: 0 1; }
    """

    status_text = reactive("⏳ Connexion...")

    def compose(self) -> ComposeResult:
        yield Header()
        yield Static(self.status_text, id="status")
        with Horizontal(id="main"):
            with Vertical(id="pending"):
                yield Static("⏳ Vérifications en attente")
                yield DataTable(id="pending-table")
            yield RichLog(id="logs", highlight=True, markup=True,
                          auto_scroll=True, max_lines=1000)
        yield Footer()

    def on_mount(self):
        self.title = "Spidey Bot — Console"
        table = self.query_one("#pending-table", DataTable)
        table.add_columns("Membre", "Pseudo MC", "Code")
        table.cursor_type = "row"
        # Rejoue les logs déjà bufferisés
        for lvl, name, msg in list(log_buffer):
            self.write_log(lvl, name, msg)
        # Rafraîchit le statut toutes les 2 s
        self.set_interval(2.0, self.refresh_status)

    def write_log(self, level: str, name: str, msg: str):
        style = LEVEL_STYLE.get(level, "white")
        log = self.query_one("#logs", RichLog)
        log.write(f"[{style}]{level:<8}[/] [dim]{name}[/] {msg}")

    def refresh_status(self):
        import bot as bot_module
        b = bot_module.bot
        if b.is_ready() and b.user:
            guild = b.guilds[0] if b.guilds else None
            self.query_one("#status", Static).update(
                f"🟢 [bold green]En ligne[/] — {b.user} "
                f"| Serveur : {guild.name if guild else '—'} "
                f"| Latence : {round(b.latency * 1000)} ms")
        else:
            self.query_one("#status", Static).update(
                "🔴 [bold red]Hors ligne[/] — connexion en cours...")

        # Table des vérifications en attente
        table = self.query_one("#pending-table", DataTable)
        table.clear()
        for uid, data in bot_module.pending_codes.items():
            table.add_row(str(uid), data["pseudo"], data["code"])
