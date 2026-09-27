/**
 * What the seats panel says where the app has no relay's address (HANDOFF.md, M8's
 * review). The line is shown by a build made without one — the Pages app until the
 * owner sets `RELAY_URL` — and it once said "There is no hosted one yet", which
 * stopped being the app's to know the day a relay was deployed: whether one is hosted
 * somewhere is not something a build can see. It says only what the app knows.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import Seats from '../src/features/game/Seats.jsx'

let root = null
let container = null
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  // Nothing is asked of a relay without an address; a call would be a fault here.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no relay should be asked') }))
})
afterEach(async () => {
  if (root) await act(async () => { root.unmount() })
  container?.remove()
  root = null; container = null
  vi.unstubAllGlobals()
})

describe('the seats panel with no relay to reach', () => {
  it('says the app has no address for one, and never whether one is hosted anywhere', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<Seats />) })
    const form = container.querySelector('form.lobby__field')
    expect(form).not.toBeNull()
    expect(form.querySelector('.lobby__label').textContent).toBe('No relay to reach')
    const line = form.querySelector('p').textContent
    expect(line).toBe("Playing together needs a relay, and this app has not been given one. Run npm run relay and put its address here, or the address of a hosted relay.")
    expect(line).not.toMatch(/\bno hosted\b|\byet\b/i)
    expect(form.querySelector('input[aria-label="Relay address"]')).not.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
