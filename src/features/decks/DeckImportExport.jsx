import { useState } from 'react'
import { searchCards, getCardByName } from '../../lib/scryfall.js'
import { addCard, setCommanders, createDeck } from '../../lib/deck.js'
import { pinCards } from '../../lib/cache.js'
import { exportAll, importAll } from '../../lib/storage.js'

/**
 * Decklists move between sites as plain text ("4 Lightning Bolt"), so that is
 * the interchange format here too — you can paste a list from anywhere, and
 * copy this deck into anywhere.
 */
export default function DeckImportExport({ deck, lookup, onChange }) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  const decklist = toText(deck, lookup)

  const runImport = async () => {
    const lines = parseDecklist(text)
    if (!lines.length) {
      setStatus({ tone: 'warn', text: 'No card lines found. One card per line, like "4 Lightning Bolt".' })
      return
    }
    setBusy(true)
    setStatus({ tone: 'info', text: `Looking up ${lines.length} cards…` })

    let next = deck
    const failed = []
    for (const { quantity, name, section } of lines) {
      try {
        const card = await getCardByName(name, { exact: false })
        pinCards([card.id])
        if (section === 'commander') {
          next = setCommanders(next, [...next.commanders, card.id])
        } else {
          next = addCard(next, card.id, quantity, section === 'sideboard' ? 'sideboard' : 'main')
        }
      } catch {
        failed.push(name)
      }
    }
    onChange(next)
    setBusy(false)
    setStatus(failed.length
      ? { tone: 'warn', text: `Imported ${lines.length - failed.length} cards. Could not find: ${failed.slice(0, 6).join(', ')}${failed.length > 6 ? '…' : ''}` }
      : { tone: 'info', text: `Imported ${lines.length} cards.` })
    setText('')
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(decklist)
      setStatus({ tone: 'info', text: 'Decklist copied.' })
    } catch {
      setStatus({ tone: 'warn', text: 'Could not reach the clipboard — select the text and copy it manually.' })
    }
  }

  const download = () => {
    const blob = new Blob([exportAll()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `mtg-companion-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h3>Paste a decklist</h3>
        <p className="faint tiny" style={{ margin: 0 }}>
          One card per line. <code className="mono">4 Lightning Bolt</code>. A line reading
          {' '}<code className="mono">Sideboard</code> or <code className="mono">Commander</code>
          {' '}switches which section the lines below it go into.
        </p>
        <textarea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Commander\n1 Atraxa, Praetors’ Voice\n\n4 Lightning Bolt\n24 Mountain'}
          className="mono"
          style={{ fontSize: '0.82rem' }}
        />
        <div className="row">
          <button className="btn btn--primary" onClick={runImport} disabled={busy || !text.trim()}>
            {busy ? 'Importing…' : 'Import into this deck'}
          </button>
        </div>
        <p className="faint tiny" style={{ margin: 0 }}>
          Each name is looked up individually and rate limited, so a 100-card list takes
          about ten seconds.
        </p>
      </section>

      <section className="panel stack">
        <h3>Export this deck</h3>
        <textarea rows={8} readOnly value={decklist} className="mono" style={{ fontSize: '0.82rem' }} />
        <div className="row">
          <button className="btn" onClick={copy}>Copy decklist</button>
          <button className="btn" onClick={download}>Download all data</button>
        </div>
        <p className="faint tiny" style={{ margin: 0 }}>
          There are no accounts here, so &ldquo;download all data&rdquo; is the backup. It is a
          plain JSON file containing every deck and your guide progress — yours to keep.
        </p>
      </section>

      {status && <div className={`banner banner--${status.tone} tiny`}>{status.text}</div>}
    </div>
  )
}

export function toText(deck, lookup) {
  const lines = []
  const name = (id) => lookup(id)?.name ?? `(unloaded ${id.slice(0, 8)})`

  if (deck.commanders.length) {
    lines.push('Commander')
    for (const id of deck.commanders) lines.push(`1 ${name(id)}`)
    if (deck.signatureSpell) lines.push(`1 ${name(deck.signatureSpell)}`)
    lines.push('')
  }
  lines.push('Deck')
  for (const { cardId, quantity } of deck.main) lines.push(`${quantity} ${name(cardId)}`)
  if (deck.sideboard.length) {
    lines.push('', 'Sideboard')
    for (const { cardId, quantity } of deck.sideboard) lines.push(`${quantity} ${name(cardId)}`)
  }
  return lines.join('\n')
}

/**
 * Parses the loose decklist formats that sites actually emit:
 * "4 Lightning Bolt", "4x Lightning Bolt", "4 Lightning Bolt (2X2) 117",
 * with optional section headers.
 */
export function parseDecklist(text) {
  const out = []
  let section = 'main'

  for (const raw of (text ?? '').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('#')) continue

    const header = line.toLowerCase().replace(/[:\s]+$/, '')
    if (['sideboard', 'sb'].includes(header)) { section = 'sideboard'; continue }
    if (['commander', 'commanders'].includes(header)) { section = 'commander'; continue }
    if (['deck', 'maindeck', 'main', 'mainboard'].includes(header)) { section = 'main'; continue }

    const match = line.match(/^(\d+)\s*[xX]?\s+(.+)$/)
    if (!match) continue

    let name = match[2]
      .replace(/\s*\([^)]*\)\s*\d*\s*$/, '')   // trailing "(SET) 123"
      .replace(/\s*\[[^\]]*\]\s*$/, '')        // trailing "[SET]"
      .trim()
    // Split cards are written "Fire // Ice"; Scryfall's fuzzy search wants the
    // full name, so leave the separator alone.
    if (!name) continue

    out.push({ quantity: Number(match[1]), name, section })
  }
  return out
}
