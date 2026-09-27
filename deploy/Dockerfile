# The app, the relay and the rules engine, served at one address (HANDOFF.md, M8).
#
#   docker build -f deploy/Dockerfile -t mtg-companion .                  # from the repository root
#   docker run -p 8788:8788 -v mtg-companion-rooms:/data mtg-companion   # then open http://localhost:8788/
#
# One process: `node scripts/relay-server.mjs`, which serves the built app, holds
# every room in its memory and on the volume at /data, and starts one engine JVM
# for each room the engine plays at (and one for checking decks). So it is one
# instance, never more: a second would hold rooms the first has never heard of.
#
# Three stages: the engine compiled with a JDK, the app built with Node, and a
# runtime holding only what the relay reads, the built app and the engine's
# install. The relay runs as the node user, who owns nothing but the rooms.
#
# What ships is built on bases named by major version, not by digest: `21-jre`
# takes each Temurin 21 update and `22-trixie-slim` each Node 22 release and
# Debian security fix as they are published, which for a service on the internet
# is the point, and nothing here would move a digest when a fix came out. The
# engine's JDK is the exception (below): it compiles, and is thrown away. Each
# build is proven whole by .github/workflows/image.yml before anyone deploys it.
# Java 21, the engine's own (engine/README.md); Node 22, what CI runs the app's
# suites on. Debian 13 (trixie) rather than the Node image's default 12
# (bookworm), whose regular security support ended on 2026-07-11
# (debian.org/releases, read 2026-09-26).

# --- the engine --------------------------------------------------------------
# Argentum at the pin with engine/ built into it, by the same script CI and every
# machine use; the pin is read from that script, never written here a second time.
# The layer is kept by Docker's own cache while its base, engine/ and the script
# are unchanged, and a change to any of them compiles it cold: Gradle, its
# dependencies and the whole corpus (280 s on the owner's machine with nothing
# cached, then 153 s for the other eras; PLAN.md, M9). So the base is pinned
# by digest, where a tag would move under it: `21-jdk-noble` was republished on
# 2026-09-25, and the first build after every such republish would compile cold
# for nothing, since this stage never ships and gains nothing from a newer JDK.
# The digest is the tag's multi-platform index as the registry gave it on
# 2026-09-26 (pushed 2026-09-25T23:24:57Z); moving it is a change like any other,
# proven by image.yml, and is the owner's to make when a newer JDK is wanted.
FROM eclipse-temurin:21-jdk-noble@sha256:d0aa6704a67ac080591815bb7734dbe56171dd7a8e9b767e9989b95dd37b3085 AS engine
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# Only what the build reads, so a change to the app does not rebuild the engine.
COPY scripts/engine-build.sh scripts/engine-build.sh
COPY engine/build.gradle.kts engine/build.gradle.kts
COPY engine/src engine/src
ENV ENGINE_HOME=/argentum
RUN sh scripts/engine-build.sh

# --- the app -----------------------------------------------------------------
FROM node:22-trixie-slim AS app
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY public public
COPY src src
COPY scripts scripts
COPY deploy deploy
# Where the built app finds its relay. The image's app is served by the relay
# itself, whose public address is whatever the host names the service and is not
# known here, so by default the build says so: `same-origin`, the relay is the
# address the page came from (src/features/game/relayAddress.js). A person's own
# address, set in the seats panel, still wins.
ARG VITE_RELAY_URL=same-origin
# The commit the build says it is (vite.config.js's version.json); CI passes it.
ARG GITHUB_SHA=
RUN npm run build
# What the relay reads when it runs, traced from its imports (deploy/relay-files.mjs),
# and the image's own two scripts.
RUN node deploy/relay-files.mjs --copy /out \
 && mkdir -p /out/deploy \
 && cp deploy/healthcheck.mjs deploy/entrypoint.sh /out/deploy/

# --- the runtime -------------------------------------------------------------
FROM node:22-trixie-slim
# tini as the container's first process, as Node's own image documentation
# advises: Node was not written to be PID 1. The relay handles SIGTERM itself —
# tini passes it on — but only a PID 1 that reaps can collect a process orphaned
# under it, and when the relay exits, tini exits and the kernel ends everything
# left in the container (pid_namespaces(7)), so no engine JVM outlives it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*
# The Java 21 runtime, copied whole from Temurin's own image as Temurin documents
# for a base it does not publish; the engine needs no JDK to run.
ENV JAVA_HOME=/opt/java/openjdk
COPY --from=eclipse-temurin:21-jre-noble $JAVA_HOME $JAVA_HOME
ENV PATH="${JAVA_HOME}/bin:${PATH}"

WORKDIR /app
COPY --from=engine /argentum/companion/build/install/companion engine
COPY --from=app /out ./
COPY --from=app /src/dist dist
# The rooms' volume is mounted at /data. Given to the node user here, so a volume
# Docker creates for it starts as that user's; one a host mounts over it is given
# to that user as the container starts (deploy/entrypoint.sh). The image's files
# stay root's, and the relay can change none of them.
RUN mkdir -p /data/rooms && chown -R node:node /data

ENV NODE_ENV=production \
    ROOMS_DIR=/data/rooms \
    STATIC_DIR=/app/dist \
    ENGINE_CMD=/app/engine/bin/companion
# Each engine JVM's options, read by the launcher after its own -Xmx2g, so the
# later ceiling wins. Measured on a Commander game (PLAN.md, M8): a JVM's working
# set was 690-810 MB at a ceiling of 256 or 384 MB, the engine at intermediate or
# at hard, and 900-1,000 MB at 2 GB, most of it not heap. The corpus itself holds
# 128 MB, and 384 MB is three times that for a game's own growth: at hard, whose
# rollouts look furthest ahead, the heap never held more than 159 MB after a
# collection. A heap that runs out anyway ends the JVM at once, and the room
# starts it again from the last stop (M7), rather than limp on.
ENV COMPANION_OPTS="-Xmx384m -XX:+ExitOnOutOfMemoryError"
# PORT is left unset: the relay listens on 8788 then, and a host sets its own.
EXPOSE 8788

# /health answers at once; engine: true there means configured, not loaded
# (deploy/healthcheck.mjs).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "deploy/healthcheck.mjs"]
# docker stop's default, said here because the relay's shutdown hangs on it: every
# socket closed with 1012 and every room written, within three seconds.
STOPSIGNAL SIGTERM
# Started as root only to give the rooms' folder to node, then the relay as node,
# by the same process id (deploy/entrypoint.sh). Through sh, so the script needs
# no mode of its own from the checkout.
ENTRYPOINT ["/usr/bin/tini", "--", "sh", "/app/deploy/entrypoint.sh"]
CMD ["node", "scripts/relay-server.mjs"]
