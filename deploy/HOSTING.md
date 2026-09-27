# Hosting the relay

Prepared, not deployed (HANDOFF.md §3 item 5). No provider is chosen yet: the
owner decides with these notes in hand (HANDOFF.md §3 item 27). Three are covered — Fly.io,
Railway and Render — each from its own documentation, read on 2026-09-26 and
cited where it is used. Where a provider's pages were silent or unclear, that
is said rather than filled in. Nothing here has been deployed, and no account
was made. The notes agree with the image as it is built (`deploy/Dockerfile`),
the workflows that build it and the Pages app (`.github/workflows/image.yml`,
`.github/workflows/deploy.yml`) and the measurements in `PLAN.md`, "M8: hosting,
prepared"; where they differ, those are right and this is corrected.

The files beside this one:

| File | What it is |
| --- | --- |
| `Dockerfile` | The image: the built app, the relay and the engine in one. |
| `entrypoint.sh` | The image's first command: the rooms' folder given to the `node` user, then the relay run as that user. |
| `fly.toml` | Fly.io's configuration. **An example until the owner chooses.** |
| `railway.toml` | Railway's configuration. **An example until the owner chooses.** |
| `render.yaml` | A Render Blueprint. **An example until the owner chooses.** |

Once a provider is chosen, the other two example files can go.

---

## 1. What the service is, and what it needs

One Node process, `node scripts/relay-server.mjs`, serves three things at one
address: the built app (`STATIC_DIR`), the relay (tables in rooms, over
WebSockets at `/rooms/<code>/ws`), and the rules engine. Each room the engine
holds runs one engine process, a JVM holding the whole card corpus; one more is
kept for checking decks (`POST /engine/check`) and let go after ten idle
minutes.

The container starts as root only long enough to make the rooms' folder and give
it to the `node` user (uid 1000), then runs the relay as that user by the same
process id, and every engine JVM the relay starts runs as it too
(`deploy/entrypoint.sh`). The image's own files stay root's. Everything the relay
reads is set in the image, so a provider needs to set none of it:

| Variable | In the image | What it is |
| --- | --- | --- |
| `ROOMS_DIR` | `/data/rooms` | Where every table is written; `/data` is the volume. |
| `STATIC_DIR` | `/app/dist` | The built app, made with `VITE_RELAY_URL=same-origin`. |
| `ENGINE_CMD` | `/app/engine/bin/companion` | The engine's POSIX launcher. |
| `COMPANION_OPTS` | `-Xmx384m -XX:+ExitOnOutOfMemoryError` | Each engine JVM's options, read by the launcher after its own `-Xmx2g`, so the image's ceiling holds (§2). |
| `NODE_ENV` | `production` | |
| `PORT` | not set | The provider's own; the relay listens on 8788 without it. |

What any host must give it, and why:

1. **One instance, never more.** Rooms live in this process's memory and on its
   volume. A second instance would hold other rooms, and a person routed to it
   would find the table gone. All three providers keep a service with a volume
   to one instance, each in its own way (below).
2. **A persistent volume at `/data`.** The relay writes every table there
   (`/data/rooms`): board rooms as JSON, engine rooms as the engine's own text
   of the game, gzipped, after every stop (M7). Without a volume a deploy loses
   every table; with one, a deploy is a pause. Whoever owns the volume when it
   is mounted, the entrypoint gives `/data/rooms` to `node` (§8, 1).
3. **WebSockets, with any idle timeout of sixty seconds or more.** The relay
   pings every socket every thirty seconds and cuts one that does not answer,
   so a proxy never sees a connection idle for longer than that.
4. **A health check at `/health`**, which answers `{ ok, rooms, engine }` as
   soon as the process listens. `engine: true` means an engine launcher was
   found, not that a corpus is loaded: the check says the relay is up, and
   nothing about the 22–32 s an engine takes to load (§2). Measured on the
   owner's machine (Windows, Node 26.9.0, five starts with no rooms kept,
   `/health` asked every 20 ms): the first answer came 120–137 ms after the
   process started.
5. **SIGTERM, and three seconds before anything harder.** On SIGTERM (or
   SIGINT) the relay writes every room, stops taking connections, closes every
   socket with 1012 ("back in a moment", which the app answers by
   reconnecting) and exits; it forces its own exit at three seconds. A host
   that kills it sooner loses what was not yet written.
6. **A port.** The relay listens on `PORT`, 8788 when unset, on every address
   (Node's default when no host is given).
7. **HTTPS in front.** The GitHub Pages app is served over HTTPS, so the relay
   it talks to must be too. All three providers terminate TLS for their own
   subdomain and for a custom domain.
8. **Memory for every engine JVM at once, and CPU to load them** (§2). The relay
   waits 120 s for a new engine's first answer (`STARTUP_MS` in
   `scripts/relay-engine.mjs`), which comes only once the corpus has loaded, and
   gives up on an engine that has not answered by then.
9. **Started as root**, which is Docker's default for an image that names no
   user, as this one does not. A host that started it as another user would
   have the relay started as that user, with the volume as it came.

---

## 2. Memory, and CPU

Memory is what decides the size, and it is the engine, not the relay, that
uses it. Measured on the owner's machine (Windows 11, a Ryzen 5 5600X with 12
threads, 64 GB; Microsoft's OpenJDK 21.0.12; the engine at its pin, protocol 11,
13,242 cards), from outside the JVM, as the working set — the Windows
counterpart of the resident set Docker counts. How each was taken is in PLAN.md,
M8, "Measured on the owner's machine" and "What the review found".

| What | Measured |
| --- | --- |
| The relay, idle, no rooms | 52 MB (Node 26.9.0, five samples); 54–58 MB laid out as the image lays it out |
| One engine JVM, a Commander game played to its end, the engine at intermediate, with the image's `-Xmx384m` | 713 and 743 MB (two runs) |
| The same at `-Xmx256m` | 690–711 MB |
| The same, the engine at hard, with the image's `-Xmx384m` | 760 and 808 MB; two at once, 792 and 743 MB (1,535 MB together) |
| The heap itself at `-Xmx384m`, from the JVM's own log: the most held after a collection | 141–159 MB at hard, 155 MB at intermediate; the corpus alone 127–128 MB |
| At the launcher's own `-Xmx2g` | 898 and 1,001 MB (Commander); 1,031 MB (a sixty-card goblin game) |
| Native memory tracking at `-Xmx256m`, committed at exit (the goblin game) | 728 MB: heap 256, Metaspace 181 + class space 42 (77,203 classes: the card corpus), GC 61, Compiler 48, Symbol 37, Code 36, Arena 21 |
| The corpus loading, as the engine times it (its first answer about a second later) | 21.8–28.0 s alone; 28.8–29.7 s two at once; 32.4 s with the JVM held to one processor |
| The relay's whole process tree through `tests/browser/hosted.spec.mjs` | 754 MB with the deck checker's JVM; 1,427 MB with a room's too; 2,096 MB with a second room; 1,382 MB started again with two engine rooms kept, both loading |

