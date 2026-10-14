# -*- coding: utf-8 -*-
"""
Dashboard web du bot — Flask + SSE (logs en temps réel).
Accessible sur http://localhost:8686
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
    """Capture chaque log et le diffuse aux abonnés SSE (navigateurs)."""

    def emit(self, record):
        try:
            entry = {
                "time": record.created and logging.Formatter("%H:%M:%S").formatTime(record) or "",
                "level": record.levelname,
                "name": record.name,
                "message": record.getMessage(),
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


def setup_logging():
    """Configure le logging : SSE + console + fichier bot.log."""
    fmt = logging.Formatter("[%(asctime)s] %(levelname)-8s %(name)s: %(message)s",
                            datefmt="%H:%M:%S")

    h_sse = SSELogHandler()
    h_sse.setLevel(logging.DEBUG)

    h_con = logging.StreamHandler()
    h_con.setFormatter(fmt)
    h_con.setLevel(logging.INFO)

    h_file = logging.FileHandler("bot.log", encoding="utf-8")
    h_file.setFormatter(fmt)
    h_file.setLevel(logging.DEBUG)

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)
    root.addHandler(h_sse)
    root.addHandler(h_con)
    root.addHandler(h_file)

    logging.getLogger("aiohttp").setLevel(logging.WARNING)
    logging.getLogger("discord").setLevel(logging.INFO)
    logging.getLogger("werkzeug").setLevel(logging.WARNING)


# ---------- Routes ----------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status")
def api_status():
    """Statut du bot + vérifications en attente (pollé toutes les 2 s)."""
    import bot as bot_module
    b = bot_module.bot
    guild = b.guilds[0] if b.guilds else None
    return jsonify({
        "online": b.is_ready(),
        "username": str(b.user) if b.user else "—",
        "guild": guild.name if guild else "—",
        "latency": round(b.latency * 1000) if b.is_ready() else 0,
        "pending": [
            {"user_id": str(uid), **data}
            for uid, data in bot_module.pending_codes.items()
        ],
        "log_count": len(log_buffer),
    })


@app.route("/logs")
def logs_sse():
    """Flux SSE : envoie l'historique puis les logs en temps réel."""
    q: queue.Queue = queue.Queue(maxsize=500)
    with sub_lock:
        subscribers.append(q)

    def stream():
        try:
            for entry in list(log_buffer):
                yield f"data: {json.dumps(entry, ensure_ascii=False)}\n\n"
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
                             "X-Accel-Buffering": "no"})


# ---------- Démarrage ----------

def start_dashboard(port: int = 8686):
    """Lance le dashboard Flask dans un thread daemon."""
    t = threading.Thread(
        target=lambda: app.run(host="127.0.0.1", port=port,
                               debug=False, use_reloader=False,
                               threaded=True),
        daemon=True,
    )
    t.start()
