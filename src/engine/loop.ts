export type TickCallback = (dt: number) => void

export type GameLoop = {
  start: () => void
  stop: () => void
  /** Returns an unsubscribe function. */
  addTickCallback: (cb: TickCallback) => () => void
}

export function createLoop(): GameLoop {
  const callbacks = new Set<TickCallback>()
  let running = false
  let lastTime: number | null = null
  let rafId: number | null = null

  function tick(time: number) {
    if (!running) return

    const dt = lastTime !== null ? (time - lastTime) / 1000 : 0
    lastTime = time

    for (const cb of callbacks) {
      cb(dt)
    }

    rafId = requestAnimationFrame(tick)
  }

  return {
    start() {
      if (running) return
      running = true
      lastTime = null
      rafId = requestAnimationFrame(tick)
    },

    stop() {
      running = false
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    },

    addTickCallback(cb: TickCallback) {
      callbacks.add(cb)
      return () => {
        callbacks.delete(cb)
      }
    },
  }
}
