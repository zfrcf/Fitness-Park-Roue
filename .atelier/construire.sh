#!/usr/bin/env bash
# Construction universelle de l'atelier IA (ne modifiez pas : régénéré à chaque compilation).
set -uo pipefail
SORTIE=.atelier-sortie

existe() { compgen -G "$1" > /dev/null 2>&1; }
trouve() { find . -path ./node_modules -prune -o -path ./.git -prune -o -path ./target -prune -o -path ./.atelier-deps -prune -o -name "$1" -print -quit 2>/dev/null | grep -q .; }

detecter() {
  if [ -f build.gradle ] || [ -f build.gradle.kts ]; then echo gradle
  elif [ -f pom.xml ]; then echo maven
  elif [ -f Cargo.toml ]; then echo rust
  elif [ -f go.mod ]; then echo go
  elif [ -f package.json ]; then echo node
  elif existe "*.csproj" || existe "*.sln"; then echo dotnet
  elif [ -f CMakeLists.txt ]; then echo cmake
  elif [ -f Makefile ] || [ -f makefile ] || [ -f GNUmakefile ]; then echo make
  elif [ -f pyproject.toml ] || [ -f requirements.txt ] || [ -f setup.py ] || trouve "*.py"; then echo python
  elif trouve "*.cpp" || trouve "*.cc" || trouve "*.cxx"; then echo cpp
  elif trouve "*.c"; then echo c
  elif trouve "*.html"; then echo web
  else echo inconnu
  fi
}

if [ "${1:-}" = "--detecter" ]; then echo "type=$(detecter)"; exit 0; fi

TYPE=$(detecter)
rm -rf "$SORTIE"; mkdir -p "$SORTIE"
echo "▶ Projet détecté : $TYPE"

exige() {
  if ! command -v "$1" > /dev/null 2>&1; then
    echo "OUTIL ABSENT : « $1 » n'est pas installé sur cette machine ($2)."
    echo "Sur le site, la compilation se fait sur GitHub où tout est installé ; sur l'ordinateur, installez l'outil ou demandez un autre langage."
    exit 3
  fi
}
# Exécutables produits (hors bibliothèques et fichiers intermédiaires) copiés dans la sortie.
copier_executables() {
  find "$1" -maxdepth "${2:-1}" -type f -perm -u+x ! -name "*.so" ! -name "*.d" ! -name "*.rlib" ! -name "*.sh" ! -path "*/CMakeFiles/*" ! -path "*/deps/*" ! -path "*/build/*/build/*" 2>/dev/null | while read -r f; do cp "$f" "$SORTIE/" 2>/dev/null; done
}
fin() {
  { echo "type=$TYPE"; echo "$1"; } > "$SORTIE/ATELIER-RESULTAT.txt"
  echo "✔ $1"
  exit 0
}

