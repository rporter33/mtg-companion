#!/usr/bin/env node
/**
 * Keeps the design references and the stylesheet honest with each other.
 *
 * Reads every ```css block in docs/*.md, collects the custom properties they
 * declare or use, and compares them with src/styles/tokens.css. A token the
 * documents name but the stylesheet lacks, or one the stylesheet has that no
 * document mentions, is listed. The first is a promise the app does not keep;
 * the second is a decision nobody wrote down.
 *
 *   npm run tokens:check
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function tokensIn(text) {
  return new Set([...String(text).matchAll(/--[a-z][a-z0-9-]*/gi)].map((m) => m[0].toLowerCase()))
}

export function cssBlocks(markdown) {
  return [...String(markdown).matchAll(/```css\s*\n([\s\S]*?)```/g)].map((m) => m[1])
}

export function compare(docsMarkdown, stylesheet) {
  const documented = new Set()
  for (const md of docsMarkdown) for (const block of cssBlocks(md)) for (const t of tokensIn(block)) documented.add(t)
  const defined = tokensIn(stylesheet)
  return {
    documented: [...documented].sort(),
    defined: [...defined].sort(),
    missingInStylesheet: [...documented].filter((t) => !defined.has(t)).sort(),
    undocumented: [...defined].filter((t) => !documented.has(t)).sort(),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const docsDir = new URL('../docs/', import.meta.url)
  const files = existsSync(docsDir) ? readdirSync(docsDir).filter((f) => f.endsWith('.md')) : []
  const docs = files.map((f) => readFileSync(new URL(f, docsDir), 'utf8'))
  const stylesheet = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
  const result = compare(docs, stylesheet)
  console.log(`${files.length} document(s), ${result.documented.length} tokens documented, ${result.defined.length} defined.`)
  if (!result.documented.length) { console.log('No CSS blocks in docs/ yet; nothing to compare.'); process.exit(0) }
  if (result.missingInStylesheet.length) console.log(`Named in the documents, missing from tokens.css:\n  ${result.missingInStylesheet.join('\n  ')}`)
  if (result.undocumented.length) console.log(`In tokens.css, unmentioned by any document:\n  ${result.undocumented.join('\n  ')}`)
  process.exit(result.missingInStylesheet.length ? 1 : 0)
}
