import { describe, it, expect, vi, afterEach } from 'vitest'
import { createLoop } from '../../src/engine/loop'

// ---- RAF shim ---------------------------------------------------------------
type RafCb = (time: number) => void
let pendingCbs: RafCb[] = []

vi.stubGlobal('requestAnimationFrame', (cb: RafCb) => {
  pendingCbs.push(cb)
  return pendingCbs.length // fake id
})
vi.stubGlobal('cancelAnimationFrame', () => {
  // noop — tests call stop() to halt the loop
})

function flush(time: number) {
  const batch = pendingCbs.splice(0)
  for (const cb of batch) cb(time)
}

afterEach(() => {
  pendingCbs = []
})
// -----------------------------------------------------------------------------

describe('createLoop', () => {
  it('delivers dt=0 on first tick, correct dt thereafter', () => {
    const loop = createLoop()
    const dts: number[] = []

    loop.addTickCallback((dt) => dts.push(dt))
    loop.start()

    flush(0) // first tick — no previous time
    flush(100) // +100 ms  → dt ≈ 0.1 s
    flush(250) // +150 ms  → dt ≈ 0.15 s

    loop.stop()

    expect(dts[0]).toBe(0)
    expect(dts[1]).toBeCloseTo(0.1)
    expect(dts[2]).toBeCloseTo(0.15)
  })

  it('addTickCallback returns an unsubscribe that stops further calls', () => {
    const loop = createLoop()
    const calls: number[] = []

    const unsub = loop.addTickCallback((dt) => calls.push(dt))
    loop.start()

    flush(0)
    expect(calls).toHaveLength(1)

    unsub()
    flush(100)
    expect(calls).toHaveLength(1) // no new call after unsubscribe

    loop.stop()
  })

  it('stop() halts tick delivery', () => {
    const loop = createLoop()
    let count = 0

    loop.addTickCallback(() => {
      count++
    })
    loop.start()

    flush(0)
    expect(count).toBe(1)

    loop.stop()
    // After stop, any remaining flush should not invoke the callback
    // (RAF was cancelled; flush with no pending cbs is a no-op)
    flush(100)
    expect(count).toBe(1)
  })

  it('multiple callbacks all receive the same dt', () => {
    const loop = createLoop()
    const a: number[] = []
    const b: number[] = []

    loop.addTickCallback((dt) => a.push(dt))
    loop.addTickCallback((dt) => b.push(dt))
    loop.start()

    flush(0)
    flush(50)

    loop.stop()

    expect(a).toEqual(b)
    expect(a[1]).toBeCloseTo(0.05)
  })
})
