#!/usr/bin/env bash
# Installation de l'atelier IA local sur Ubuntu (22.04, 24.04 et plus récents).
#
#   ./install.sh                 installation complète (demande sudo pour les paquets apt manquants)
#   ./install.sh --sans-apt      sans sudo : suppose python3, python3-venv et curl déjà présents
#   ./install.sh --importer FICHIER.env   importe aussi les clés PROVIDER_n_* d'un .env
#
# Ce qui est installé :
#   - paquets apt manquants : python3 python3-venv python3-pip curl unzip git ca-certificates
#   - ~/.local/share/atelier/venv   environnement Python de l'atelier (httpx, rich)
#   - ~/.local/share/atelier/jdk    JDK Temurin 25 (téléchargé, somme SHA-256 vérifiée)
#   - ~/.local/share/atelier/gradle Gradle 9.7.1 (téléchargé, somme SHA-256 vérifiée)
#   - ~/.local/bin/atelier          la commande « atelier »
# Rien n'est installé ailleurs ; pour tout retirer : ./desinstaller.sh
set -euo pipefail

ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${ATELIER_HOME:-}" ]]; then
  DONNEES="$ATELIER_HOME/donnees"
else
  DONNEES="${XDG_DATA_HOME:-$HOME/.local/share}/atelier"
fi
BIN="${ATELIER_BIN:-$HOME/.local/bin}"
SANS_APT=0
IMPORT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sans-apt) SANS_APT=1 ;;
    --importer) IMPORT="${2:?--importer attend un fichier}"; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
  shift
done

bleu() { printf '\033[1;34m▶ %s\033[0m\n' "$*"; }
vert() { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
rouge() { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; }

# 1. Paquets système ----------------------------------------------------------------------------
if [[ $SANS_APT -eq 0 ]] && command -v apt-get >/dev/null 2>&1; then
  manquants=()
  for p in python3 python3-venv python3-pip curl unzip git ca-certificates; do
    dpkg -s "$p" >/dev/null 2>&1 || manquants+=("$p")
  done
  # python3-venv peut exister sans ensurepip pour la version courante (paquet python3.X-venv).
  if dpkg -s python3 >/dev/null 2>&1 && ! python3 -c "import ensurepip" >/dev/null 2>&1; then
    manquants+=("python3.$(python3 -c 'import sys; print(sys.version_info.minor)')-venv")
  fi
  if [[ ${#manquants[@]} -gt 0 ]]; then
    bleu "Installation des paquets système : ${manquants[*]}"
    SUDO=""; [[ $EUID -ne 0 ]] && SUDO="sudo"
    $SUDO apt-get update -q
    $SUDO apt-get install -y -q "${manquants[@]}"
  fi
fi

command -v python3 >/dev/null 2>&1 || { rouge "python3 introuvable (sudo apt install python3 python3-venv)"; exit 1; }
python3 - <<'PY' || { rouge "Python 3.10 ou plus récent est requis."; exit 1; }
import sys
sys.exit(0 if sys.version_info >= (3, 10) else 1)
PY

# 2. Environnement Python ------------------------------------------------------------------------
bleu "Environnement Python : $DONNEES/venv"
mkdir -p "$DONNEES"
if [[ ! -x "$DONNEES/venv/bin/python" ]]; then
  python3 -m venv "$DONNEES/venv" || { rouge "python3 -m venv a échoué : sudo apt install python3-venv"; exit 1; }
fi
"$DONNEES/venv/bin/python" -m pip install --quiet --upgrade pip
"$DONNEES/venv/bin/python" -m pip install --quiet --upgrade "$ICI"
vert "atelier $("$DONNEES/venv/bin/atelier" --version | awk '{print $2}') installé"

# 3. Commande « atelier » ------------------------------------------------------------------------
mkdir -p "$BIN"
ln -sf "$DONNEES/venv/bin/atelier" "$BIN/atelier"
vert "Commande : $BIN/atelier"

# 4. JDK 25 + Gradle 9.7.1 (téléchargés par Python, sommes de contrôle vérifiées) ---------------
bleu "JDK 25 et Gradle 9.7.1"
"$DONNEES/venv/bin/atelier" installer || { rouge "Installation de JDK/Gradle incomplète (voir ci-dessus)."; exit 1; }

# 5. Clés API -----------------------------------------------------------------------------------
if [[ -n "$IMPORT" ]]; then
  "$DONNEES/venv/bin/atelier" config --importer "$IMPORT"
fi

case ":$PATH:" in
  *":$BIN:"*) ;;
  *)
    if ! grep -qs 'atelier : ~/.local/bin' "$HOME/.bashrc"; then
      printf '\n# atelier : ~/.local/bin dans le PATH\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.bashrc"
    fi
    echo "Ouvrez un nouveau terminal (ou lancez : export PATH=\"$BIN:\$PATH\") pour utiliser « atelier »."
    ;;
esac

echo
vert "Installation terminée."
echo "  1. Configurer une clé API :   atelier config"
echo "  2. Vérifier :                 atelier doctor   puis   atelier tester"
echo "  3. Créer un projet :          atelier nouveau mon-mod"
