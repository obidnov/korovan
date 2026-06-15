import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import type { SceneAudioHandle } from '../src/audio/sceneAudio'

// Howler touches Web Audio API — mock before any import that transitively loads it.
const mockHowl = {
  volume: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  fade: vi.fn(),
  once: vi.fn(),
}

vi.mock('howler', () => ({
  Howl: vi.fn().mockImplementation(() => mockHowl),
  Howler: { volume: vi.fn() },
}))

let startSceneAudio: typeof import('../src/audio/sceneAudio').startSceneAudio

beforeAll(async () => {
  const mod = await import('../src/audio/sceneAudio')
  startSceneAudio = mod.startSceneAudio
})

// afterEach cleans up the visibilitychange listener from any handle left open.
let pendingHandle: SceneAudioHandle | null = null

function resetMocks() {
  mockHowl.volume.mockReturnValue(0.25)
  mockHowl.play.mockReturnValue(mockHowl)
  mockHowl.pause.mockReturnValue(mockHowl)
  mockHowl.stop.mockReturnValue(mockHowl)
  mockHowl.fade.mockReturnValue(mockHowl)
  mockHowl.once.mockReturnValue(mockHowl)
}

beforeEach(() => {
  vi.clearAllMocks()
  resetMocks()
  pendingHandle = null
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
})

afterEach(async () => {
  if (pendingHandle) {
    mockHowl.volume.mockReturnValue(0)
    await pendingHandle.unload()
    pendingHandle = null
  }
})

describe('startSceneAudio — load', () => {
  it('silences, plays, then fades in to 0.25', () => {
    pendingHandle = startSceneAudio()

    expect(mockHowl.volume).toHaveBeenCalledWith(0)
    expect(mockHowl.play).toHaveBeenCalled()
    expect(mockHowl.fade).toHaveBeenCalledWith(0, 0.25, 2_000)
  })

  it('returns a handle with pause, resume, and unload methods', () => {
    pendingHandle = startSceneAudio()
    expect(typeof pendingHandle.pause).toBe('function')
    expect(typeof pendingHandle.resume).toBe('function')
    expect(typeof pendingHandle.unload).toBe('function')
  })
})

describe('startSceneAudio — unload', () => {
  it('fades out then stops when volume > 0', async () => {
    mockHowl.volume.mockReturnValue(0.25)
    const handle = startSceneAudio()

    // Simulate Howler firing the 'fade' event immediately
    mockHowl.once.mockImplementationOnce((_: string, cb: () => void) => {
      cb()
      return mockHowl
    })

    await handle.unload()
    pendingHandle = null // already cleaned up

    expect(mockHowl.fade).toHaveBeenCalledWith(0.25, 0, 1_000)
    expect(mockHowl.stop).toHaveBeenCalled()
  })

  it('stops immediately without a fade-out when volume is 0', async () => {
    mockHowl.volume.mockReturnValue(0)
    const handle = startSceneAudio()

    await handle.unload()
    pendingHandle = null // already cleaned up

    expect(mockHowl.stop).toHaveBeenCalled()
    // Only the fade-in should exist; no fade-out (to 0) should have been issued
    const toZeroCalls = mockHowl.fade.mock.calls.filter((args) => args[1] === 0)
    expect(toZeroCalls).toHaveLength(0)
  })
})

describe('startSceneAudio — pause / resume', () => {
  it('pauses the howl when pause() is called', () => {
    pendingHandle = startSceneAudio()
    pendingHandle.pause()
    expect(mockHowl.pause).toHaveBeenCalled()
  })

  it('resumes playback when resume() is called while tab is visible', () => {
    pendingHandle = startSceneAudio()
    pendingHandle.pause()
    vi.clearAllMocks()
    resetMocks()

    pendingHandle.resume()

    expect(mockHowl.play).toHaveBeenCalled()
  })

  it('resume() is a no-op when the tab is hidden', () => {
    pendingHandle = startSceneAudio()
    pendingHandle.pause()
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    vi.clearAllMocks()
    resetMocks()

    pendingHandle.resume()

    expect(mockHowl.play).not.toHaveBeenCalled()
  })
})

describe('startSceneAudio — visibility', () => {
  it('pauses when tab becomes hidden', () => {
    pendingHandle = startSceneAudio()

    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(mockHowl.pause).toHaveBeenCalled()
  })

  it('resumes when tab becomes visible', () => {
    pendingHandle = startSceneAudio()

    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    // play() called once on start + once on tab-resume
    expect(mockHowl.play).toHaveBeenCalledTimes(2)
  })

  it('does not resume on tab-visible when game is paused', () => {
    const handle = startSceneAudio()
    pendingHandle = handle
    handle.pause()
    vi.clearAllMocks()
    resetMocks()

    // Tab becomes visible while game is paused — audio must stay silent
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(mockHowl.play).not.toHaveBeenCalled()
  })

  it('removes visibilitychange listener after unload', async () => {
    mockHowl.volume.mockReturnValue(0)
    const handle = startSceneAudio()

    await handle.unload()
    pendingHandle = null // already cleaned up

    vi.clearAllMocks()
    resetMocks()

    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    expect(mockHowl.pause).not.toHaveBeenCalled()
  })
})
