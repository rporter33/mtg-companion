// @vitest-environment node
/**
 * The image's contract, read from deploy/Dockerfile and .dockerignore (HANDOFF.md,
 * M8). Docker is not on every machine the suite runs on, and the image itself is
 * built and played only by .github/workflows/image.yml; what can be held without
 * it is held here: that the image runs the relay the way the notes and the hosts
 * are told it does, as a user other than root, from files the build context lets
 * in, with the engine's pin read from its script and nowhere else.
 */
import { describe, it, expect } from 'vitest'
import { execFile, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRelay } from '../scripts/relay-server.mjs'
import { ENTRY } from '../deploy/relay-files.mjs'

const ROOT = process.cwd()
const DOCKERFILE = readFileSync(resolve(ROOT, 'deploy/Dockerfile'), 'utf8')
// Instructions, their continuation lines joined and comments dropped.
const INSTRUCTIONS = DOCKERFILE.replace(/\\\r?\n(\s*#[^\n]*\n)*/g, ' ').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
const STAGES = INSTRUCTIONS.reduce((stages, line) => {
  if (/^FROM\s/i.test(line)) stages.push([line])
  else stages.at(-1)?.push(line)
  return stages
}, [])
const RUNTIME = STAGES.at(-1)
const envOf = (stage) => Object.fromEntries(stage.filter((l) => /^ENV\s/.test(l))
  .flatMap((l) => [...l.slice(4).matchAll(/(\w+)=("[^"]*"|\S+)/g)].map((m) => [m[1], m[2].replace(/^"|"$/g, '')])))

describe('the image', () => {
  it('is built in three stages, from base images named by version, never latest', () => {
    const bases = STAGES.map((s) => s[0])
    expect(bases).toHaveLength(3)
    expect(bases[0]).toMatch(/^FROM eclipse-temurin:21-jdk\S* AS engine$/)
    expect(bases[1]).toMatch(/^FROM node:22-\S+ AS app$/)
    expect(bases[2]).toMatch(/^FROM node:22-\S+$/)
    for (const line of INSTRUCTIONS.filter((l) => /^FROM\s|--from=[a-z]/.test(l))) {
      const images = [...line.matchAll(/(?:FROM\s+|--from=)([\w.-]+\/?[\w.-]*:[\w.-]+)/g)].map((m) => m[1])
      for (const image of images) expect(image, line).not.toMatch(/:latest$/)
    }
  })

  it('pins the engine stage\'s JDK by digest, and lets what ships take its fixes', () => {
    // The engine stage compiles and is thrown away: a tag moving under it would only
    // make the next build compile the corpus cold (M8's review). What ships floats.
    expect(STAGES[0][0]).toMatch(/^FROM eclipse-temurin:21-jdk-noble@sha256:[0-9a-f]{64} AS engine$/)
    for (const line of [STAGES[1][0], RUNTIME[0], ...RUNTIME.filter((l) => /--from=eclipse-temurin/.test(l))]) {
      expect(line).not.toMatch(/@sha256:/)
    }
  })

  it('builds the engine with its own script, the pin read from it and written nowhere here', () => {
    expect(STAGES[0].some((l) => /sh scripts\/engine-build\.sh$/.test(l))).toBe(true)
    expect(DOCKERFILE).not.toMatch(/\b[0-9a-f]{40}\b/)
    expect(DOCKERFILE).not.toMatch(/ENGINE_REV/)
  })

  it('builds the app to find its relay at the address it is served from', () => {
    expect(STAGES[1]).toContain('ARG VITE_RELAY_URL=same-origin')
    expect(STAGES[1].findIndex((l) => l.startsWith('ARG VITE_RELAY_URL'))).toBeLessThan(STAGES[1].indexOf('RUN npm run build'))
  })

  it('runs the relay under tini, through an entrypoint that hands it to the node user', () => {
    expect(RUNTIME).toContain('ENTRYPOINT ["/usr/bin/tini", "--", "sh", "/app/deploy/entrypoint.sh"]')
    expect(RUNTIME.at(-1)).toBe(`CMD ["node", "${ENTRY}"]`)
    expect(RUNTIME).toContain('STOPSIGNAL SIGTERM')
    expect(STAGES[1].some((l) => l.includes('cp deploy/healthcheck.mjs deploy/entrypoint.sh /out/deploy/'))).toBe(true)
    // Started as root only to give the rooms to node: no USER, so a host's volume
    // mounted as root's can be handed over, and the relay then run as node, by exec
    // so that it keeps the process id tini sends SIGTERM to.
    expect(RUNTIME.some((l) => /^USER\s/.test(l))).toBe(false)
    const entry = readFileSync(resolve(ROOT, 'deploy/entrypoint.sh'), 'utf8')
    expect(entry.startsWith('#!/bin/sh\n')).toBe(true)
    expect(entry).not.toMatch(/\r/)
    expect(entry).toMatch(/^set -eu$/m)
    expect(entry).toMatch(/^if \[ "\$\(id -u\)" = 0 \]; then$/m)
    expect(entry).toMatch(/^ {2}chown -R node:node "\$rooms"$/m)
    expect(entry).toMatch(/^ {2}exec setpriv --reuid=node --regid=node --init-groups -- "\$@"$/m)
    expect(entry.trimEnd().split('\n').at(-1)).toBe('exec "$@"')
  })

  // The branch a host that starts the container as another user takes, run as it
  // runs: not root, so nothing is handed over and the command is the relay itself.
  it.runIf(spawnSync('sh', ['-c', 'exit 0']).status === 0 && spawnSync('sh', ['-c', '[ "$(id -u)" != 0 ]']).status === 0)(
    'starts the command as it is, where it is not started as root', () => {
      const ran = spawnSync('sh', ['deploy/entrypoint.sh', process.execPath, '-e', 'console.log("the relay, " + process.argv.length)'], { cwd: ROOT, encoding: 'utf8' })
      expect(ran.status).toBe(0)
      expect(ran.stdout.trim()).toBe('the relay, 1')
    })

  it('says where the relay keeps rooms, serves the app and finds the engine, as the notes say', () => {
    const env = envOf(RUNTIME)
    expect(env.ROOMS_DIR).toBe('/data/rooms')
    expect(env.STATIC_DIR).toBe('/app/dist')
    expect(env.ENGINE_CMD).toBe('/app/engine/bin/companion')
    expect(env.NODE_ENV).toBe('production')
    // PORT is the host's to set; the relay listens on 8788 without it.
    expect(env.PORT).toBeUndefined()
    // A heap ceiling of its own, later than the launcher's -Xmx2g and so the one that holds.
    expect(env.COMPANION_OPTS).toMatch(/-Xmx\d+m\b/)
    // Where those are copied to.
    expect(RUNTIME).toContain('WORKDIR /app')
    expect(RUNTIME).toContain('COPY --from=engine /argentum/companion/build/install/companion engine')
    expect(RUNTIME).toContain('COPY --from=app /src/dist dist')
    // The volume's folder, given to the user the relay runs as.
    expect(RUNTIME.some((l) => /mkdir -p \/data\/rooms && chown -R node:node \/data/.test(l))).toBe(true)
  })

  it('checks its health with a script that is in the image', () => {
    const health = RUNTIME.find((l) => l.startsWith('HEALTHCHECK'))
    expect(health).toMatch(/CMD \["node", "deploy\/healthcheck\.mjs"\]$/)
    expect(existsSync(resolve(ROOT, 'deploy/healthcheck.mjs'))).toBe(true)
  })

  it('copies nothing the build context leaves out', () => {
    const ignore = readFileSync(resolve(ROOT, '.dockerignore'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    // Everything left out, then what the build reads let back in.
    expect(ignore[0]).toBe('*')
    const allowed = ignore.slice(1).map((l) => { expect(l.startsWith('!'), l).toBe(true); return l.slice(1).replace(/\/$/, '') })
    const sources = INSTRUCTIONS.filter((l) => /^COPY\s/.test(l) && !/--from=/.test(l))
      .flatMap((l) => l.replace(/^COPY\s+/, '').split(/\s+/).slice(0, -1))
    expect(sources.length).toBeGreaterThan(5)
    for (const source of sources) {
      expect(allowed, source).toContain(source.split('/')[0])
      expect(existsSync(resolve(ROOT, source)), source).toBe(true)
    }
    // And nothing private is let in.
    for (const kept of allowed) expect(kept).not.toMatch(/^\.env|^node_modules$|^dist$|^\.git$|^\.rooms$/)
  })
})

describe('the provider examples', () => {
  // Railway and Render deploy on a push to main, and every deploy stops the relay,
  // drops every socket and starts every kept room's engine again at once; so each
  // example deploys only a commit that changes what goes into the image, which is
  // what the root .dockerignore lets in (M8's review). Held together here, so a
  // folder the build starts reading is not left out of either.
  const kept = readFileSync(resolve(ROOT, '.dockerignore'), 'utf8').split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l.startsWith('!')).map((l) => (l.endsWith('/') ? `${l.slice(1)}**` : l.slice(1)))

  it('deploys on Railway only for what goes into the image', () => {
    const toml = readFileSync(resolve(ROOT, 'deploy/railway.toml'), 'utf8')
    const block = /^watchPatterns = \[([\s\S]*?)^\]/m.exec(toml)
    expect(block).not.toBeNull()
    const patterns = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect(patterns.filter((p) => !p.startsWith('!')).map((p) => p.replace(/^\//, '')).sort()).toEqual([...kept].sort())
    // Railway's patterns are from the repository root, whatever the root directory.
    for (const p of patterns) expect(p, p).toMatch(/^!?\//)
    expect(patterns).toContain('!/deploy/*.md')
  })

  it('deploys on Render only for what goes into the image', () => {
    const yaml = readFileSync(resolve(ROOT, 'deploy/render.yaml'), 'utf8').replace(/\r\n/g, '\n')
    const listAt = (key) => {
      const m = new RegExp(`^( +)${key}:\\n((?:\\1  - .+\\n)+)`, 'm').exec(yaml)
      return m ? m[2].split('\n').filter(Boolean).map((l) => l.replace(/^\s*- /, '')) : null
    }
    expect(yaml).toMatch(/^ {4}buildFilter:$/m)
    expect(listAt('paths')?.sort()).toEqual([...kept].sort())
    expect(listAt('ignoredPaths')).toEqual(['deploy/*.md'])
  })
})

describe('the workflow that proves the image', () => {
  const WORKFLOWS = ['deploy.yml', 'image.yml', 'engine-pin.yml']
    .map((name) => [name, readFileSync(resolve(ROOT, '.github/workflows', name), 'utf8').replace(/\r\n/g, '\n')])
  const IMAGE_YML = WORKFLOWS.find(([name]) => name === 'image.yml')[1]

  // Every step runs under `bash -eo pipefail`. grep -q stops reading at its first
  // match, and a command still writing into the pipe then dies of SIGPIPE, which
  // pipefail reports as the pipeline's failure (141) though the line was there.
  // Only printf of one value, written whole before grep reads, is safe to pipe in.
  it('never pipes a command that may still be writing into grep -q', () => {
    for (const [name, text] of WORKFLOWS) {
      for (const line of text.split('\n').filter((l) => !/^\s*#/.test(l) && /\|\s*grep\s+(-\w*q\w*|--quiet)\b/.test(l))) {
        expect(line, `${name}: ${line.trim()}`).toMatch(/printf '%s' "\$\w+" \| grep -\w*q/)
      }
    }
  })

  // The named volume the image is first run on is filled by Docker from the image's
  // /data, already node's, so it never reaches the entrypoint's root branch; a host's
  // volume may be root's (Railway documents its own so), which only a folder root
  // made and mounted over /data stands in for (M8's review).
  it('runs the image once on a folder that is root\'s, and holds the relay and its rooms to node', () => {
    const at = IMAGE_YML.indexOf("- name: Run it on a volume that is root's")
    expect(at).toBeGreaterThan(0)
    const step = IMAGE_YML.slice(at, IMAGE_YML.indexOf('\n      - ', at + 1))
    expect(step).toMatch(/sudo install -d -o root -g root -m 755 "\$ROOT_VOLUME_DIR"/)
    expect(step).toMatch(/if \[ "\$\(stat -c %u "\$ROOT_VOLUME_DIR"\)" != 0 \]/)
    expect(step).toMatch(/docker run -d --name "\$ROOT_NAME" -p 8788:8788 -v "\$ROOT_VOLUME_DIR:\/data" "\$IMAGE"/)
    expect(step).toMatch(/if \[ "\$relay_uid" != 1000 \]/)
    expect(step).toMatch(/rooms_uid=\$\(sudo stat -c %u "\$ROOT_VOLUME_DIR\/rooms"\)/)
    expect(step).toMatch(/if \[ "\$rooms_uid" != 1000 \]/)
    expect(step).toMatch(/sudo test -f "\$ROOT_VOLUME_DIR\/rooms\/\$code\.json"/)
    expect(step).toMatch(/docker stop -t 10 "\$ROOT_NAME"/)
  })
})

describe('the relay serving the app', () => {
  // The image serves the built app from the relay (STATIC_DIR). Each kind of file
  // the build writes goes out as what it is; the shell is always asked again, the
  // hashed chunks never; any address that is not a file is the app, and nothing
  // outside the folder is served.
  it('serves each kind of file the build writes as what it is', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-static-'))
    const put = (file, text) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), text) }
    put('index.html', '<!doctype html><div id="root"></div>')
    put('assets/index-Ab12Cd.js', 'export {}')
    put('assets/index-Ab12Cd.css', 'body{}')
    put('mtg-assets/assets/core/art/hero.webp', 'RIFF')
    put('mtg-assets/assets/shared/fonts/font.woff2', 'wOF2')
    put('icon.svg', '<svg/>')
    put('icon-192.png', 'png')
    put('manifest.webmanifest', '{}')
    put('version.json', '{}')
    put('sw.js', '//')
    const relay = createRelay({ engineCommand: null, staticDir: dir })
    await new Promise((r) => relay.server.listen(0, '127.0.0.1', r))
    const at = `http://127.0.0.1:${relay.server.address().port}`
    try {
      const head = async (path) => {
        const res = await fetch(`${at}${path}`)
        return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), body: await res.text() }
      }
      const types = {
        '/': 'text/html', '/assets/index-Ab12Cd.js': 'text/javascript', '/assets/index-Ab12Cd.css': 'text/css',
        '/mtg-assets/assets/core/art/hero.webp': 'image/webp', '/mtg-assets/assets/shared/fonts/font.woff2': 'font/woff2',
        '/icon.svg': 'image/svg+xml', '/icon-192.png': 'image/png', '/manifest.webmanifest': 'application/manifest+json',
        '/version.json': 'application/json', '/sw.js': 'text/javascript',
      }
      for (const [path, type] of Object.entries(types)) expect((await head(path)).type?.split(';')[0], path).toBe(type)
      expect((await head('/assets/index-Ab12Cd.js')).cache).toBe('public, max-age=31536000, immutable')
      // The shell, and the art under mtg-assets/, which is named without a hash.
      for (const path of ['/', '/sw.js', '/version.json', '/mtg-assets/assets/core/art/hero.webp']) expect((await head(path)).cache, path).toBe('no-cache')
      // An address of the app's own, not a file, is the app.
      expect((await head('/game/engine/ABCDE')).body).toMatch(/<div id="root">/)
      // The relay's own answers are still its own.
      expect((await head('/health')).type).toBe('application/json')
      // And nothing outside the folder.
      expect((await head('/../package.json')).body).not.toMatch(/"name": "mtg-companion"/)
      expect((await head('/%2e%2e/package.json')).body).not.toMatch(/"name": "mtg-companion"/)
    } finally {
      await relay.shutdown()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the relay as the image starts it', () => {
  // A host's volume the relay's user cannot write is the likeliest first failure of a
  // deploy (HANDOFF.md, M8): said in words, and the relay stops rather than run on
  // keeping nothing.
  it('stops, saying so, where it cannot keep rooms', () => {
    const ran = spawnSync(process.execPath, ['scripts/relay-server.mjs'], {
      cwd: ROOT, encoding: 'utf8', timeout: 15_000,
      // A folder inside a file: no user can make it, on any system.
      env: { ...process.env, ROOMS_DIR: resolve(ROOT, 'package.json', 'rooms'), PORT: '0', ENGINE_CMD: '' },
    })
    expect(ran.status).toBe(1)
    expect(ran.stderr).toMatch(/^relay: cannot keep rooms in .*package\.json.rooms \(ENOTDIR\)/)
    expect(ran.stderr).toMatch(/point ROOMS_DIR at one it can write\.$/m)
    expect(ran.stdout).not.toMatch(/relay on :/)
  })
})

describe('the health check', () => {
  it('is healthy against a relay that answers, and not against one that does not', async () => {
    const relay = createRelay({ engineCommand: null })
    await new Promise((r) => relay.server.listen(0, '127.0.0.1', r))
    const port = relay.server.address().port
    const env = { ...process.env, PORT: String(port) }
    try {
      // Asked from a process of its own, as Docker runs it, and waited for without
      // blocking: the relay answering it lives in this one.
      const healthy = await new Promise((done) => execFile(process.execPath, ['deploy/healthcheck.mjs'], { cwd: ROOT, env },
        (error, stdout) => done({ code: error?.code ?? 0, stdout })))
      expect(healthy.code).toBe(0)
      expect(healthy.stdout).toMatch(/^healthy: 0 room\(s\), engine none/)
    } finally {
      await relay.shutdown()
    }
    const gone = spawnSync(process.execPath, ['deploy/healthcheck.mjs'], { cwd: ROOT, env, encoding: 'utf8', timeout: 15_000 })
    expect(gone.status).toBe(1)
    expect(gone.stdout).toMatch(/^unhealthy: /)
  })
})
