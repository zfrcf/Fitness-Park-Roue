#!/usr/bin/env bash
# Retire l'atelier IA local : environnement Python, JDK, Gradle, cache et commande « atelier ».
# Vos projets (~/AtelierProjets) et votre configuration (~/.config/atelier) sont CONSERVÉS,
# sauf avec --tout (configuration supprimée ; les projets ne sont jamais supprimés).
set -euo pipefail
if [[ -n "${ATELIER_HOME:-}" ]]; then
  DONNEES="$ATELIER_HOME/donnees"; CONFIG="$ATELIER_HOME/config"
else
  DONNEES="${XDG_DATA_HOME:-$HOME/.local/share}/atelier"; CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/atelier"
fi
BIN="${ATELIER_BIN:-$HOME/.local/bin}"

if [[ -x "$DONNEES/gradle/bin/gradle" ]]; then
  JAVA_HOME="$DONNEES/jdk" "$DONNEES/gradle/bin/gradle" --stop >/dev/null 2>&1 || true
fi
[[ -L "$BIN/atelier" ]] && rm -f "$BIN/atelier"
rm -rf "$DONNEES"
echo "Atelier retiré ($DONNEES)."
if [[ "${1:-}" == "--tout" ]]; then
  rm -rf "$CONFIG"
  echo "Configuration retirée ($CONFIG)."
else
  echo "Configuration conservée : $CONFIG (./desinstaller.sh --tout pour la retirer)."
fi
echo "Projets conservés : ~/AtelierProjets"
