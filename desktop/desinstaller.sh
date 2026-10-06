#!/usr/bin/env bash
# Retire l'atelier IA local : environnement Python, JDK, Gradle, Node, Electron, interface, cache, entrée
# de menu et commande « atelier ».
# Vos projets (~/AtelierProjets), votre configuration (~/.config/atelier) et les conversations de
# l'interface (~/.local/share/atelier/ui) sont CONSERVÉS, sauf avec --tout (configuration et
# conversations supprimées ; les projets ne sont jamais supprimés).
set -euo pipefail
if [[ -n "${ATELIER_HOME:-}" ]]; then
  DONNEES="$ATELIER_HOME/donnees"; CONFIG="$ATELIER_HOME/config"
else
  DONNEES="${XDG_DATA_HOME:-$HOME/.local/share}/atelier"; CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/atelier"
fi
BIN="${ATELIER_BIN:-$HOME/.local/bin}"
if [[ -n "${ATELIER_HOME:-}" ]]; then MENU="$ATELIER_HOME/share/applications"; else MENU="${XDG_DATA_HOME:-$HOME/.local/share}/applications"; fi

# Arrêter l'interface graphique si elle tourne.
if [[ -x "$BIN/atelier" ]]; then "$BIN/atelier" ui --arreter >/dev/null 2>&1 || true; fi
rm -f "$MENU/atelier-ia.desktop"

if [[ -x "$DONNEES/gradle/bin/gradle" ]]; then
  JAVA_HOME="$DONNEES/jdk" "$DONNEES/gradle/bin/gradle" --stop >/dev/null 2>&1 || true
fi
if [[ -L "$BIN/atelier" ]] || grep -qs "atelier" "$BIN/atelier"; then rm -f "$BIN/atelier"; fi
if [[ "${1:-}" == "--tout" ]]; then
  rm -rf "$DONNEES" "$CONFIG" "${XDG_CONFIG_HOME:-$HOME/.config}/atelier-ia"
  echo "Atelier retiré ($DONNEES), configuration et conversations comprises ($CONFIG)."
else
  if [[ -d "$DONNEES" ]]; then
    find "$DONNEES" -mindepth 1 -maxdepth 1 ! -name ui -exec rm -rf {} +
  fi
  echo "Atelier retiré ($DONNEES)."
  echo "Conservés : configuration $CONFIG et conversations $DONNEES/ui (./desinstaller.sh --tout pour les retirer)."
fi
echo "Projets conservés : ~/AtelierProjets"
