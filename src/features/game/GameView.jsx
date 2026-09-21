import { useMemo } from 'react'
import { listDecks } from '../../lib/storage.js'
import { navigate } from '../../lib/router.js'
import Lobby from './Lobby.jsx'
import Table from './Table.jsx'
import './game.css'

/**
 * The rebuilt table, at #/game.
 *
 * This is the shell described in docs/table-rebuild: Moxgate's shape with the
 * two frictions taken out, built beside the existing Table rather than inside
 * it. Nothing here imports from features/table, and nothing there imports
 * from here — the one shared thing is the deck data, which both read from
 * storage. That separation is the whole point: the old table keeps working,
 * untouched, until this one is better on every axis.
 *
 * Reached by address only until then, which is how the practice table
 * arrived too. There is no tab for it and nothing links to it, so nobody
 * lands here by accident while it is half built.
 */
/*
 * Every way back to the lobby says `gameDeckId: null` out loud. The router
 * keeps a tab's own state when the tab does not change, so from #/game/d1 a
 * plain navigate({ tab: 'game' }) stays exactly where it is; only a key set to
 * null is cleared. The first spec run caught this — the button did nothing.
 */
export default function GameView({ route, onOpenCard }) {
  const decks = useMemo(() => listDecks(), [])
  const deck = route.gameDeckId ? decks.find((d) => d.id === route.gameDeckId) ?? null : null
  const room = route.gameRoom ?? null
  const engine = route.gameEngine ?? null

  if (route.gameDeckId && !deck) {
    return (
      <div className="stack">
        <div className="banner banner--warn" role="alert">
          That deck is not on this device any more.
          <div className="row" style={{ marginTop: 'var(--space-2)' }}>
            <button className="btn btn--primary btn--sm" onClick={() => navigate({ tab: 'game', gameDeckId: null, gameRoom: null, gameEngine: null })}>Back to the lobby</button>
          </div>
        </div>
      </div>
    )
  }

  // Keyed by deck, so leaving one game for another is a new table rather than
  // the old one's state with a different deck underneath it.
  if (deck) return <Table key={`${engine ?? room ?? 'solo'}:${deck.id}`} deck={deck} onOpenCard={onOpenCard} room={room} engine={engine} />
  return <Lobby decks={decks} room={room} engine={engine} />
}