case "$TYPE" in
  gradle)
    G="${ATELIER_GRADLE:-gradle}"
    exige "$G" "Gradle : lancez « atelier installer »"
    if [ "${ATELIER_CI:-}" = "1" ]; then "$G" build -x test --no-daemon --console=plain --warning-mode=none || exit 1
    else "$G" build --console=plain --warning-mode=summary || exit 1; fi
    for j in build/libs/*.jar; do
      case "$j" in *-sources.jar|*-dev.jar|*-javadoc.jar|*-plain.jar) ;; *) [ -f "$j" ] && cp "$j" "$SORTIE/" ;; esac
    done
    existe "$SORTIE/*.jar" || { echo "Compilation réussie mais aucun .jar dans build/libs."; exit 1; }
    fin "Jar produit."
    ;;
  maven)
    exige mvn "Maven"
    mvn -B -ntp package || exit 1
    for j in target/*.jar; do case "$j" in *-sources.jar|*-javadoc.jar|*/original-*) ;; *) [ -f "$j" ] && cp "$j" "$SORTIE/" ;; esac; done
    fin "Projet Maven construit (tests compris)."
    ;;
  node)
    if [ -n "${ATELIER_NODE_BIN:-}" ]; then export PATH="$ATELIER_NODE_BIN:$PATH"; fi
    exige node "Node.js"; exige npm "npm, fourni avec Node.js"
    if [ -f package-lock.json ]; then npm ci --no-audit --no-fund || npm install --no-audit --no-fund || exit 1
    else npm install --no-audit --no-fund || exit 1; fi
    script() { node -e "const s=(require('./package.json').scripts||{})['$1'];process.exit(s&&!/no test specified/.test(s)?0:1)"; }
    if script build; then npm run build || exit 1; fi
    if script test; then CI=true npm test || exit 1; fi
    if script lint; then npm run lint || echo "(avertissements du linter ignorés)"; fi
    for d in dist build out; do [ -d "$d" ] && cp -r "$d" "$SORTIE/"; done
    fin "Projet Node construit (build et tests s'ils existent)."
    ;;
  python)
    PY="${ATELIER_PYTHON:-python3}"
    exige "$PY" "Python 3"
    export PYTHONPATH="$PWD/.atelier-deps${PYTHONPATH:+:$PYTHONPATH}"
    pip_ok() { "$PY" -m pip --version > /dev/null 2>&1; }
    if [ -f requirements.txt ] && grep -qv '^[[:space:]]*\(#\|$\)' requirements.txt; then
      pip_ok || { echo "OUTIL ABSENT : « pip » n'est pas disponible pour $PY (dépendances de requirements.txt)."; exit 3; }
      "$PY" -m pip install -q --disable-pip-version-check --target .atelier-deps -r requirements.txt || exit 1
    fi
    if [ -f pyproject.toml ] && grep -q "dependencies" pyproject.toml && pip_ok; then "$PY" -m pip install -q --disable-pip-version-check --target .atelier-deps . || echo "(installation du paquet impossible, on continue)"; fi
    "$PY" -m compileall -q -f -x "(\\.atelier-deps|\\.venv|venv|node_modules)" . || exit 1
    if trouve "test_*.py" || trouve "*_test.py"; then
      if ! "$PY" -c "import pytest" > /dev/null 2>&1; then
        if pip_ok; then "$PY" -m pip install -q --disable-pip-version-check --target .atelier-deps pytest || exit 1
        else fin "Code Python vérifié (syntaxe) ; tests non lancés : pytest et pip indisponibles."; fi
      fi
      "$PY" -m pytest -q -p no:cacheprovider --ignore=.atelier-deps || exit 1
      fin "Code Python vérifié, tests réussis."
    fi
    fin "Code Python vérifié (syntaxe ; aucun test trouvé)."
    ;;
  rust)
    exige cargo "Rust : https://rustup.rs"
    cargo build --release || exit 1
    if grep -rqs "#\\[test\\]" src tests 2>/dev/null; then cargo test --release || exit 1; fi
    copier_executables target/release 1
    fin "Projet Rust construit."
    ;;
  go)
    exige go "Go : https://go.dev/dl"
    go vet ./... || exit 1
    go build -o "$SORTIE/" ./... || exit 1
    if trouve "*_test.go"; then go test ./... || exit 1; fi
    fin "Projet Go construit."
    ;;
  dotnet)
    exige dotnet ".NET SDK"
    dotnet build -c Release || exit 1
    if grep -rqs "Microsoft.NET.Test.Sdk" --include=*.csproj .; then dotnet test -c Release --no-build || exit 1; fi
    find . -path "*/bin/Release/*" -type f \( -name "*.dll" -o -name "*.exe" -o -name "*.json" \) -exec cp {} "$SORTIE/" \; 2>/dev/null
    fin "Projet .NET construit."
    ;;
  cmake)
    exige cmake "CMake"
    cmake -S . -B .atelier-build -DCMAKE_BUILD_TYPE=Release || exit 1
    cmake --build .atelier-build -j 4 || exit 1
    (cd .atelier-build && ctest --output-on-failure 2>/dev/null) || true
    copier_executables .atelier-build 2
    fin "Projet CMake construit."
    ;;
  make)
    exige make "make (paquet build-essential)"
    touch .atelier-marque
    make -j 4 || exit 1
    find . -maxdepth 2 -type f -perm -u+x -newer .atelier-marque ! -name "*.sh" ! -path "./$SORTIE/*" -exec cp {} "$SORTIE/" \; 2>/dev/null
    rm -f .atelier-marque
    fin "Projet construit avec make."
    ;;
  c)
    exige gcc "gcc (paquet build-essential)"
    gcc -std=c17 -O2 -Wall -Wextra $(find . -name "*.c" -not -path "./.atelier*") -o "$SORTIE/programme" -lm || exit 1
    fin "Programme C compilé : programme."
    ;;
  cpp)
    exige g++ "g++ (paquet build-essential)"
    g++ -std=c++20 -O2 -Wall -Wextra $(find . \( -name "*.cpp" -o -name "*.cc" -o -name "*.cxx" \) -not -path "./.atelier*") -o "$SORTIE/programme" || exit 1
    fin "Programme C++ compilé : programme."
    ;;
  web)
    trouve "index.html" || echo "(pas d'index.html : l'aperçu ouvrira la première page trouvée)"
    fin "Site statique prêt : utilisez l'aperçu de l'explorateur."
    ;;
  *)
    echo "TYPE DE PROJET NON RECONNU : aucun fichier de construction (package.json, pyproject.toml, Cargo.toml, go.mod, CMakeLists.txt, Makefile, pom.xml, build.gradle…) ni source reconnue."
    exit 4
    ;;
esac
