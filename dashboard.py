# -*- coding: utf-8 -*-
"""
Dashboard web pour le bot Discord — Flask + SSE (logs temps réel).
Lancé automatiquement en arrière-plan par bot.py.
"""
import json
import logging
import queue
import threading
from collections import deque

from flask import Flask, Response, jsonify, render_template

app = Flask(__name__)

# ---------- Infrastructure logs ----------

log_buffer: deque = deque(maxlen=300)
subscribers: list[queue.Queue] = []
sub_lock = threading.Lock()


class SSELogHandler(logging.Handler):
    """Capture chaque log et le diffuse aux abonnés SSE."""

    def emit(self, record):
        try:
            entry = {
                "time": logging.Formatter("%H:%M:%S").formatTime(record),
                "level": record.levelname,
                "name": record.name,
                "message": self.format(record),
            }
            log_buffer.append(entry)
            with sub_lock:
                for q in subscribers:
                    try:
                        q.put_nowait(entry)
                    except queue.Full:
                        pass
        except Exception:
            pass


def _setup_logging():
    fmt = logging.Formatter("[%(asctime)s] %(levelname)-8s %(name)s: %(message)s",
                            datefmt="%H:%M:%S")

    # Handler SSE (tout niveau)
    h_sse = SSELogHandler()
    h_sse.setFormatter(fmt)
    h_sse.setLevel(logging.DEBUG)

    # Handler console (INFO+)
    h_con = logging.StreamHandler()
    h_con.setFormatter(fmt)
    h_con.setLevel(logging.INFO)

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    root.addHandler(h_sse)
    root.addHandler(h_con)

    # Réduire le bruit de bibliothèques tierces
    logging.getLogger("aiohttp").setLevel(logging.WARNING)
    logging.getLogger("discord").setLevel(logging.DEBUG)


# ---------- Routes ----------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status")
def api_status():
    import bot as bot_module
    guild = bot_module.bot.guilds[0] if bot_module.bot.guilds else None
    return jsonify({
        "online": bot_module.bot.is_ready(),
        "username": str(bot_module.bot.user) if bot_module.bot.user else "—",
        "guild": guild.name if guild else "—",
        "guild_id": str(guild.id) if guild else "—",
        "pending": {
            str(uid): {**data, "user_id": uid}
            for uid, data in bot_module.pending_codes.items()
        },
        "verified_count": len(bot_module.verified_users),
        "log_count": len(log_buffer),
    })


@app.route("/logs")
def logs_sse():
    q: queue.Queue = queue.Queue(maxsize=500)
    with sub_lock:
        subscribers.append(q)

    def stream():
        try:
            # Envoi des logs déjà en buffer
            for entry in log_buffer:
                yield f"data: {json.dumps(entry, ensure_ascii=False)}\n\n"
            # Puis flux temps réel
            while True:
                try:
                    entry = q.get(timeout=30)
                    yield f"data: {json.dumps(entry, ensure_ascii=False)}\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"
        finally:
            with sub_lock:
                if q in subscribers:
                    subscribers.remove(q)

    return Response(stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache",
                             "X-Accel-Buffering": "no",
                             "Connection": "keep-alive"})


# ---------- Démarrage ----------

def start_dashboard(port: int = 8686):
    """Lance le dashboard Flask en thread daemon."""
    _setup_logging()
    t = threading.Thread(
        target=lambda: app.run(host="127.0.0.1", port=port,
                               debug=False, use_reloader=False),
        daemon=True,
    )
    t.start()
    print(f"\n🌐  Dashboard  →  http://localhost:{port}\n")
