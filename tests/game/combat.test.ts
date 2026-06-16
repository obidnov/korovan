import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onDamageReceived, notifyDamageReceived } from '../../src/game/combat/damageHub'

// Reset handler list between tests by unsubscribing all registered handlers.
const unsubs: Array<() => void> = []
beforeEach(() => {
  while (unsubs.length) unsubs.pop()!()
})

describe('combat damage hub', () => {
  it('calls a registered handler when notifyDamageReceived fires', () => {
    const handler = vi.fn()
    unsubs.push(onDamageReceived(handler))
    notifyDamageReceived()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('calls multiple handlers in registration order', () => {
    const calls: number[] = []
    unsubs.push(onDamageReceived(() => calls.push(1)))
    unsubs.push(onDamageReceived(() => calls.push(2)))
    notifyDamageReceived()
    expect(calls).toEqual([1, 2])
  })

  it('calls a handler for each notification', () => {
    const handler = vi.fn()
    unsubs.push(onDamageReceived(handler))
    notifyDamageReceived()
    notifyDamageReceived()
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('does not call a handler after it is unsubscribed', () => {
    const handler = vi.fn()
    const unsub = onDamageReceived(handler)
    unsub()
    notifyDamageReceived()
    expect(handler).not.toHaveBeenCalled()
  })

  it('unsubscribing one handler does not affect others', () => {
    const a = vi.fn()
    const b = vi.fn()
    const unsubA = onDamageReceived(a)
    unsubs.push(onDamageReceived(b))
    unsubA()
    notifyDamageReceived()
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('notifyDamageReceived is a no-op when no handlers are registered', () => {
    expect(() => notifyDamageReceived()).not.toThrow()
  })
})
