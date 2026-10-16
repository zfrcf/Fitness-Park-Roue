#!/bin/bash
# Lance le bot : au 1er lancement, compile le binaire PyInstaller.
cd "$(dirname "$0")"

if [ ! -f "SpideyBot" ]; then
    echo "📦 Première installation — compilation en cours (2-3 min)..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt pyinstaller -q
    pyinstaller --onefile --name SpideyBot \
        --add-data "templates:templates" \
        --collect-all discord \
        --collect-all flask \
        bot.py
    mv dist/SpideyBot .
    rm -rf dist build venv
    chmod +x SpideyBot
    echo "✅ Binaire créé : $(pwd)/SpideyBot"
    echo ""
fi

./SpideyBot
exec bash
