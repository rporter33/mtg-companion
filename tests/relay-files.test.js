// @vitest-environment node
/**
 * What the image carries of the relay (deploy/relay-files.mjs, HANDOFF.md M8):
 * the files `scripts/relay-server.mjs` imports, followed through src/, and the
 * packages they name — traced, not listed by hand. Held here to the one thing
 * that matters: copied alone into an empty folder, as the image copies them,
 * they are enough for a relay to start and answer.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { relayFiles, relayImports } from '../deploy/relay-files.mjs'

const ROOT = process.cwd()

describe('the files the relay reads', () => {
  it('are the relay, the engine bridge and room, what they import from src/, and ws', () => {
    const { files, folders } = relayFiles(ROOT)
    expect(files[0]).toBe('package.json')
    for (const f of ['scripts/relay-server.mjs', 'scripts/relay-engine.mjs', 'scripts/engine-bridge.mjs', 'src/lib/board/net.js', 'src/lib/board/model.js', 'src/lib/engine/pace.js']) {
      expect(files, f).toContain(f)
    }
    // Only what the relay reads: no screen, no test, no other script.
    expect(files.filter((f) => /\.jsx$|^tests\/|^scripts\/(?!relay-server|relay-engine|engine-bridge)/.test(f))).toEqual([])
    expect(folders).toEqual(['node_modules/ws'])
  })

  it('are enough, copied alone, for a relay to start and answer', () => {
    const out = mkdtempSync(join(tmpdir(), 'relay-files-'))
    try {
      const { files, folders } = relayFiles(ROOT)
      for (const f of files) { mkdirSync(dirname(join(out, f)), { recursive: true }); copyFileSync(join(ROOT, f), join(out, f)) }
      for (const f of folders) cpSync(join(ROOT, f), join(out, f), { recursive: true })
      // A relay with no engine, on a port of its own, asked for its health and let go.
      writeFileSync(join(out, 'start.mjs'), [
        "import { createRelay } from './scripts/relay-server.mjs'",
        'const relay = createRelay({ engineCommand: null })',
        'await new Promise((r) => relay.server.listen(0, "127.0.0.1", r))',
        'const health = await fetch(`http://127.0.0.1:${relay.server.address().port}/health`).then((r) => r.json())',
        'await relay.shutdown()',
        'console.log(JSON.stringify(health))',
      ].join('\n'))
      const said = execFileSync(process.execPath, ['start.mjs'], { cwd: out, encoding: 'utf8', timeout: 30_000 })
      expect(JSON.parse(said.trim().split('\n').at(-1))).toEqual({ ok: true, rooms: 0, engine: false })
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  it('are followed through every kind of import, and not through a comment', () => {
    const root = mkdtempSync(join(tmpdir(), 'relay-trace-'))
    const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
    try {
      put('scripts/relay-server.mjs', [
        "import { a } from '../src/a.js'",
        "import {\n  b,\n  c,\n} from '../src/b.js'",
        "export { d } from '../src/d.js'",
        "import '../src/side-effect.js'",
        "const later = () => import('../src/later.js')",
        "// import { gone } from '../src/commented.js'",
        "/* import { gone } from '../src/also-commented.js' */",
        "import { spawn } from 'node:child_process'",
        "import { join } from 'path'",
        "import { WebSocketServer } from 'ws'",
        "import thing from '@scope/pkg/sub.js'",
        "const url = 'https://example.org/' // import x from './not-there.js'",
      ].join('\n'))
      for (const f of ['src/a.js', 'src/b.js', 'src/d.js', 'src/side-effect.js', 'src/later.js']) put(f, 'export const x = 1\n')
      const { files, packages } = relayImports(root)
      expect(files).toEqual(['scripts/relay-server.mjs', 'src/a.js', 'src/b.js', 'src/d.js', 'src/later.js', 'src/side-effect.js'])
      expect(packages).toEqual(['@scope/pkg', 'ws'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('stop at an import made at run time, or a file that is not there, naming it', () => {
    const root = mkdtempSync(join(tmpdir(), 'relay-trace-'))
    try {
      mkdirSync(join(root, 'scripts'), { recursive: true })
      writeFileSync(join(root, 'scripts/relay-server.mjs'), 'const name = "x"\nawait import(`../src/${name}.js`)\n')
      expect(() => relayImports(root)).toThrow(/relay-server\.mjs imports `\.\.\/src\/\$\{name\}\.js` at run time/)
      writeFileSync(join(root, 'scripts/relay-server.mjs'), "import { a } from '../src/missing.js'\n")
      expect(() => relayImports(root)).toThrow(/src\/missing\.js is imported but is not there/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
