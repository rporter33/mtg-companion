import { useEffect, useState } from 'react'
import { getCardByName, getCardsByNames, autocomplete } from '../../lib/scryfall.js'
import {
  looksLikeUrl, planForUrl, fetchFromSource, toDecklistText,
} from '../../lib/deck-sources.js'
import { toExampleEntry } from '../../data/example-decks.js'
import { addCard, setCommanders } from '../../lib/deck.js'
import { getFormat, frontTypeLine } from '../../lib/formats.js'
import { parseDecklist } from '../../lib/decklist.js'
import { captureVersion } from '../../lib/versions.js'
import { pinCards } from '../../lib/cache.js'
import { exportAll, markExported } from '../../lib/storage.js'
import { exampleToDecklist } from '../../data/example-decks.js'

/**
 * Decklists move between sites as plain text ("4 Lightning Bolt"), so that is
 * the interchange format here too — you can paste a list from anywhere, and
 * copy this deck into anywhere.
 */
export default function DeckImportExport({ deck, lookup, onChange, pending, onPendingConsumed }) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const [urlPlan, setUrlPlan] = useState(null)

  const decklist = toText(deck, lookup)

  // A deck handed over from the commanders browser arrives as text to import.
  useEffect(() => {
    if (pending?.kind !== 'example') return
    setText(exampleToDecklist(pending.example))
    setStatus({ tone: 'info', text: `Loaded "${pending.example.name}". Review it below, then import.` })
    onPendingConsumed?.()
  }, [pending, onPendingConsumed])

  /**
   * Resolving happens before anything is written, so the user sees what will
   * land and what could not be found while the deck is still untouched. The
   * previous version applied immediately and reported the failures afterwards,
   * by which point the damage was done.
   */
  const buildPreview = async (raw) => {
    const lines = parseDecklist(raw)
    if (!lines.length) {
      setStatus({ tone: 'warn', text: 'No card lines found. One card per line, like "4 Lightning Bolt".' })
      return
    }
    setBusy(true)
    setStatus({ tone: 'info', text: `Looking up ${lines.length} cards…` })

    // One request per 75 names rather than one per card. The old loop was
    // sequential and rate limited, so a Commander deck took twenty seconds when
    // everything worked and stalled outright when it did not.
    const cards = await getCardsByNames(lines.map((line) => line.name), {
      onProgress: (done, total) => setStatus({
        tone: 'info',
        text: done < total ? `Looking up ${total} cards… ${done} done` : 'Checking the last few names…',
      }),
    })

    const resolved = []
    const failed = []
    for (const line of lines) {
      const card = cards.get(line.name)
      if (card) resolved.push({ ...line, card })
      else failed.push(line)
    }

    // Offer the closest matches for anything that did not resolve. Most import
    // failures are a typo or a punctuation difference, not a missing card. This
    // is one request per failure, which is fine now that it runs over the few
    // that actually failed rather than over every line in the deck.
    for (const line of failed.slice(0, 20)) {
      try {
        line.candidates = (await autocomplete(line.name)).slice(0, 4)
      } catch {
        line.candidates = []
      }
    }

    setBusy(false)
    setPreview({ resolved, failed })
    setStatus(null)
  }

  const applyPreview = () => {
    // An import rewrites the list at once, so the list as it stood is kept
    // first. This is one of the two places a version is taken automatically;
    // the other is a restore. Everything else is reversible by editing back.
    let next = captureVersion(deck, { label: 'Before import', auto: true })
    for (const { quantity, section, card } of preview.resolved) {
      pinCards([card.id])
      // A card picked as the commander goes to the command zone instead of the
      // maindeck, not as well as it — otherwise the deck is 101 cards.
      if (section === 'commander' || card.id === preview.commanderId) {
        next = setCommanders(next, [...next.commanders, card.id])
      } else next = addCard(next, card.id, quantity, section === 'sideboard' ? 'sideboard' : 'main')
    }
    onChange(next)
    setPreview(null)
    setText('')
    setStatus({
      tone: 'info',
      text: `Added ${preview.resolved.length} cards.${preview.failed.length ? ` ${preview.failed.length} could not be found and were skipped.` : ''}`,
    })
  }

  /**
   * A pasted URL is recognised before any request is made, so the app can say
   * what it is about to do — or explain why it cannot — instead of failing
   * opaquely. Sources that do not permit browser access are never fetched.
   */
  const handleInput = (value) => {
    setText(value)
    setPreview(null)
    setUrlPlan(looksLikeUrl(value) ? planForUrl(value) : null)
  }

  const runImport = async () => {
    if (urlPlan?.kind === 'fetch') {
      setBusy(true)
      setStatus({ tone: 'info', text: urlPlan.message })
      try {
        const parsed = await fetchFromSource(urlPlan)
        const asText = toDecklistText(parsed)
        setText(asText)
        setUrlPlan(null)
        setBusy(false)
        await buildPreview(asText)
      } catch (error) {
        setBusy(false)
        setStatus({ tone: 'warn', text: `${error.message} ${error.instructions ?? ''}`.trim() })
      }
      return
    }
    await buildPreview(text)
  }

  const copyAsExample = async () => {
    const entry = toExampleEntry(deck, lookup)
    const json = `${JSON.stringify(entry, null, 2)},`
    try {
      await navigator.clipboard.writeText(json)
      setStatus({
        tone: 'info',
        text: 'Copied. Paste it into src/data/example-decks.js to ship this deck as an example.',
      })
    } catch {
      setStatus({ tone: 'warn', text: 'Could not reach the clipboard. The entry is shown below instead.' })
      setPreview({ resolved: [], failed: [], raw: json })
    }
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
    // Both download buttons count as a backup, so staleness is judged from
    // whichever was pressed last.
    markExported()
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
          aria-label="Decklist to import"
          value={text}
          onChange={(e) => handleInput(e.target.value)}
          placeholder={'Paste a decklist, or a link from Archidekt or Moxfield\n\nCommander\n1 Atraxa, Praetors’ Voice\n\n4 Lightning Bolt\n24 Mountain'}
          className="mono"
          style={{ fontSize: '0.82rem' }}
        />

        {urlPlan && (
          <div className={`banner banner--${urlPlan.kind === 'fetch' ? 'info' : 'warn'} tiny`}>
            <strong>{urlPlan.message}</strong>
            {urlPlan.hint && <div style={{ marginTop: 'var(--space-2)' }}>{urlPlan.hint}</div>}
          </div>
        )}

        <div className="row">
          <button
            className="btn btn--primary"
            onClick={runImport}
            disabled={busy || !text.trim() || urlPlan?.kind === 'manual' || urlPlan?.kind === 'unknown'}
          >
            {busy ? 'Reading…' : urlPlan?.kind === 'fetch' ? 'Fetch this deck' : 'Review import'}
          </button>
        </div>
        <p className="faint tiny" style={{ margin: 0 }}>
          Nothing is added until you have seen what will land. Names are looked up
          in bulk, 75 at a time, so a whole Commander deck is two requests.
        </p>
      </section>

      <section className="panel stack">
        <h3>Export this deck</h3>
        <textarea
          rows={8}
          readOnly
          aria-label="This deck as a plain text list"
          value={decklist}
          className="mono"
          style={{ fontSize: '0.82rem' }}
        />
        <div className="row row--wrap">
          <button className="btn" onClick={copy}>Copy decklist</button>
          <button className="btn" onClick={download}>Download all data</button>
          <button className="btn btn--ghost btn--sm" onClick={copyAsExample}>Copy as example</button>
        </div>
        <p className="faint tiny" style={{ margin: 0 }}>
          There are no accounts here, so &ldquo;download all data&rdquo; is the backup. It is a
          plain JSON file containing every deck and your guide progress — yours to keep.
        </p>
      </section>

      {preview && (
        <ImportPreview
          preview={preview}
          needsCommander={Boolean(getFormat(deck.formatId)?.commander?.required)
            && !deck.commanders.length
            && !preview.resolved?.some((line) => line.section === 'commander')}
          onPickCommander={(id) => setPreview((current) => ({ ...current, commanderId: id }))}
          onApply={applyPreview}
          onCancel={() => setPreview(null)}
          onResolve={(line, name) => {
            setPreview((current) => ({
              ...current,
              failed: current.failed.filter((f) => f !== line),
            }))
            // Re-run just this one line rather than the whole list.
            getCardByName(name, { exact: true })
              .then((card) => setPreview((current) => ({
                ...current,
                resolved: [...current.resolved, { ...line, card }],
              })))
              .catch(() => { /* leave it out; the user saw the attempt */ })
          }}
        />
      )}

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

/** Shows exactly what an import will do before it does any of it. */
/** Legendary creatures in a list, which is what a commander can be. */
function commanderCandidates(resolved) {
  return resolved
    .map((line) => line.card)
    .filter((card) => /Legendary/.test(frontTypeLine(card)) && /Creature/.test(frontTypeLine(card)))
}

function ImportPreview({ preview, onApply, onCancel, onResolve, needsCommander, onPickCommander }) {
  const total = preview.resolved.reduce((n, line) => n + line.quantity, 0)

  if (preview.raw) {
    return (
      <section className="panel stack">
        <h3>Example entry</h3>
        <textarea
          rows={10}
          readOnly
          aria-label="Example deck entry to copy"
          value={preview.raw}
          className="mono"
          style={{ fontSize: '0.75rem' }}
        />
        <button className="btn btn--ghost btn--sm" onClick={onCancel}>Close</button>
      </section>
    )
  }

  return (
    <section className="panel stack">
      <h3>Before anything is added</h3>
      <div className="row row--wrap">
        <span className="chip chip--ok">{total} cards found</span>
        {preview.failed.length > 0 && (
          <span className="chip chip--warn">{preview.failed.length} not found</span>
        )}
      </div>

      {preview.failed.length > 0 && (
        <div className="stack" style={{ gap: 'var(--space-2)' }}>
          <p className="faint tiny" style={{ margin: 0 }}>
            These names did not match a card. Most import failures are a typo or a
            punctuation difference — pick the right one, or leave it out.
          </p>
          {preview.failed.map((line, i) => (
            <div className="stack" key={i} style={{ gap: 'var(--space-1)' }}>
              <span className="tiny mono">{line.quantity} {line.name}</span>
              <div className="row row--wrap">
                {line.candidates?.length
                  ? line.candidates.map((name) => (
                    <button key={name} className="chip" onClick={() => onResolve(line, name)}>
                      {name}
                    </button>
                  ))
                  : <span className="faint tiny">No close matches.</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/*
        A list exported without a "Commander" header — which is most of them —
        used to import as a hundred cards with an empty command zone and a
        legality error the reader had no obvious way to clear. The deck is right
        here and so are its legendary creatures, so offer them.
      */}
      {needsCommander && commanderCandidates(preview.resolved).length > 0 && (
        <div className="stack" style={{ gap: 'var(--space-2)' }}>
          <p className="faint tiny" style={{ margin: 0 }}>
            This list has no <code className="mono">Commander</code> line. Pick the commander and
            the rest becomes the deck, or add it later from the list.
          </p>
          <div className="row row--wrap">
            {commanderCandidates(preview.resolved).map((card) => (
              <button
                key={card.id}
                className={`chip ${preview.commanderId === card.id ? 'chip--active' : ''}`}
                onClick={() => onPickCommander(preview.commanderId === card.id ? null : card.id)}
              >
                {card.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="row">
        <button className="btn btn--primary" onClick={onApply} disabled={!preview.resolved.length}>
          Add {total} cards
        </button>
        <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  )
}
