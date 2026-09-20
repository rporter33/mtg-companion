import { getPrefs, setPref } from '../../lib/storage.js'

/**
 * Where the relay is.
 *
 * A build can carry it (`VITE_RELAY_URL`, set where the app is built for a
 * host that runs one), and a person can set it themselves, which is how the
 * app is used against `npm run relay` on a laptop until a hosted relay
 * exists. Nothing is assumed: with no address there is no "invite" button,
 * and the seats panel says why.
 */
export function relayAddress() {
  const built = import.meta.env?.VITE_RELAY_URL
  const own = getPrefs().relayUrl
  const url = String(own || built || '').trim().replace(/\/$/, '')
  return /^https?:\/\//.test(url) ? url : null
}

export function setRelayAddress(url) {
  setPref('relayUrl', String(url ?? '').trim())
}

/** The link a friend opens to sit down at a room: this app, this room. */
export function inviteLink(code) {
  const here = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : ''
  return `${here}#/game/room/${code}`
}
