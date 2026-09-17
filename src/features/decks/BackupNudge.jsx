/**
 * One line about the state of the person's backup, on the Decks screen.
 * Its own file so the Decks list can show it without loading the whole
 * Your-data screen, which is lazy.
 */
export default function BackupNudge({ backup }) {
  if (backup.level === 'never') {
    return <div className="banner banner--warn tiny">You have {backup.changedSince} deck{backup.changedSince === 1 ? '' : 's'} and no backup yet.</div>
  }
  if (backup.level === 'stale') {
    return (
      <div className="banner banner--warn tiny">
        {backup.changedSince} deck{backup.changedSince === 1 ? '' : 's'} changed since your last backup
        {backup.last ? ` on ${new Date(backup.last).toLocaleDateString()}` : ''}.
      </div>
    )
  }
  if (backup.level === 'fresh' && backup.last) {
    return <p className="faint tiny" style={{ margin: 0 }}>Last backup {new Date(backup.last).toLocaleDateString()} — nothing has changed since.</p>
  }
  return null
}
