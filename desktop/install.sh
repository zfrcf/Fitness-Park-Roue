#!/usr/bin/env bash
# Installation de l'atelier IA local sur Ubuntu, SANS sudo : délègue à installer.py.
#
#   ./install.sh                         installation complète dans votre dossier personnel
#   ./install.sh --importer FICHIER.env  importe aussi les clés PROVIDER_n_* d'un .env
#
# Équivalent direct : python3 installer.py
# Seul prérequis : python3 ≥ 3.10 (présent d'office sur Ubuntu 22.04 et plus récent).
set -euo pipefail
ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 est introuvable. Il est installé d'office sur Ubuntu : vérifiez votre PATH." >&2
  exit 1
fi
exec python3 "$ICI/installer.py" "$@"