Every game finished. So the heap ceiling moves only the heap: **each engine
JVM costs 690–810 MB with the image's options**, at intermediate or at hard, and
900–1,030 MB at the launcher's default of 2 GB. The rest is the corpus's classes
and the JVM's own machinery. These are Windows working sets; a Linux container's
resident size was not measured here (`image.yml` records `docker stats` for the
running image on every run), and the operating system's own share of a machine
was not measured either, so the counts below are ceilings, not targets.

**What holds a JVM.** At M8:

- The deck checker, from the first deck the lobby asks about until ten minutes
  pass with nothing to check (`CHECK_IDLE_MS`). The lobby asks before anybody
  sits, so a game begins with the checker up.
- Every room the engine holds, from the first person sitting down until the
  room is dropped: seven days with nobody in it and nothing done (`IDLE_MS`),
  or the relay stopping. A room keeps its JVM after its game has ended and
  after everybody has left. **So what sizes the machine is not the games being
  played now but the engine rooms opened in the last week.** M8 did not change
  this; whether a room nobody is in should let its engine go, and take its game
  back when somebody sits, is the owner's (HANDOFF.md §6).
- **After a restart** — every deploy is one — the relay starts an engine at
  once for every kept room whose game had not ended (HANDOFF.md §3 item 21),
  so the corpus is loading in all of them together while their people find
  their way back. A game that had ended is taken back only when somebody sits
  down to look at it. The machine must hold every such room at once, plus the
  checker when the lobby next asks. What each provider does when memory runs
  out was not read, nor tested here: a process is ended to free memory, and
  which one (an engine, or the relay itself, which would then restart and try
  again) is not in the relay's hands. An engine that runs out of its own heap
  ends at once (`ExitOnOutOfMemoryError`), and its room starts it again from
  the last stop (M7).

**How many fit.** At 810 MB for each JVM (the top of the measurements, at
hard, the careful figure) and 52 MB for the relay, before the operating
system's share:

| Memory | JVMs that fit | Engine games at once, with the deck checker up | Were `COMPANION_OPTS` emptied, leaving the launcher's `-Xmx2g` (1,031 MB each) |
| --- | --- | --- | --- |
| 1 GB | 1 | none: a game needs the checker and its room together | none |
| 2 GB | 2 | 1 | none with the checker up; 1 without it |
| 4 GB | 4 | 3 | 2 |
| 8 GB | 10 | 9 | 6 |

"Engine games" counts rooms as above: every engine room opened in the last
week, not only those being played. A table played by hand, without the
engine, holds no JVM: it is the board model in the relay's own memory (not
measured separately). The example files ask for 2 GB, the smallest that holds
one engine game with its check; that is a starting point, and the owner's to
change.

**CPU.** A JVM loading the corpus is the one heavy thing the service does. On
the owner's desktop it took 21.8–28.0 s with twelve threads to use, and 32.4 s
with the JVM held to one processor (`-XX:ActiveProcessorCount=1`); every such
load after a restart happens at once, one per kept room, and each must answer
within the relay's 120 s. On a CPU the host shares out by quota, a load can take
far longer: Fly's shared CPUs are the case read (§4). By those numbers a whole
CPU loads about three corpora at once inside 120 s; that is arithmetic, not a
run. Railway and Render do not say whether their CPUs are dedicated (§5, §6).

**Where memory is billed on use** (Railway, §5), the JVM options move the bill
directly: 900–1,030 MB a JVM at the launcher's default against 690–810 MB at
the image's.

---

## 3. Building and running it locally

The owner's machine has no Docker, so none of this was run here; it is the
contract the image is built to, which `.github/workflows/image.yml` builds and
runs on every change to what goes into it. From the repository root:

```bash
docker build -f deploy/Dockerfile -t mtg-companion .
docker volume create mtg-companion-rooms
docker run --rm --name mtg-companion -p 8788:8788 \
  -v mtg-companion-rooms:/data mtg-companion
```

Then `http://localhost:8788/` serves the app, the relay and the engine at one
address, and `http://localhost:8788/health` answers
`{"ok":true,"rooms":0,"engine":true}`. The relay says
`relay on :8788, N room(s) back from disk` when it is listening. No `--user`:
the container starts as root and the entrypoint runs the relay as `node`. To try
a provider's size, `docker run --memory 2g …` caps the container's memory
(Docker's documentation: https://docs.docker.com/engine/containers/resource_constraints/,
read 2026-09-26). `docker stop mtg-companion` sends SIGTERM and, after a grace
period of 10 seconds for a Linux container, SIGKILL
(https://docs.docker.com/reference/cli/docker/container/stop/, read
2026-09-26) — more than the relay's three. Started again with the same volume,
the relay brings its rooms back.

