#!/usr/bin/env sh
# Builds the engine process in engine/ against a checkout of Argentum.
#
#   scripts/engine-build.sh          # clone or update, copy the module in, build
#   scripts/engine-build.sh --play   # ...and then play one game through it
#
# ENGINE_HOME says where the checkout lives (default: ../argentum, beside this
# repo). The module is copied, not linked, so the checkout stays a plain clone
# of upstream plus one directory; `git status` there shows exactly what we add.
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
home=${ENGINE_HOME:-"$here/../argentum"}
repo=${ENGINE_REPO:-https://github.com/ronoccc/engine-choo-choo.git}

if [ ! -d "$home/.git" ]; then
  echo "engine: cloning $repo into $home"
  git clone --depth 1 "$repo" "$home"
fi

mkdir -p "$home/companion/src/main/kotlin"
rm -rf "$home/companion/src/main/kotlin/companion"
cp "$here/engine/build.gradle.kts" "$home/companion/build.gradle.kts"
cp -r "$here/engine/src/main/kotlin/companion" "$home/companion/src/main/kotlin/companion"
grep -q 'include(":companion")' "$home/settings.gradle.kts" || printf '\ninclude(":companion")\n' >> "$home/settings.gradle.kts"

cd "$home"
./gradlew :companion:installDist --no-daemon -q
echo "engine: built $home/companion/build/install/companion/bin/companion"

if [ "${1:-}" = "--play" ]; then
  cd "$here"
  ENGINE_CMD="$home/companion/build/install/companion/bin/companion" node scripts/engine-play.mjs
fi
