#!/bin/bash
# Crée un binaire standalone (un seul fichier) avec PyInstaller.
set -e
cd "$(dirname "$0")"

echo "📦 Préparation de l'environnement..."

if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install -r requirements.txt -q
pip install pyinstaller -q

# Vérifie que .env existe
if [ ! -f ".env" ]; then
    echo "⚠️  Fichier .env introuvable — le binaire aura besoin d'un .env à côté de lui."
    ENV_OPT=""
else
    ENV_OPT="--add-data .env:."
fi

# Vérifie que templates existe
if [ ! -d "templates" ]; then
    echo "❌ Dossier 'templates/' introuvable !"
    exit 1
fi

echo "🔨 Compilation en cours (peut prendre 1-2 min)..."

pyinstaller \
    --onefile \
    --name "SpideyBot" \
    --add-data "templates:templates" \
    $ENV_OPT \
    --hidden-import=discord \
    --hidden-import=discord.ui \
    --hidden-import=discord.app_commands \
    --hidden-import=flask \
    --hidden-import=aiohttp \
    --hidden-import=dotenv \
    --hidden-import=dotenv.main \
    --collect-all discord \
    --collect-all flask \
    bot.py

echo ""
echo "✅ Binaire créé : dist/SpideyBot"
echo ""
echo "   Pour l'utiliser :"
echo "     1. Copie le binaire + .env + templates/ dans un dossier"
echo "     2. chmod +x SpideyBot"
echo "     3. ./SpideyBot"
echo ""
echo "   Taille : $(du -h dist/SpideyBot | cut -f1)"
