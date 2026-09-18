import { describe, it, expect, afterEach } from 'vitest'
import { defaultBackend, isQuotaError } from '../src/lib/storage-backend.js'

/**
 * A full localStorage is still localStorage. The probe used to treat any
 * refused write as "no storage" and serve an empty memory store, so a
 * browser that had merely run out of room showed no decks at all.
 */
const original = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem')

afterEach(() => { Object.defineProperty(Storage.prototype, 'setItem', original); localStorage.clear() })

const quotaError = () => { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; return e }

describe('defaultBackend', () => {
  it('keeps localStorage when the probe is refused for lack of room', () => {
    localStorage.setItem('mtg-companion:v1:deck:d1', '{"id":"d1"}')
    Object.defineProperty(Storage.prototype, 'setItem', { value: () => { throw quotaError() }, configurable: true })
    const backend = defaultBackend('mtg-companion:v1')
    expect(backend.name).toBe('localStorage')
    expect(backend.read('mtg-companion:v1:deck:d1')).toBe('{"id":"d1"}')
    expect(backend.keys()).toContain('mtg-companion:v1:deck:d1')
    expect(backend.write('x', 'y')).toBe(false)
  })
  it('falls back to memory when storage cannot be touched at all', () => {
    Object.defineProperty(Storage.prototype, 'setItem', { value: () => { const e = new Error('denied'); e.name = 'SecurityError'; throw e }, configurable: true })
    expect(defaultBackend('mtg-companion:v1').name).not.toBe('localStorage')
  })
  it('knows the quota errors by name and by code', () => {
    expect(isQuotaError(quotaError())).toBe(true)
    expect(isQuotaError({ code: 22 })).toBe(true)
    expect(isQuotaError({ name: 'SecurityError' })).toBe(false)
    expect(isQuotaError(null)).toBe(false)
  })
})
