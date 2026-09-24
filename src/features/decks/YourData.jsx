import { useEffect, useState } from 'react'
import {
  exportAll, importAll, markExported, loadState, corruptBackup, discardCorruptBackup,
  backendName, lastSaveSucceeded,
} from '../../lib/storage.js'
import { storageUsage, backupStatus, formatBytes } from '../../lib/data-safety.js'
import { cacheStats, clearCache } from '../../lib/cache.js'
import BackupNudge from './BackupNudge.jsx'
import { BUILD, describeBuild } from '../../lib/version.js'

/**
 * Where your data is, how much room it has, and how to keep it.
 *
 * There are no accounts, so this browser is the only copy. That is the app's
 * whole design and it is worth being plain about: the way to keep your decks
 * is a file you own, and this is the screen that makes that one press.
 */
export default function YourData({ onClose, onChanged }) {
  const [state, setState] = useState(() => loadState())
  const [cache, setCache] = useState(null)
  const [estimate, setEstimate] = useState(null)
  const [status, setStatus] = useState(null)
  const [pendingFile, setPendingFile] = useState(null)
  // Held in state and read again on every refresh. Discarding it changes no
  // saved state, so read during render it went on showing until something
  // else happened to redraw the screen, which was the Decks screen reading a
  // list it had not yet seen. Once that screen heard every save, nothing did.
  const [corrupt, setCorrupt] = useState(() => corruptBackup())

  const usage = storageUsage(state)
  const backup = backupStatus(state)
  const refresh = () => { setState(loadState()); setCorrupt(corruptBackup()); onChanged?.() }

  useEffect(() => {
    cacheStats().then(setCache).catch(() => setCache(null))
    // Covers IndexedDB and the service-worker caches — the card images — not
    // localStorage, which browsers do not report. The two numbers are shown
    // separately for that reason.
    navigator.storage?.estimate?.().then(setEstimate).catch(() => setEstimate(null))
  }, [])

  const download = (text, name) => {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement('a'), { href: url, download: name })
    a.click()
    URL.revokeObjectURL(url)
  }

  const backupNow = () => {
    download(exportAll(), `mtg-companion-${new Date().toISOString().slice(0, 10)}.json`)
    markExported()
    refresh()
    setStatus({ tone: 'ok', text: 'Backup downloaded. That file is the copy that outlives this browser.' })
  }

  const chooseFile = (file) => {
    if (!file) return
    file.text().then((text) => setPendingFile({ name: file.name, text }))
  }

  const restore = (replace) => {
    try {
      importAll(pendingFile.text, { replace })
      setPendingFile(null)
      refresh()
      setStatus({ tone: 'ok', text: replace ? 'Restored. Everything here now matches the file.' : 'Merged. Decks from the file were added; yours were kept.' })
    } catch (error) {
      setStatus({ tone: 'error', text: error.message })
    }
  }

  const pct = Math.min(100, Math.round(usage.fraction * 100))
  const level = usage.fraction > 0.8 ? 'error' : usage.fraction > 0.5 ? 'warn' : 'ok'

  return (
    <div className="stack">
      <div className="row">
        <button className="btn btn--ghost btn--sm" onClick={onClose}>← Decks</button>
        <span className="spacer" />
        <span className="chip tiny">{backendName() === 'memory' ? 'not saving to this browser' : 'saved in this browser'}</span>
      </div>
      <h1>Your data</h1>

      {!lastSaveSucceeded() && (
        <div className="banner banner--error" role="alert">
          The last save did not reach storage. Download a backup now — what is on screen is only
          kept for this session.
        </div>
      )}

      <section className="panel stack">
        <h3>Backup</h3>
        <p className="muted tiny m0">
          There are no accounts. This browser holds the only copy of your decks, and a browser can
          be cleared, replaced or lost. A backup is one JSON file with everything in it — decks,
          their history, your collection and your guide progress — and it is yours to keep.
        </p>
        <BackupNudge backup={backup} />
        <div className="row row--wrap">
          <button className="btn btn--primary" onClick={backupNow}>Download a backup</button>
          <label className="btn">
            Restore from a file
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => { chooseFile(e.target.files?.[0]); e.target.value = '' }}
            />
          </label>
        </div>
        {pendingFile && (
          <div className="panel stack panel--accent">
            <p className="m0">
              <strong>{pendingFile.name}</strong> — merge it into what is here, or replace everything
              with it? Merging never overwrites a deck you have; a clashing id is kept as a copy.
            </p>
            <div className="row row--wrap">
              <button className="btn btn--primary" onClick={() => restore(false)}>Merge</button>
              <button className="btn btn--danger" onClick={() => restore(true)}>Replace everything</button>
              <button className="btn btn--ghost" onClick={() => setPendingFile(null)}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      <section className="panel stack">
        <h3>Space</h3>
        <div className="meter" aria-label={`Storage used: ${pct}% of the assumed limit`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="meter__fill" style={{ width: `${pct}%`, background: `var(--${level})` }} />
        </div>
        <p className="muted tiny m0">
          {formatBytes(usage.total)} of about {formatBytes(usage.cap)}. Browsers do not say exactly
          how much they allow, so this assumes the common limit; a browser with more room simply
          fails later than this predicts. If a save is ever refused, the app drops automatic
          version checkpoints — the only thing it made on its own — and tries again before giving
          up.
        </p>
        <dl className="facts">
          <Fact label="Decks" value={`${usage.counts.decks} · ${formatBytes(usage.sections.decks)}`} />
          <Fact label="Deck history" value={`${usage.counts.versions} versions (${usage.counts.autoVersions} automatic) · ${formatBytes(usage.sections.versions)}`} />
          <Fact label="Collection" value={`${usage.counts.collection} cards · ${formatBytes(usage.sections.collection)}`} />
          <Fact label="Games" value={`${usage.counts.games} · ${formatBytes(usage.sections.games)}`} />
          <Fact label="Guide progress" value={formatBytes(usage.sections.guide)} />
        </dl>
      </section>

      <section className="panel stack">
        <h3>Card cache</h3>
        <p className="muted tiny m0">
          Cards and images you have looked at, kept so the app works offline. Separate from your
          data: clearing it loses nothing of yours, and anything a deck needs is fetched again.
        </p>
        <dl className="facts">
          {cache && Object.entries(cache).map(([k, v]) => <Fact key={k} label={k} value={String(v)} />)}
          {estimate?.usage != null && (
            <Fact label="On disk (all caches)" value={`${formatBytes(estimate.usage)}${estimate.quota ? ` of ${formatBytes(estimate.quota)}` : ''}`} />
          )}
        </dl>
        <div className="row">
          <button
            className="btn btn--ghost"
            onClick={() => clearCache().then(() => cacheStats()).then(setCache).then(() => setStatus({ tone: 'ok', text: 'Card cache cleared.' }))}
          >
            Clear card cache
          </button>
        </div>
        <p className="faint tiny m0" data-build={BUILD.id}>
          Build {describeBuild()}. When a newer one is published, a banner at the top offers a reload.
        </p>
      </section>

      {corrupt && (
        <section className="panel stack panel--warn">
          <h3>A file that could not be read</h3>
          <p className="muted tiny m0">
            At some point this browser held saved data the app could not parse — usually a write
            cut short. It was set aside rather than written over. It is {formatBytes(corrupt.length)};
            download it and it may be recoverable by hand, or discard it if you have a backup.
          </p>
          <div className="row row--wrap">
            <button className="btn" onClick={() => download(corrupt, 'mtg-companion-unreadable.json')}>Download it</button>
            <button className="btn btn--ghost btn--danger" onClick={() => { discardCorruptBackup(); refresh() }}>Discard it</button>
          </div>
        </section>
      )}

      {status && <div className={`banner banner--${status.tone} tiny`}>{status.text}</div>}
    </div>
  )
}

/** Only speaks up when there is something to say. */

function Fact({ label, value }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