**Building on a provider.** The image's first stage compiles the engine: it
fetches Argentum at the pin and runs `scripts/engine-build.sh`, on Temurin's
JDK 21 pinned by digest. Argentum's own Gradle settings give the Gradle daemon a
2 GB heap and the Kotlin compiler's daemon a 6 GB one (`../argentum/gradle.properties`).
A provider's builder with less memory than that may fail the build. Render's
builder has 8 GB (§6); Fly's and Railway's builder sizes were not stated on
the pages read. The stage uses no cache mount, so no provider's rules for cache
mounts apply; where a builder keeps Docker's layer cache, the engine's layer is
reused while its base, `engine/` and the build script are unchanged, and
compiled cold otherwise (280 s on the owner's machine, PLAN.md, M9). If a
provider's build fails for memory, each of the three can run an image built
elsewhere instead: `fly deploy --image`, a Railway service from a Docker image,
a Render service from a prebuilt image. `image.yml` pushes nothing anywhere —
it builds and proves the image in the runner and throws it away — so that
means a machine with Docker pushing to a registry the provider can pull from,
which is the owner's to set up.

**What goes into the build context.** All three build with the repository
root as the context. The root `.dockerignore` leaves everything out and lets
back in only what the build reads: `package.json`, `package-lock.json`,
`index.html`, `vite.config.js`, `src/`, `public/`, `scripts/`, `engine/` and
`deploy/`. Fly sends the folder on the owner's disk, and flyctl reads the ignore
file from the working directory, the root; Railway and Render build from a clone
of the branch, and Render's page names the root `.dockerignore` too. Docker also
reads an ignore file named after the Dockerfile and placed beside it
(`deploy/Dockerfile.dockerignore`), which then takes precedence over the root
one (https://docs.docker.com/build/concepts/context/, read 2026-09-26); there is
none, and none of the three providers' pages read mentions it.

---

## 4. Fly.io

Fly runs the image in a Firecracker VM (a "Machine") behind its own proxy,
with a volume on the same server. It is driven from `flyctl` on the owner's
machine, and builds on Fly's remote builder by default, so no local Docker is
needed. Fly's documentation moved from `fly.io/docs` to `docs.fly.io`; the
old addresses redirect.

### Settings that matter here

| Point | What Fly does | In `deploy/fly.toml` |
| --- | --- | --- |
| Dockerfile outside the root | `[build] dockerfile` takes a relative path; the build context stays the working directory. flyctl resolves the path against the folder the `fly.toml` is in, and it wins over `--dockerfile`. | `dockerfile = "Dockerfile"`, run from the root with `--config deploy/fly.toml` |
| Port | Fly does not set `PORT`. `internal_port` (default 8080) must be the port the app listens on. | `internal_port = 8788`, `PORT = "8788"` |
| Volume | One volume attaches to one Machine, lives on one server in one region, is not replicated, and is snapshotted daily (kept 5 days by default). Default 1 GB. Who owns a fresh one is not stated; the image does not need to know (§8, 1). | `[mounts]` `source = "rooms"`, `destination = "/data"` |
| One instance | A first deploy with a volume mounted creates only one Machine. `fly scale count` would add Machines with new, **empty** volumes; never do it here. | — |
| Deploys | Rolling by default; canary and blue-green are not allowed with volumes. A single Machine means a gap while it is replaced. | default strategy |
| Stopping | Sends `kill_signal` (default **SIGINT**), waits `kill_timeout` (default 5 s, at most 300, "best-effort"), then forces the stop. The same on deploy, `fly machine stop` and autostop. | `kill_signal = "SIGTERM"`, `kill_timeout = 10` |
| WebSockets, idle timeout | `[http_service.http_options] idle_timeout` exists (the example value on the page is 600); the default is not stated on the pages read. The relay's 30 s ping keeps a socket busy either way. | not set |
| Health check | `[[http_service.checks]]` with `grace_period`, `interval`, `timeout`, `path`; a 2xx passes. A failing check stops traffic reaching the Machine but does not restart it. Smoke checks watch a new Machine for about 10 s after it starts. | `/health`, grace 10 s |
| Sleeping | A first deploy turns autostop on for a service by default. Off, the Machine runs until told otherwise. | `auto_stop_machines = "off"`, `auto_start_machines = false` |
| CPU | Two kinds. A **shared** CPU runs at a baseline of 6.25% of its time (5 ms in every 80 ms), bursting to 100% while it has a burst balance: 5 s for a new Machine, up to 500 s, earned back while it runs below the baseline; spent, "the vCPU is limited to running at its baseline quota". A **performance** CPU's baseline is 100%. | `performance-1x` |
| Memory | Shared: 256 MB to 2 GB per CPU, in steps of 256 MB (`shared-cpu-1x` up to 2 GB, `-2x` 4 GB, `-4x` 8 GB). Performance: 2 to 8 GB per CPU, in steps of 2 GB (`performance-1x` 2, 4 or 8 GB). `[[vm]]` in the file is re-applied at every deploy. | `2gb` |
| Restarts | A Machine that exits with a non-zero code is restarted (`on-failure` is the default policy). | default |

**Why a performance CPU.** Arithmetic on Fly's own numbers, not a run on Fly: a
new shared-CPU Machine can run flat out for 5/(1 − 0.0625) = 5.3 s — the page's
own formula for its burst — and then gets 6.25% of the rest, 7.2 s in the 114.7 s
left of the relay's 120 s: about 12.5 s of CPU, against the 27–32 s one corpus
load took of one desktop CPU (§2). At the baseline alone one load would take
about 27/0.0625 = 430 s. So an engine on a fresh shared Machine would not answer
in time, and after a restart every kept room's engine would share that one
quota. Whether a deploy gives a Machine a new balance is not stated; a Machine
left idle long enough earns up to 500 s, which would carry several loads. The
example asks for `performance-1x` with 2 GB, which has no quota to spend; a
shared CPU is the owner's to try, knowing that.

**Stopping versus suspending.** With autostop set to `"stop"`, Fly's proxy
stops a Machine when the app has "excess capacity", checking every few
minutes; the next request starts it again. Stopped, it keeps its volume but
loses its memory. The Machine's own cold start comes first (about 2 s or more
for common apps, Fly's suspend page says), then the relay answers within a
fraction of a second (§1) — but every kept room's engine reloads the corpus at
once (§2), and the first deck check waits for a load. With `"suspend"`,
memory is kept and a resume takes "a few hundred ms" — but only for Machines
of 2 GB or less with no swap, the saved state is thrown away by every deploy,
and none of the pages read says whether an open WebSocket counts as traffic
that keeps a Machine up. The example keeps the Machine running; either saving
is the owner's to weigh against that.

### Deploying, step by step

From the repository root, in PowerShell on the owner's machine:

1. Install flyctl — `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"`,
   or with `powershell` in place of `pwsh` where PowerShell 7 is not installed
   — and sign in with `fly auth login`. Fly needs a credit card on file for
   every organisation.
2. Create the app: `fly apps create <name>` (the name becomes
   `<name>.fly.dev`). Put that name in `deploy/fly.toml`'s `app` line, and a
   region from `fly platform regions` in `primary_region`.
3. Create the volume in that region: `fly volumes create rooms --region <region> --size 1 -a <name>`.
   One volume and no second is the point here, whatever Fly's pages advise
   for apps that replicate their own data.
4. Deploy: `fly deploy --config deploy/fly.toml --ha=false`. The remote
   builder builds `deploy/Dockerfile` with the repository as its context; the
   first deploy gives the app a shared IPv4 address and an IPv6 one.
5. Check it: `fly status -a <name>`, `fly logs -a <name>` (the relay's line
   `relay on :8788, 0 room(s) back from disk`), and `https://<name>.fly.dev/health`.
   To see an engine start in the Machine's memory, ask for a deck check and
   wait about half a minute. In Git Bash (in Windows PowerShell 5.1, `curl`
   is another command):
   `curl -s -X POST https://<name>.fly.dev/engine/check -H 'content-type: application/json' -d '{"deck":{"Mountain":20}}'`.
   It answers with the engine's count of the cards it knows, and keeps a JVM
   up for ten minutes afterwards.
6. A custom domain, if wanted: `fly certs add <host>`, then the DNS records it
   prints (A and AAAA, or a CNAME for a subdomain).
7. Every later deploy is step 4 again: Fly deploys only when told. To change
   the size, edit `[[vm]]` and deploy.

### Traps

- **Fly builds what is on the disk,** not what is pushed: the working
  directory is the build context, uncommitted changes and all (the
  `.dockerignore` still keeps out everything the build does not read).
- **`fly scale count 2` would split the tables** between two Machines with two
  unrelated volumes. So would `fly machine clone`, whose new volume starts
  empty.
- **A shared CPU would time the engine out after a start** (above): changing
  `[[vm]]` to a `shared-cpu-*` size saves money and may cost every engine game.
- **The default stop signal is SIGINT**, and the page describing the sequence
  says that after `kill_timeout` "it sends SIGTERM unconditionally" — as
  written; read as the forced stop. The relay treats SIGINT and SIGTERM alike,
  so either way it writes its rooms.
- **A volume is on one server.** If that server is lost, the app waits for it
  or is restored from a snapshot (daily, kept five days by default).
- **`fly scale memory` is undone by the next deploy** while `[[vm]]` is in the
  file.

### What it costs (read 2026-09-26)

From https://docs.fly.io/about/pricing/, whose table is priced per region
(read at `iad` and `lhr`), for a Machine started for 30 days: `shared-cpu-1x`
with 2 GB, $10.70 (iad) / $12.14 (lhr); `shared-cpu-2x` with 4 GB, $21.40 /
$24.28; `shared-cpu-4x` with 8 GB, $42.79 / $48.55. `performance-1x` with 2, 4
and 8 GB: $31.00 / $41.01 / $61.02 (iad), $35.17 / $46.53 / $69.23 (lhr) —
computed from the constants the page itself prices with (a performance CPU
$0.00001196 a second with 2 GB included, memory beyond it $0.00000193 per GB a
second, 2,592,000 seconds, and `lhr`'s markup of 1.134615385), which give the
shared figures above to the cent. Volumes $0.15 per GB per month, whether
attached or not; snapshots $0.08 per GB per month after the first 10 GB. A
shared IPv4 address comes with the app; the first ten single-hostname
certificates in an organisation are free, then $0.10 a month each. Outbound
data is billed by region group.

### Sources read, 2026-09-26

- https://docs.fly.io/reference/configuration/ — `[build] dockerfile` (relative path; context stays the project root), `[build.args]` not available at runtime, `kill_signal` (SIGINT by default; SIGTERM among the allowed), `kill_timeout` (5 s default, 300 max, best-effort; the shutdown sequence and when it applies), `[http_service]` fields and defaults, `idle_timeout`, `[[http_service.checks]]` (run over the private network; 2xx passes), `[mounts]`, `[[vm]]` (re-applied at deploy), the restart policy's `on-failure` default, `swap_size_mb`, deploy strategies (no canary or blue-green with volumes).
- https://docs.fly.io/launch/monorepo/ — the working directory is the build context; `--config` and `--dockerfile` are relative to it.
- https://github.com/superfly/flyctl, `internal/command/deploy/deploy_build.go` at `b517d0e` (2026-09-26) — `resolveDockerfilePath` and `resolveIgnorefilePath` join a path from `fly.toml` to that file's folder, and prefer it to the command-line flag; `internal/command/command.go` — only the first argument changes the working directory.
- https://docs.fly.io/flyctl/deploy/ — `--config`, `--dockerfile`, `--ha`, `--image`, `--remote-only` (the default), `--depot`.
- https://docs.fly.io/volumes/overview/ — one volume per Machine, one server in one region, no replication, daily snapshots kept 5 days, 1 GB default, single-Machine deploys have downtime.
- https://docs.fly.io/launch/volume-storage/ — `[mounts]`, `fly volumes create`, `/` not allowed as a destination.
- https://docs.fly.io/flyctl/volumes-create/ — `--region`, `--size` (default 1), `--snapshot-retention` (default 5).
- https://docs.fly.io/apps/app-availability/ — a first deploy creates one Machine when volumes are mounted; `--ha=false`; services get autostop by default.
- https://docs.fly.io/launch/deploy/ — the strategies, smoke checks for about 10 s, a mounted volume cannot be swapped by a deploy.
- https://docs.fly.io/launch/scale-count/ — scaling with volumes creates or attaches volumes without copying data; a cloned Machine's volume is empty.
- https://docs.fly.io/launch/autostop-autostart/ — the stop loop runs every few minutes; `min_machines_running` counts the primary region only; how to switch both off.
- https://docs.fly.io/reference/suspend-resume/ — suspend needs 2 GB or less and no swap; a deploy discards the saved state; resume in a few hundred ms.
- https://docs.fly.io/reference/health-checks/ — a failing check stops routing, never restarts.
- https://docs.fly.io/machines/cpu-performance/ — the quotas: shared, an 80 ms period with a 5 ms (6.25%) baseline, an initial burst balance of 5 s and a maximum of 500 s, limited to the baseline once the balance is spent, and the burst formula `500/(1-.0625)`; performance, 80 ms of 80 ms (100%). Nothing on whether a deploy resets the balance.
- https://docs.fly.io/machines/guides-examples/machine-sizing/ — 2 GB per shared CPU at most, 256 MB steps; 2 to 8 GB per performance CPU, 2 GB steps.
- https://docs.fly.io/machines/runtime-environment/ — the variables Fly sets (`FLY_*`, `PRIMARY_REGION`); `PORT` is not among them.
- https://docs.fly.io/networking/services/ — a shared IPv4 address on the first deploy of an `[http_service]`.
- https://docs.fly.io/networking/custom-domain/ — `fly certs add`, A/AAAA or CNAME records.
- https://docs.fly.io/monitoring/logging-overview/ — logs are the app's stdout; `fly logs`; search keeps 7 days.
- https://docs.fly.io/reference/regions/ — the regions (among them `ams`, `arn`, `cdg`, `fra`, `lhr` in Europe).
- https://docs.fly.io/flyctl/install/ — the Windows install command.
- https://docs.fly.io/deep-dive/ and https://docs.fly.io/app-guides/6pndemochat — WebSockets named among what Fly provides, and a bare-WebSocket Node app run on it; no reference page states the proxy's WebSocket behaviour.
- https://docs.fly.io/about/pricing/ — the prices above, and the per-second constants, the presets and the regions' markups the page prices with.

---

## 5. Railway

Railway builds from the GitHub repository and runs the image as a service,
billed on the memory and CPU it actually uses. It is driven from the web
dashboard; no command line is needed.

### Settings that matter here

| Point | What Railway does | In `deploy/railway.toml` |
| --- | --- | --- |
| Dockerfile outside the root | `dockerfilePath` (or the `RAILWAY_DOCKERFILE_PATH` variable). The service's root directory (default `/`) is what Railway pulls. | `dockerfilePath = "deploy/Dockerfile"` |
| The config file | `railway.toml` at the root is read by default; another path is set in the service's settings, as an absolute path. Code overrides the dashboard. | set the path to `/deploy/railway.toml` |
| Which commits deploy | Watch paths: gitignore-style patterns, from the repository root even with a root directory set; a commit changing nothing they match does not deploy. | `watchPatterns`: what the root `.dockerignore` lets in, less `deploy/*.md` |
| Port | Railway sets `PORT`, uses it for health checks, and detects the port for the generated domain. | — |
| Volume | Made in the dashboard and attached to one service at a mount path. One volume per service. Mounted at start, not during the build. **Mounted as root**; the entrypoint gives the rooms' folder to `node` (§8, 1). Scheduled backups daily, weekly or monthly. | mount at `/data` in the dashboard |
| One instance | "Replicas cannot be used with volumes." | `numReplicas = 1` |
| Deploys | Two deployments are never mounted on one volume, so a redeploy has "a small amount of downtime". Railway also redeploys on its own to move a service between hosts. | — |
| Stopping | SIGTERM, then SIGKILL after the draining time — **0 seconds by default**. | `drainingSeconds = 10` |
| WebSockets, idle timeout | WebSockets over HTTP/1.1 are exempt from the duration and inactivity limits and "can stay open indefinitely, even while idle". Idle HTTP/1.1 connections close after 60 s. | — |
| Health check | Asked only while a deploy goes live, until a 2xx; five minutes by default; never afterwards. Requests come from `healthcheck.railway.app`. | `/health`, 300 s |
| Sleeping | Serverless is opt-in; services are long-running by default. A slept service wakes on a request, and that request may get a 502. | `sleepApplication = false` |
| Memory and CPU | No size to pick: a service grows to the plan's limit, or to a Replica Limit set in its Deploy settings. The plans' limits "include replica multiplication": Trial 1 GB and 2 vCPU, Free 0.5 GB and 1 vCPU — too small for one engine game (§2) — Hobby 48 GB and 48 vCPU, Pro 1 TB and 1,000 vCPU; the per-replica figure for Hobby is not stated on the pages read (Pro's is 24 GB). Whether a vCPU is dedicated, shared or throttled is not stated either. | — |
| Region | Four, by identifier; the account's preferred one unless chosen. The regions page says an identifier "can be used in your Config as Code file", and Railway's schema has `deploy.region`. | `region`, commented out |
| Restarts | On Failure, 10 retries by default; paid plans may choose any. | `ON_FAILURE` |

### Deploying, step by step

1. Make an account at railway.com and choose the Hobby plan; the Trial and
   Free plans' memory holds no engine game (§2). Railway requires a post-paid
   card.
2. Make a project, and in it **+ New → GitHub Repo**:
   `rporter33/mtg-companion`, branch `main`.
3. In the service's **Settings**, set the config-as-code path to
   `/deploy/railway.toml`. Leave the root directory at `/`.
4. Add a volume (from the command palette, or a right-click on the project
   canvas), attach it to the service, mount path `/data`.
5. **Settings → Networking → Public Networking → Generate Domain.** Railway
   detects the one port the relay listens on (the `PORT` it set). The address
   is `https://<something>.up.railway.app`.
6. Choose the region before the volume holds anything — moving a service with
   a volume means migrating the volume, with downtime while it moves: in the
   service's settings, or by uncommenting `region` in `deploy/railway.toml`
   (`us-west2`, `us-east4-eqdc4a`, `europe-west4-drams3a` or
   `asia-southeast1-eqsg3a`). Railway's reference page does not describe what
   `deploy.region` does beyond the schema's naming it, so the dashboard is the
   documented way.
7. Deploy (it deploys on a push that changes what goes into the image, or from
   the dashboard), and read the deploy's logs for
   `relay on :<port>, 0 room(s) back from disk`. Then `/health`, and a deck check
   as in §4 step 5.
8. Optional: **Wait for CI** in the service's settings, so a commit deploys
   only after its GitHub Actions workflows pass (`deploy.yml` runs on every
   push to `main`, which is what the option needs).
9. Optional: a Replica Limit on memory, to cap the bill (§2); set below what
   the kept rooms need, the service crashes instead.
10. A custom domain, if wanted: **+ Custom Domain**, then both the CNAME and
    the TXT record Railway gives. Hobby allows two custom domains per service.

### Traps

- **The draining time defaults to zero.** Without `drainingSeconds` (or
  `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`), the relay is killed the moment it is
  asked to stop, and whatever it had not yet written is lost.
- **The volume is root's**, and Railway's pages say images running as a
  non-root user "will have permissions issues" on it, giving `RAILWAY_RUN_UID=0`
  — run the process as root — as the fix. This image needs no fix: it starts as
  root already and hands the rooms' folder to `node` itself (§8, 1). Leave
  `RAILWAY_RUN_UID` unset.
- **Memory is billed as used,** so an engine room nobody is playing costs
  690–810 MB for as long as it is kept (§2), and a restart that brings back
  every kept room at once is billed for all of them.
- **A service variable named like one of the Dockerfile's `ARG`s reaches the
  build** (Railway passes its variables to the `ARG`s a Dockerfile declares).
  The image declares `VITE_RELAY_URL` and `GITHUB_SHA`; leave both unset on the
  service. `VITE_RELAY_URL` set there would change where the image's own app
  looks for its relay.
- **The config file does not follow the root directory:** its path is always
  from the repository's root, and so are the watch patterns.
- **Start Node directly,** never through npm: Railway's own troubleshooting
  says a package manager swallows SIGTERM. The image's `CMD` does, and the
  entrypoint `exec`s it.

### What it costs (read 2026-09-26)

From https://docs.railway.com/pricing/plans: Hobby $5 a month, including $5 of
use; Pro $20 a month, including $20. Use: memory $10 per GB per month, CPU $20
per vCPU per month, egress $0.05 per GB, volumes $0.15 per GB per month,
metered by the minute. Builds are free. As arithmetic on those prices and §2's
measurements, not a quotation: one engine JVM held for a month at 690–810 MB is
about $7–8 of memory, the relay about $0.50; CPU use was not measured.

### Sources read, 2026-09-26

- https://docs.railway.com/builds/dockerfiles — a Dockerfile at the root of the source directory; `RAILWAY_DOCKERFILE_PATH`; variables reach the build through the `ARG`s a Dockerfile declares.
- https://docs.railway.com/config-as-code — `railway.toml`/`railway.json`; a custom path, absolute, set in the service's settings; code overrides the dashboard.
- https://docs.railway.com/config-as-code/reference and https://railway.com/railway.schema.json (served from `backboard.railway.app/railway.schema.json`) — `builder`, `dockerfilePath`, `watchPatterns`, `healthcheckPath`, `healthcheckTimeout`, `restartPolicyType`, `overlapSeconds`, `drainingSeconds`, `numReplicas`, `sleepApplication`, `region` (a string, in the schema only) and `multiRegionConfig`, and their types.
- https://docs.railway.com/builds/build-configuration — watch paths: gitignore-style, from `/` even with a root directory set, negation only after an including rule, and a commit matching none skips the deploy; the root directory is what Railway pulls.
- https://docs.railway.com/deployments/monorepo — the config file does not follow the root directory.
- https://docs.railway.com/volumes — creating and attaching a volume; mounted at start, not at build; mounted as root; `RAILWAY_RUN_UID=0`.
- https://docs.railway.com/volumes/reference — sizes by plan (Hobby 5 GB), one volume per service, no replicas with volumes, downtime on redeploy, billing.
- https://docs.railway.com/volumes/backups — daily (kept 6 days), weekly (27), monthly (89).
- https://docs.railway.com/deployments/healthchecks — asked only at deploy; `PORT`; 300 s default; `healthcheck.railway.app`; downtime with a volume.
- https://docs.railway.com/deployments/reference — SIGTERM, then SIGKILL after 0 s by default; one deploy per service; Railway-initiated redeploys.
- https://docs.railway.com/deployments/deployment-teardown and https://docs.railway.com/variables/reference — overlap and draining times, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` (default 0), `RAILWAY_RUN_UID`.
- https://docs.railway.com/deployments/restart-policy — On Failure with 10 retries by default.
- https://docs.railway.com/deployments/serverless and https://docs.railway.com/overview/advanced-concepts — sleeping is opt-in; long-running by default; a woken service's first request may 502.
- https://docs.railway.com/networking/public-networking/specs-and-limits — WebSockets exempt from the limits; idle HTTP/1.1 closed after 60 s; TLS 1.2 and 1.3; certificates.
- https://docs.railway.com/networking/domains/working-with-domains — CNAME and TXT; domains per plan; target ports.
- https://docs.railway.com/pricing/plans — plans, their limits "including replica multiplication", prices; nothing on whether CPU is shared.
- https://docs.railway.com/deployments/scaling and https://docs.railway.com/guides/right-size-cpu-memory — vertical growth to the plan's limit; Pro 24 GB per replica; Replica Limits.
- https://docs.railway.com/deployments/regions — four regions and their identifiers (California `us-west2`, Virginia `us-east4-eqdc4a`, Amsterdam `europe-west4-drams3a`, Singapore `asia-southeast1-eqsg3a`), usable in config as code; the preferred region by default; moving a service with a volume migrates the volume, with downtime.
- https://docs.railway.com/observability/logs — retention (Hobby 7 days, Pro 30); 500 lines a second per replica; stderr shown as errors.
- https://docs.railway.com/deployments/github-autodeploys — Wait for CI and what it needs.
- https://docs.railway.com/deployments/troubleshooting/nodejs-sigterm-handling — start Node directly.
- https://docs.railway.com/services — deploying a Docker image instead of building.

---

## 6. Render

Render builds from the GitHub repository with BuildKit and runs the image as a
web service with a persistent disk, on a fixed-size plan. It is driven from the
dashboard, through a Blueprint (the example file) or by hand.

### Settings that matter here

| Point | What Render does | In `deploy/render.yaml` |
| --- | --- | --- |
| Dockerfile outside the root | `dockerfilePath` and `dockerContext`, both relative to the repository root. | `./deploy/Dockerfile`, context `.` |
| The Blueprint | `render.yaml` at the root by default; another path in the Blueprint Path field. | Blueprint Path `deploy/render.yaml` |
| Which commits deploy | `buildFilter`: `paths` to include and `ignoredPaths` to leave out, as globs "always relative to your repository root"; an ignored path wins over an included one. A manual deploy, or a change to the service's settings, deploys regardless. | what the root `.dockerignore` lets in, less `deploy/*.md` |
| Port | Must bind on `0.0.0.0`; `PORT` is 10000 by default, and Render usually detects another bound port. | — |
| Disk | Paid services only. Preserves only what is under its mount path. Snapshot every 24 hours, kept at least seven days. Can grow, never shrink. Who owns a fresh one is not stated; the image does not need to know (§8, 1). | `rooms` at `/data`, 1 GB |
| One instance | A service with a disk cannot be scaled. | `numInstances: 1` |
| Deploys | A disk turns zero-downtime deploys off: Render stops the old instance before starting the new, "a few seconds" without service. | — |
| Stopping | SIGTERM, then SIGKILL after the shutdown delay: 30 s by default, 1–300. | `maxShutdownDelaySeconds: 30` |
| WebSockets, idle timeout | No maximum duration; Render advises pings both ways (the relay pings every 30 s; the app reconnects on 1012). | — |
| Health check | Every few seconds, 5 s to answer, 2xx or 3xx. A new deploy goes live when it passes (cancelled after 15 minutes). A running instance failing for 15 s gets no traffic; for 60 s, it is restarted. | `healthCheckPath: /health` |
| Sleeping | Only Free web services are described as spinning down (after 15 minutes without traffic), and they have neither a disk nor enough memory. | paid plan |
| Memory and CPU | Fixed plans, named by both: `0.5c-512mb`, `1c-2g`, `2c-4g`, `2c-8g`, `4c-8g`, and larger. Whether a CPU is dedicated or shared is not stated. | `1c-2g` |
| Variables | Every variable set on a Docker service is also passed to the build as a build argument. | none needed |

### Deploying, step by step

1. Make an account at render.com. The Hobby workspace has no fee; the
   service's plan is paid (a disk needs one).
2. Before creating anything, decide the region and write it into
   `deploy/render.yaml` (`region:` — oregon, ohio, virginia, frankfurt or
   singapore), then commit and push: Render reads the Blueprint from the
   repository. The region cannot be changed afterwards; omitted, it is oregon.
3. **New → Blueprint**, **Connect** `rporter33/mtg-companion`, name the
   Blueprint, link `main`, and set the Blueprint Path to `deploy/render.yaml`.
   Review the one web service it describes, with its disk, and **Deploy
   Blueprint**. From then on, a push that changes the Blueprint file applies
   the change.
4. The first deploy builds `deploy/Dockerfile` with the repository as its
   context. Read its logs for `relay on :10000, 0 room(s) back from disk`, then
   `https://<name>.onrender.com/health`, and a deck check as in §4 step 5.
5. Later deploys follow `autoDeployTrigger: checksPass` and the build filter: a
   commit on `main` that changes what goes into the image deploys once its
   GitHub checks pass. `commit` deploys every such push at once; `off` leaves it
   to the dashboard.
6. A custom domain, if wanted, from the service's settings; Render issues and
   renews the certificate.

Without a Blueprint, the same by hand: **New → Web Service**, Language
**Docker**, Dockerfile Path `deploy/Dockerfile`, a paid instance type, under
**Advanced** a disk at `/data`, and in **Settings → Health Checks** the path
`/health`; the build filter is then set in the service's settings.

### Traps

- **The region is for life.** Moving means a new service and carrying the
  disk's files across by hand.
- **The build has the pipeline's memory and no more:** 8 GB on the Starter
  pipeline, where Argentum's two build daemons may ask for up to 8 GB of heap
  between them (§3); a build over its tier's memory fails. The Performance
  pipeline (Pro workspaces) has 64 GB. Untried either way.
- **Variables become build arguments.** Harmless unless the Dockerfile
  declares an `ARG` of the same name, when the variable changes the build. The
  image declares `VITE_RELAY_URL` and `GITHUB_SHA`; leave both unset on the
  service.
- **Binding:** Render's page says the service must bind on `0.0.0.0`. The
  relay binds Node's default, every address; that this satisfies Render was not
  tested.

### What it costs (read 2026-09-26)

From https://render.com/pricing: the Hobby workspace $0 a month plus compute,
Pro $25 a month plus compute. Web service plans a month: `0.5c-512mb` $7,
`1c-2g` $25, `2c-4g` $85, `2c-8g` $135, `4c-8g` $175. Disks $0.25 per GB per
month. Bandwidth: 5 GB a month included on Hobby, then $0.15 per GB. Build
minutes: 500 a month included on Hobby, then $5 per thousand.

### Sources read, 2026-09-26

- https://render.com/docs/docker — the Dockerfile Path field; variables passed as build arguments; BuildKit; `.dockerignore`; zero-downtime deploys.
- https://render.com/docs/blueprint-spec and https://render.com/schema/render.yaml.json — `runtime`, `dockerfilePath`, `dockerContext`, `plan` and its values, `region` (fixed at creation, oregon by default), `numInstances`, `healthCheckPath`, `maxShutdownDelaySeconds` (1–300, default 30), `autoDeployTrigger`, `buildFilter` (`paths` and `ignoredPaths`, globs relative to the repository root), `disk`; no scaling with a disk.
- https://render.com/docs/monorepo-support — build filters: included and ignored paths, ignored winning, relative to the repository root, the glob syntax, and manual deploys going ahead regardless.
- https://render.com/docs/infrastructure-as-code — the Blueprint Path field.
- https://render.com/docs/disks — paid services only; one instance; no zero-downtime deploys; daily snapshots kept at least seven days; no shrinking.
- https://render.com/docs/deploys — the zero-downtime sequence; SIGTERM and the 30 s shutdown delay; build timeout 120 minutes, start 15.
- https://render.com/docs/health-checks — timing, 15 s and 60 s thresholds, 15-minute deploy limit.
- https://render.com/docs/websocket — no maximum duration; pings; the shutdown window.
- https://render.com/docs/web-services — bind on `0.0.0.0`; `PORT` 10000 by default.
- https://render.com/docs/free — spin-down after 15 minutes; no disk.
- https://render.com/docs/regions — the five regions; no moving.
- https://render.com/docs/custom-domains — automatic certificates.
- https://render.com/docs/logging — retention (Hobby 7 days, Pro 14).
- https://render.com/docs/build-pipeline — Starter 2 CPU and 8 GB; Performance 16 CPU and 64 GB; 16 GB of disk.
- https://render.com/docs/deploying-an-image — prebuilt images, GitHub's registry among them; no auto-deploys.
- https://render.com/docs/environment-variables — available at build and at runtime.
- https://render.com/pricing — the prices above, and each plan's CPUs and memory; nothing on whether a CPU is dedicated.

---

## 7. The three side by side

Facts only, as read on 2026-09-26; the choice is the owner's.

| | Fly.io | Railway | Render |
| --- | --- | --- | --- |
| Driven from | `flyctl` on the owner's machine | The dashboard | The dashboard, or a Blueprint |
| Builds from | The folder on disk, on Fly's remote builder (size not stated) | The GitHub branch (builder size not stated) | The GitHub branch, 2 CPU and 8 GB on the Starter pipeline |
| Deploys | When the owner runs `fly deploy` | On a push that changes what goes into the image, after CI with **Wait for CI** | On a push that changes what goes into the image, after CI with `checksPass` |
| Port | No `PORT`; `internal_port = 8788` | `PORT` set by Railway | `PORT` 10000 by default |
| Volume | Fly volume, 1 GB default, daily snapshots (5 days) | Volume, 5 GB default on Hobby, mounted as root, scheduled backups | Disk, paid only, daily snapshots (7 days or more) |
| A volume that is root's | Not stated | Documented as root's | Not stated |
| One instance | One Machine with a volume; scaling adds empty volumes | No replicas with a volume | No scaling with a disk |
| A deploy | Gap while the Machine is replaced | Short gap | Few seconds' gap |
| Stop | SIGINT unless set; 5 s default, 300 max | SIGTERM; **0 s** unless set | SIGTERM; 30 s default, 300 max |
| WebSockets | Configurable idle timeout; default not stated | Exempt from idle and duration limits | No maximum duration |
| Health check | Routes around a failing Machine; no restart | At deploy only | Continuous; restarts after 60 s failing |
| Sleeping | Off in the example (on by default at a first deploy) | Off unless asked for | Described for Free services only |
| CPU | Shared: 6.25% once a burst balance is spent (5 s for a new Machine), too little to load the corpus in time (§4); performance: the whole CPU | No size: up to the plan's limit, billed per vCPU used; dedicated or not, not stated | Fixed with the plan, 1 CPU at 2 GB; dedicated or not, not stated |
| Memory sizes | Shared: 256 MB–2 GB per CPU; performance: 2–8 GB per CPU | No size: grows to the plan's limit, billed on use | Fixed: 512 MB, 2, 4, 8 GB and up |
| 2 / 4 / 8 GB a month | Performance-1x $31.00 / $41.01 / $61.02 (iad), $35.17 / $46.53 / $69.23 (lhr), computed from the page's constants; shared $10.70 / $21.40 / $42.79 (iad) | $10 per GB used, $20 per vCPU used; $5 Hobby with $5 of use | $25 / $85 / $135 (2 CPU) or $175 (4 CPU) |
| Volume a month | $0.15 per GB | $0.15 per GB | $0.25 per GB |
| Regions | 17, five of them in Europe | 4: California, Virginia, Amsterdam, Singapore | 5: Oregon, Ohio, Virginia, Frankfurt, Singapore; fixed at creation |
| Logs kept | Search 7 days | Hobby 7 days, Pro 30 | Hobby 7 days, Pro 14 |
| Custom domain | `fly certs add`; first 10 certificates free | CNAME and TXT; 2 per service on Hobby | Automatic certificates |

---

## 8. Where a provider bends the contract, and what the image does

Four things read on the providers' pages press on the contract (§1). The image
as built answers the first; the other three are settings, or the owner's.

1. **The volume's owner.** A volume a host mounts over `/data` is the host's,
   not the image's: Railway documents its volumes as root's, and Fly's and
   Render's pages do not say. The image does not depend on it. It names no
   user, so the container starts as root, and `deploy/entrypoint.sh` makes
   `/data/rooms`, gives it to `node` (uid 1000) and runs the relay as `node`
   with `setpriv`, keeping the process id tini sends SIGTERM to; every engine
   JVM is the relay's child and runs as `node` too. `image.yml` proves it on
   every run on a folder root made and owns, mounted over `/data`: the relay
   must run as uid 1000, the rooms' folder must be 1000's, and a room opened
   must be written there. This holds wherever the provider starts the container
   as root, Docker's default for an image with no user; none of the three pages
   read says otherwise. So `RAILWAY_RUN_UID=0` is not needed on Railway. A host
   that started it as another user would leave the folder as the volume came,
   and the relay would say in words that it cannot keep rooms there, and stop.
2. **The stop signal and its grace.** Nothing in the contract changes, but two
   providers need settings for it to hold: Fly sends SIGINT unless told
   (handled the same, and the example asks for SIGTERM), and Railway kills at
   once unless given draining time (the example gives 10 s).
3. **Building on the provider.** The engine's compile asks for up to 8 GB of
   build daemons' heap (§3). If a provider's builder cannot give it, the image
   is built elsewhere and the provider runs it from a registry; CI pushes
   nothing, so that is the owner's to set up.
4. **CPU on Fly.** A shared CPU's quota is too little for the corpus to load
   within the relay's 120 s on a new Machine (§4), so the Fly example asks for
   a performance CPU, at about three times the price.

The port and the one-instance rule hold as written: Fly relies on the image's
8788 default, Railway and Render set `PORT`, and all three keep a service with
a volume to one instance.

---

## 9. Pointing the GitHub Pages app at the relay

The app on GitHub Pages learns its relay when it is built: `VITE_RELAY_URL` is
baked into the build. `.github/workflows/deploy.yml` reads it from the
repository variable **`RELAY_URL`**.

1. In the repository on GitHub: **Settings → Secrets and variables → Actions →
   Variables → New repository variable**. Name `RELAY_URL`; value the relay's
   address with `https://` and no path: `https://<name>.fly.dev`,
   `https://<something>.up.railway.app`, `https://<name>.onrender.com`, or a
   custom domain. A workflow reads it as `${{ vars.RELAY_URL }}`
   (https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables,
   read 2026-09-26). It is not a secret, and need not be: the address is in
   the published app for anyone to read.
2. Deploy the Pages app again — a push to `main`, or **Run workflow** on
   `deploy.yml`, which has `workflow_dispatch`. A new relay address means a new
   build; nothing changes in the published app until then.
3. The relay answers the app's requests from another origin (it sends
   `access-control-allow-origin: *`), and the socket address is the relay's
   with `http` turned into `ws` (`https` into `wss`).

**What setting it does to CI.** Nothing to the tests. The browser suite drives a
build made with no relay address whatever the variable says, so no spec asks
the deployed relay anything, and a relay that is down or mid-deploy holds back
neither a pull request nor a Pages deploy. Only after the suite has passed, and
only on `main`, is the Pages copy built again with `RELAY_URL` into a folder of
its own, checked to carry the address, and published. Unset, the build the
suite drove is published as it is.

An address a person types into the seats panel still wins over the built one
(`src/features/game/relayAddress.js`), so running one's own relay keeps working
with the Pages app. The app the image serves needs no address: it is built with
`VITE_RELAY_URL=same-origin`, which the app reads as the folder the page came
from — the relay's own address, or the path a proxy serves it under — and
`tests/browser/hosted.spec.mjs` plays a game through the image that way, with
no address typed, on every run of `image.yml`. Do not set `VITE_RELAY_URL` on a
Railway or Render service (§5, §6): it would reach the image's build.

---

## 10. Left for the owner

- **The choice of provider,** with §7 in hand, and deleting the two example
  files not used.
- **An account and billing** with that provider: a card on file for Fly; the
  Hobby plan on Railway (Trial and Free are too small); a paid instance on
  Render (a disk needs one).
- **A region,** nearest the people who will play (Render's cannot be changed
  later, and moving Railway's or Fly's volume costs downtime), and **a size**:
  memory from §2, by the engine rooms to be kept at once, and on Fly a
  performance CPU or the risk in §4.
- **The first deploy,** following the provider's steps, and reading its logs
  for the relay's `relay on :…` line and its `/health`.
- **The `RELAY_URL` repository variable** (§9), then a Pages deploy.
- **A domain,** if one is wanted, and the DNS records the provider gives for
  it. Not needed: each provider gives the service an HTTPS address of its own.
- **Never `tests/browser/hosted.spec.mjs` against the deployed relay.** It
  leaves two tables the engine holds wherever it runs, each with a JVM, for a
  week; it refuses any address not on the machine it runs on.
