/**
 * Whether the engine's name for a card is the card the table sent it by.
 *
 * The sit sends a card by Scryfall's name (`engineName`, deck.js), which for a
 * card with two faces is "Front // Back"; the engine takes that name and knows
 * the card, and names it back — in what its seat was dealt, and in every view —
 * by its front alone (Server.kt, `resolveName`). So a stand-in commander with two
 * faces (HANDOFF.md §3 item 19), such as Edgar, Charmed Groom, a transforming
 * legend Argentum has, is sent as "Edgar, Charmed Groom // Edgar Markov's
 * Coffin" and named back as "Edgar, Charmed Groom". The card is the same where
 * the names are, or where the name sent begins with the one named back and a
 * face after it (found in the review of items 19 and 20, where a plain
 * comparison let such a stand-in go unsaid on the engine's copy).
 *
 * Shared by the relay (scripts/relay-engine.mjs) and the app, so the room and
 * the table agree on which card is the stand-in.
 */
export function sameCard(sent, named) {
  if (typeof sent !== 'string' || typeof named !== 'string' || !sent || !named) return false
  return sent === named || sent.startsWith(`${named} // `)
}
