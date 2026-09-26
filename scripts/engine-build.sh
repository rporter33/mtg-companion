#!/usr/bin/env sh
# Builds the engine process in engine/ against a checkout of Argentum.
#
#   scripts/engine-build.sh          # fetch the pinned commit, copy the module in, build
#   scripts/engine-build.sh --play   # ...and then play one game through it
#   scripts/engine-build.sh --rev    # say the commit it would build, and nothing else
#   scripts/engine-build.sh --repo   # say where it fetches Argentum from, and nothing else
#
# ENGINE_HOME says where the checkout lives (default: ../argentum, beside this
# repo). The module is copied, not linked, so the checkout stays a plain clone
# of upstream plus one directory; `git status` there shows exactly what we add.
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
home=${ENGINE_HOME:-"$here/../argentum"}
repo=${ENGINE_REPO:-https://github.com/ronoccc/engine-choo-choo.git}
# The Argentum commit everything was last built and measured against. Upstream
# main moves daily, and a build that follows it can change under a test that
# passed yesterday. Moving the pin is a deliberate commit, with the compile time
# and a game measured again (engine/README.md).
rev=${ENGINE_REV:-70d525c69845c4a8c14516a5c7214444096e1018}
# CI keys its cache of the built engine on this (.github/workflows/deploy.yml),
# and asks here rather than keep a copy of the pin that could drift from it. The
# weekly offer to move the pin (.github/workflows/engine-pin.yml) asks for both,
# for the same reason.
if [ "${1:-}" = "--rev" ]; then
  echo "$rev"
  exit 0
fi
if [ "${1:-}" = "--repo" ]; then
  echo "$repo"
  exit 0
fi

if [ ! -d "$home/.git" ]; then
  echo "engine: fetching $repo at $rev into $home"
  git init -q "$home"
  git -C "$home" remote add origin "$repo"
fi
# LF on disk, whatever this machine's autocrlf says: gradlew is a shell script,
# and a CRLF shebang stops it running at all.
git -C "$home" config core.autocrlf false
if [ "$(git -C "$home" rev-parse -q --verify HEAD 2>/dev/null || true)" != "$rev" ]; then
  git -C "$home" fetch -q --depth 1 origin "$rev"
  # --force: the include line added below is the only local edit to a tracked
  # file, and it is added again after the checkout.
  git -C "$home" checkout -q --force FETCH_HEAD
fi

# Gradle builds with whatever JAVA_HOME names. When that is a Java runtime
# rather than a JDK, it fails with "No Java compiler found", which says nothing
# about JAVA_HOME. A Windows machine can easily have JAVA_HOME on a JRE that
# some other program installed while a JDK sits on PATH; build with that one
# rather than make anyone change what the other program relies on.
has_javac() { [ -x "$1/bin/javac" ] || [ -x "$1/bin/javac.exe" ]; }
if [ -n "${JAVA_HOME:-}" ] && ! has_javac "$JAVA_HOME"; then
  if command -v javac >/dev/null 2>&1; then
    jdk=$(dirname "$(dirname "$(command -v javac)")")
    # The JVM reads JAVA_HOME too, and on Windows it wants C:\ not /c/.
    if command -v cygpath >/dev/null 2>&1; then jdk=$(cygpath -w "$jdk"); fi
    echo "engine: JAVA_HOME ($JAVA_HOME) has no compiler; building with $jdk"
    JAVA_HOME=$jdk
    export JAVA_HOME
  else
    echo "engine: JAVA_HOME ($JAVA_HOME) is a Java runtime, not a JDK, and there is no javac on PATH. The engine needs JDK 21." >&2
    exit 1
  fi
fi

mkdir -p "$home/companion/src/main/kotlin"
rm -rf "$home/companion/src/main/kotlin/companion"
cp "$here/engine/build.gradle.kts" "$home/companion/build.gradle.kts"
cp -r "$here/engine/src/main/kotlin/companion" "$home/companion/src/main/kotlin/companion"
grep -q 'include(":companion")' "$home/settings.gradle.kts" || printf '\ninclude(":companion")\n' >> "$home/settings.gradle.kts"

cd "$home"
./gradlew :companion:installDist --no-daemon -q
echo "engine: built $home/companion/build/install/companion/bin/companion (Argentum $rev)"

if [ "${1:-}" = "--play" ]; then
  cd "$here"
  node scripts/engine-play.mjs
fi
