import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getPrintings } from '../lib/scryfall.js'
import { orderPrintings } from '../lib/board/art.js'

/**
 * A card's printings as the printing picker and the card's own page list
 * them, a page of Scryfall's at a time.
 *
 * Scryfall sends a card's printings 175 to a page, newest first, and a basic
 * land has several pages. Both lists used to show the first and stop, so a
 * player who owns an older copy could not pick it. The first page is fetched
 * when the list opens, as before; each older page only when somebody presses
 * for it, since a player choosing among the newest has asked for nothing more.
 * Whatever has arrived is put in one order by orderPrintings, so a page does
 * not sit apart at the bottom, and a digital printing still follows every
 * paper one. The card the list is for (the deck's copy, or the one on
 * screen) leads it even before the page that holds it has come: it is in
 * hand, and it is the one being changed away from. Without that, a player who
 * had picked a copy from the sixth page opened the list again to find theirs
 * missing from it. `extra` says it is listed from hand, so the count can say so.
 *
 * Pressing moves focus to the first printing the page brought, wherever the
 * order put it, or, when it brought none that was not already listed, to the
 * line that says what is shown. Without that, focus was left on a button that
 * had just gone. `now` is only there so a test can fix the day.
 */
export function usePrintings(card, { now } = {}) {
  const [state, setState] = useState(START)
  const busy = useRef(false)
  const signal = useRef(null)
  const latest = useRef({ card, state })
  latest.current = { card, state }
  const arrivedRef = useRef(null)
  const statusRef = useRef(null)

  useEffect(() => {
    const abort = new AbortController()
    signal.current = abort.signal
    busy.current = false
    setState(START)
    getPrintings(card, { signal: abort.signal })
      .then((page) => {
        if (!abort.signal.aborted) setState({ ...START, status: 'ready', found: page.cards, totalCards: page.totalCards, next: page.next })
      })
      .catch(() => { if (!abort.signal.aborted) setState({ ...START, status: 'failed' }) })
    // Closing the list drops a request still waiting in the queue.
    return () => abort.abort()
  }, [card?.id, card?.oracle_id])

  const loadMore = useCallback(() => {
    const { card: which, state: current } = latest.current
    const from = current.next
    const asked = signal.current
    if (!from || busy.current || !asked || asked.aborted) return
    busy.current = true
    setState((s) => ({ ...s, more: 'loading' }))
    getPrintings(which, { signal: asked, next: from })
      .then((page) => {
        if (asked.aborted) return
        setState((s) => {
          // The card itself was listed already, from hand.
          const known = new Set([...s.found.map((c) => c.id), which?.id])
          return {
            ...s,
            found: [...s.found, ...page.cards],
            totalCards: page.totalCards ?? s.totalCards,
            next: page.next,
            pages: s.pages + 1,
            more: 'idle',
            arrived: { ids: page.cards.map((c) => c.id).filter((id) => !known.has(id)) },
          }
        })
      })
      .catch(() => { if (!asked.aborted) setState((s) => ({ ...s, more: 'failed' })) })
      .finally(() => { if (signal.current === asked) busy.current = false })
  }, [])

  const extra = state.status === 'ready' && !!card?.id && !state.found.some((c) => c.id === card.id)
  const printings = useMemo(
    () => (state.status === 'ready' ? orderPrintings(extra ? [card, ...state.found] : state.found, card?.id, now) : null),
    // Keyed on the card's id, as the fetch is: a caller may hand in a new
    // object for the same card on every render.
    [state.status, state.found, card?.id, extra, now],
  )

  const arrivedId = useMemo(() => {
    if (!state.arrived || !printings) return null
    const ids = new Set(state.arrived.ids)
    return printings.find((c) => ids.has(c.id))?.id ?? null
  }, [state.arrived, printings])

  useEffect(() => {
    if (state.arrived) (arrivedRef.current ?? statusRef.current)?.focus()
  }, [state.arrived])

  return {
    printings,
    extra,
    // The printings from Scryfall's pages, which is what its total counts.
    shown: printings ? printings.length - (extra ? 1 : 0) : 0,
    failed: state.status === 'failed',
    totalCards: state.totalCards,
    hasMore: !!state.next,
    paged: state.pages > 1,
    loadingMore: state.more === 'loading',
    moreFailed: state.more === 'failed',
    loadMore,
    arrivedId,
    arrivedRef,
    statusRef,
  }
}

const START = { status: 'loading', found: [], totalCards: null, next: null, pages: 1, more: 'idle', arrived: null }

/**
 * The line under a list of printings: how many of Scryfall's are shown, and
 * the button for the next page. Nothing for a card whose printings fit on one
 * page, which is most cards. The count is the printings listed from
 * Scryfall's pages, and the total is Scryfall's own, so neither is worked out
 * here. `current` names the card listed from hand before its page has come:
 * "yours" in the picker, "this printing" on a card's page.
 */
export function OlderPrintings({ pages, current = 'yours' }) {
  const { printings, extra, shown, totalCards, hasMore, paged, loadingMore, moreFailed, loadMore, statusRef } = pages
  if (!printings || (!hasMore && !paged)) return null
  const which = !hasMore ? `all ${shown}` : `the newest ${shown}${totalCards != null ? ` of ${totalCards}` : ''}`
  let line = `Showing ${extra ? `${current} and ` : ''}${which} printings.`
  if (hasMore && totalCards == null) line += ' Scryfall lists older ones.'
  if (loadingMore) line += ' Looking for older ones…'
  else if (moreFailed) line += ' The older ones could not be fetched from Scryfall just now.'
  return (
    <div className="row row--wrap">
      {/* Focus lands here when a page brought nothing new to focus on. */}
      <p ref={statusRef} tabIndex={-1} className="faint tiny m0 grow" aria-live="polite">{line}</p>
      {hasMore && (
        <button
          type="button"
          className="btn btn--sm"
          onClick={loadMore}
          aria-disabled={loadingMore || undefined}
        >
          Older printings
        </button>
      )}
    </div>
  )
}
