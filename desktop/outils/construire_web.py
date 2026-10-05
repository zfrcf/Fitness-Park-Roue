#!/usr/bin/env python3
"""Construit l'interface graphique de l'atelier (développement / préparation de l'archive).

  python3 desktop/outils/construire_web.py

1. `next build` du dépôt en mode atelier local (NEXT_PUBLIC_ATELIER_LOCAL=1 → sortie autonome) ;
2. assemble desktop/web/ : serveur autonome sans sources, sans base de développement, sans secret
   (la construction est refusée si une valeur de .env.local s'y retrouve).

Prérequis : `npm ci` déjà fait à la racine du dépôt.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
DESKTOP = ICI.parent
DEPOT = DESKTOP.parent
sys.path.insert(0, str(DESKTOP))

from atelier.ui import assembler_app  # noqa: E402


def main() -> int:
    env = dict(os.environ, NEXT_PUBLIC_ATELIER_LOCAL="1", ATELIER_LOCAL="1", NEXT_TELEMETRY_DISABLED="1")
    subprocess.run(["npx", "next", "build"], cwd=DEPOT, env=env, check=True)
    dest = assembler_app(DEPOT, DESKTOP / "web")
    taille = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file() and not f.is_symlink())
    print(f"✔ Interface assemblée dans {dest} ({taille / 1e6:.0f} Mo), version {(dest / 'VERSION').read_text().strip()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
