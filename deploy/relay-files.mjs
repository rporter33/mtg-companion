#!/usr/bin/env node
/**
 * The files the relay reads when it runs, and nothing else (HANDOFF.md, M8).
 *
 * The image (deploy/Dockerfile) carries only these beside the built app and the
 * engine: `scripts/relay-server.mjs`, every file it imports and every file those
 * import, through `src/` — the board model it holds tables with, the engine's
 * levels and pace — the packages they name from node_modules with whatever those
 * depend on, and package.json, whose `"type": "module"` is what makes Node read
 * src/'s `.js` files as modules. Traced from the source each time the image is
 * built rather than listed by hand, so an import added tomorrow is carried
 * tomorrow; and an import this cannot follow — one computed at run time — stops
 * the build with its name rather than leave an image that fails when it starts.
 *
 *   node deploy/relay-files.mjs                 # say what the relay reads
 *   node deploy/relay-files.mjs --copy /out     # copy it, paths kept, into /out
 */
import { builtinModules } from 'node:module'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const ENTRY = 'scripts/relay-server.mjs'

const BUILTIN = new Set(builtinModules)
// import x from '…', import { a, b } from '…' over several lines, export … from '…',
// import '…', and import(…) with whatever is in the brackets.
const STATIC = /(?:^|[\s;}])(?:import|export)\s+(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g
const DYNAMIC = /(?:^|[^\w$.])import\s*\(\s*([^)]*?)\s*\)/g

/** Source with its comments taken out, so an import written in a comment is not followed. */
const uncommented = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((line) => line.replace(/(^|[^:'"`\w\\])\/\/.*$/, '$1')).join('\n')

/** The package a bare name is from: `ws`, or `@scope/name`. */
const packageOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])

/**
 * What the relay imports, from `entry`, within `root`: its files (relative, with
 * forward slashes) and the packages they name. Throws on an import it cannot
 * follow or a file it cannot find, naming both.
 */
export function relayImports(root = ROOT, entry = ENTRY) {
  const files = new Set()
  const packages = new Set()
  const visit = (file) => {
    const name = relative(root, file).split(sep).join('/')
    if (files.has(name)) return
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`${name} is imported but is not there`)
    files.add(name)
    const text = uncommented(readFileSync(file, 'utf8'))
    const specs = [...text.matchAll(STATIC)].map((m) => m[1])
    for (const [, inside] of text.matchAll(DYNAMIC)) {
      const literal = /^(['"])([^'"`$]+)\1$/.exec(inside)
      if (!literal) throw new Error(`${name} imports ${inside || 'something'} at run time, which cannot be traced; import it by name`)
      specs.push(literal[2])
    }
    for (const spec of specs) {
      if (spec.startsWith('node:') || BUILTIN.has(spec)) continue
      if (spec.startsWith('.') || spec.startsWith('/')) { visit(resolve(dirname(file), spec)); continue }
      packages.add(packageOf(spec))
    }
  }
  visit(resolve(root, entry))
  return { files: [...files].sort(), packages: [...packages].sort() }
}

/**
 * The packages as installed, with every package each depends on (its
 * `dependencies`, and those of its `optionalDependencies` that are installed),
 * as folders under node_modules. Throws on one that is not installed.
 */
export function packageFolders(root, names) {
  const found = new Set()
  const visit = (name) => {
    const folder = `node_modules/${name}`
    if (found.has(folder)) return
    const manifest = join(root, folder, 'package.json')
    if (!existsSync(manifest)) throw new Error(`the relay needs the package ${name}, which is not installed (npm ci first)`)
    found.add(folder)
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep)
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) if (existsSync(join(root, 'node_modules', dep, 'package.json'))) visit(dep)
  }
  for (const name of names) visit(name)
  return [...found].sort()
}

/** Everything the relay needs at run time, as paths relative to the root: package.json, its files, its packages' folders. */
export function relayFiles(root = ROOT, entry = ENTRY) {
  const { files, packages } = relayImports(root, entry)
  return { files: ['package.json', ...files], folders: packageFolders(root, packages) }
}

const asProgram = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (asProgram) {
  const at = process.argv.indexOf('--copy')
  const { files, folders } = relayFiles()
  if (at < 0) {
    for (const line of [...files, ...folders.map((f) => `${f}/`)]) console.log(line)
  } else {
    const out = resolve(process.argv[at + 1] ?? '')
    if (!process.argv[at + 1]) throw new Error('--copy needs a folder to copy into')
    for (const file of files) { mkdirSync(dirname(join(out, file)), { recursive: true }); copyFileSync(join(ROOT, file), join(out, file)) }
    for (const folder of folders) cpSync(join(ROOT, folder), join(out, folder), { recursive: true })
    console.log(`relay: ${files.length} files and ${folders.length} package(s) (${folders.map((f) => f.slice('node_modules/'.length)).join(', ')}) copied into ${out}`)
  }
}
