#!/bin/bash
# Lance le bot : installe les dépendances si nécessaire, puis démarre.
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo "📦 Première installation..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt -q
else
    source venv/bin/activate
fi

python bot.py
