import { memo, useEffect, useMemo, useState } from 'react'
import { getCardsByIds } from '../../lib/scryfall.js'
import {
  captureVersion, restoreVersion, deleteVersion, relabelVersion, diffVersions,
  versionSize, versionBytes, listsOf, MAX_VERSIONS,
} from '../../lib/versions.js'
import { priceFor, formatPrice } from '../../lib/prices.js'

/**
 * A deck's history: saved versions, what changed between any of them and now,
 * and a way back.
 *
 * Versions are taken when asked, and automatically before an import or a
 * restore — the two things that rewrite a list at once. Not on every edit: a
 * history of "+1, −1, +1" is noise, and those edits are already reversible by
 * editing back.
 */
/**
 * A lookup that knows every card the deck has EVER held, not only the ones in
 * it now.
 *
 * The editor's lookup loads what is currently in the list. A diff's whole job
 * is to name what left, and a card that left is by definition not in the list
 * any more — so it came back as "(unknown …)" and its price fell out of the
 * total. Every id across every version is resolved here instead. It is
 * cache-first: those cards were pinned when they were added, so this costs no
 * network for anything the deck has actually contained.
 */
function useHistoryLookup(deck, editorLookup) {
  const ids = useMemo(() => {
    const all = new Set()
    const collect = (lists) => {
      for (const zone of ['main', 'sideboard']) for (const e of lists?.[zone] ?? []) all.add(e.cardId)
      for (const id of lists?.commanders ?? []) all.add(id)
      if (lists?.signatureSpell) all.add(lists.signatureSpell)
    }
    collect(deck)
    for (const v of deck.versions ?? []) collect(v)
    return [...all]
  }, [deck])

  const [extra, setExtra] = useState(() => new Map())
  useEffect(() => {
    let cancelled = false
    const missing = ids.filter((id) => !editorLookup(id) && !extra.has(id))
    if (!missing.length) return undefined
    getCardsByIds(missing).then((found) => {
      if (cancelled || !found.size) return
      setExtra((prev) => new Map([...prev, ...found]))
    }).catch(() => { /* names fall back to the id; nothing else to do */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])

  return (id) => editorLookup(id) ?? extra.get(id)
}

export default function DeckHistory({ deck, lookup: editorLookup, market, onChange }) {
  const [comparing, setComparing] = useState(null)
  const versions = deck.versions ?? []
  const lookup = useHistoryLookup(deck, editorLookup)

  // Memoised, because every row compares itself against this and a fresh
  // object each render would defeat those comparisons' own memoisation.
  const current = useMemo(() => listsOf(deck), [deck])
  const unchanged = useMemo(
    () => Boolean(versions[0] && diffVersions(versions[0], current, lookup).empty),
    [versions, current, lookup],
  )

  const save = (label) => {
    const next = captureVersion(deck, { label })
    if (next === deck) return false
    onChange(next)
    return true
  }

  return (
    <div className="stack">
      <div className="panel stack">
        <h3>Save a version</h3>
        <p className="muted tiny" style={{ margin: 0 }}>
          A version is the list as it stands, with a name. Restoring one later puts the list back
          and keeps the one you left, so nothing here is one-way.
        </p>
        <SaveVersionForm onSave={save} unchanged={unchanged} />
      </div>

      {versions.length === 0 ? (
        <div className="empty">
          <h3>No versions yet</h3>
          <p>Save one before a big change, and the app will save one for you before any import.</p>
        </div>
      ) : (
        <section className="stack">
          <div className="section-title">
            <h2>History</h2>
            <span className="faint">{versions.length} of {MAX_VERSIONS}</span>
          </div>
          <div className="deck-rows">
            {versions.map((v, i) => (
              <VersionRow
                key={v.id}
                version={v}
                previous={versions[i + 1] ?? null}
                lookup={lookup}
                market={market}
                open={comparing === v.id}
                onCompare={() => setComparing(comparing === v.id ? null : v.id)}
                onRestore={() => onChange(restoreVersion(deck, v.id))}
                onDelete={() => onChange(deleteVersion(deck, v.id))}
                onRelabel={(text) => onChange(relabelVersion(deck, v.id, text))}
                current={current}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/**
 * The label box owns its own text. Keeping that state up in DeckHistory meant
 * every keystroke re-rendered all the version rows, each re-diffing a
 * hundred-card list — 41 ms a character on a throttled phone.
 */
function SaveVersionForm({ onSave, unchanged }) {
  const [label, setLabel] = useState('')
  const submit = () => { if (onSave(label)) setLabel('') }
  return (
    <div className="row row--wrap">
      <input
        className="input"
        value={label}
        placeholder="What changed — e.g. cut the artifact package"
        aria-label="Version label"
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        style={{ flex: '1 1 14rem' }}
      />
      <button className="btn btn--primary" onClick={submit} disabled={unchanged}>
        {unchanged ? 'No changes since last version' : 'Save version'}
      </button>
    </div>
  )
}

const VersionRow = memo(function VersionRow({ version, previous, lookup, market, open, current, onCompare, onRestore, onDelete, onRelabel }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(version.label)
  const when = new Date(version.at)
  const isCurrent = useMemo(() => diffVersions(version, current, lookup).empty, [version, current, lookup])

  return (
    <div className="version">
      <div className="version__head row row--wrap">
        {editing ? (
          <input
            className="input input--sm"
            value={draft}
            autoFocus
            aria-label="Rename version"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { onRelabel(draft); setEditing(false) }
              if (e.key === 'Escape') setEditing(false)
            }}
            onBlur={() => { onRelabel(draft); setEditing(false) }}
          />
        ) : (
          <button className="version__label" onClick={() => { setDraft(version.label); setEditing(true) }} title="Rename">
            {version.label || <span className="faint">{version.auto ? 'Automatic checkpoint' : 'Untitled version'}</span>}
          </button>
        )}
        {version.auto && <span className="chip tiny">auto</span>}
        {isCurrent && <span className="chip tiny chip--ok">current</span>}
        <span className="spacer" />
        <span className="faint tiny">
          {when.toLocaleDateString()} {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {' · '}{versionSize(version)} cards · {(versionBytes(version) / 1024).toFixed(1)} KB
        </span>
      </div>
      <div className="row row--wrap">
        <button className="btn btn--sm" onClick={onCompare} aria-expanded={open}>
          {open ? 'Hide changes' : 'Compare to now'}
        </button>
        <button className="btn btn--sm" onClick={onRestore} disabled={isCurrent} title={isCurrent ? 'This is the list as it stands' : 'Put this list back'}>
          Restore
        </button>
        <span className="spacer" />
        <button className="btn btn--sm btn--ghost btn--danger" onClick={onDelete} aria-label={`Delete version ${version.label || version.id}`}>✕</button>
      </div>
      {open && <Diff from={version} to={current} lookup={lookup} market={market} sinceLabel="now" />}
      {open && previous && (
        <details>
          <summary className="faint tiny">Compared to the version before it</summary>
          <Diff from={previous} to={version} lookup={lookup} market={market} sinceLabel="this version" />
        </details>
      )}
    </div>
  )
})

function Diff({ from, to, lookup, market, sinceLabel }) {
  const d = diffVersions(from, to, lookup, market, priceFor)
  if (d.empty) return <p className="faint tiny" style={{ margin: 0 }}>Identical.</p>

  const Row = ({ r, sign }) => (
    <li className={`diff__row diff__row--${sign}`}>
      <span className="diff__sign" aria-hidden="true">{sign === 'in' ? '+' : sign === 'out' ? '−' : '±'}</span>
      <span className="diff__name">{r.name}</span>
      <span className="faint tiny">
        {sign === 'change' ? `${r.from} → ${r.to}` : `×${sign === 'in' ? r.to : r.from}`}
        {r.zone === 'sideboard' ? ' · sideboard' : ''}
      </span>
    </li>
  )

  return (
    <div className="diff stack">
      {d.price && d.price.delta !== 0 && (
        <p className="faint tiny" style={{ margin: 0 }}>
          {formatPrice(d.price.before, market)} → {formatPrice(d.price.after, market)}
          {' '}({d.price.delta > 0 ? '+' : '−'}{formatPrice(Math.abs(d.price.delta), market)}) to {sinceLabel}
        </p>
      )}
      {d.commandersIn.length + d.commandersOut.length > 0 && (
        <ul className="diff__list">
          {d.commandersOut.map((r) => <li key={`co-${r.cardId}`} className="diff__row diff__row--out"><span className="diff__sign">−</span><span className="diff__name">{r.name}</span><span className="faint tiny">commander</span></li>)}
          {d.commandersIn.map((r) => <li key={`ci-${r.cardId}`} className="diff__row diff__row--in"><span className="diff__sign">+</span><span className="diff__name">{r.name}</span><span className="faint tiny">commander</span></li>)}
        </ul>
      )}
      <ul className="diff__list">
        {d.added.map((r) => <Row key={`in-${r.zone}-${r.cardId}`} r={r} sign="in" />)}
        {d.removed.map((r) => <Row key={`out-${r.zone}-${r.cardId}`} r={r} sign="out" />)}
        {d.changed.map((r) => <Row key={`ch-${r.zone}-${r.cardId}`} r={r} sign="change" />)}
      </ul>
    </div>
  )
}
