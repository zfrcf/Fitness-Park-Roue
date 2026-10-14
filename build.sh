#!/bin/bash
# Crée un binaire standalone (un seul fichier) avec PyInstaller.
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt -q
else
    source venv/bin/activate
fi

pip install pyinstaller -q

pyinstaller \
    --onefile \
    --name "SpideyBot" \
    --add-data "templates:templates" \
    --add-data ".env:." \
    --hidden-import=discord \
    --hidden-import=flask \
    --hidden-import=aiohttp \
    bot.py

echo ""
echo "✅ Binaire créé : dist/SpideyBot"
echo "   Lance-le avec : ./dist/SpideyBot"
