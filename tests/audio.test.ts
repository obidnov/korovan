import { describe, it, expect, vi, beforeAll } from 'vitest'

// Howler touches Web Audio API which jsdom doesn't implement.
// Mock the module before importing sounds.ts so no audio is actually loaded.
const mockHowlInstances: Array<{ config: Record<string, unknown> }> = []

vi.mock('howler', () => {
  const Howl = vi.fn().mockImplementation((config: Record<string, unknown>) => {
    const instance = { config }
    mockHowlInstances.push(instance)
    return instance
  })
  const Howler = { volume: vi.fn() }
  return { Howl, Howler }
})

// Import after the mock is in place
let footsteps: unknown
let swordSwing: unknown
let hit: unknown
let forestAmbient: unknown
let Howler: { volume: ReturnType<typeof vi.fn> }
let Howl: ReturnType<typeof vi.fn>

beforeAll(async () => {
  const sounds = await import('../src/audio/sounds')
  footsteps = sounds.footsteps
  swordSwing = sounds.swordSwing
  hit = sounds.hit
  forestAmbient = sounds.forestAmbient
  const howler = await import('howler')
  Howler = howler.Howler as unknown as { volume: ReturnType<typeof vi.fn> }
  Howl = howler.Howl as ReturnType<typeof vi.fn>
})

describe('sounds module', () => {
  it('sets global volume baseline to 0.6', () => {
    expect(Howler.volume).toHaveBeenCalledWith(0.6)
  })

  it('exports all 4 sounds', () => {
    expect(footsteps).toBeDefined()
    expect(swordSwing).toBeDefined()
    expect(hit).toBeDefined()
    expect(forestAmbient).toBeDefined()
  })

  it('constructs 4 Howl instances', () => {
    expect(Howl).toHaveBeenCalledTimes(4)
  })

  it('footsteps is configured to loop', () => {
    const cfg = Howl.mock.calls.find(
      (args) => (args[0] as { src: string[] }).src[0].includes('footsteps')
    )?.[0] as { loop?: boolean } | undefined
    expect(cfg?.loop).toBe(true)
  })

  it('forestAmbient is configured to loop', () => {
    const cfg = Howl.mock.calls.find(
      (args) => (args[0] as { src: string[] }).src[0].includes('forest-ambient')
    )?.[0] as { loop?: boolean } | undefined
    expect(cfg?.loop).toBe(true)
  })

  it('forestAmbient has lower volume than the global baseline', () => {
    const cfg = Howl.mock.calls.find(
      (args) => (args[0] as { src: string[] }).src[0].includes('forest-ambient')
    )?.[0] as { volume?: number } | undefined
    expect(cfg?.volume).toBeDefined()
    expect(cfg!.volume!).toBeLessThan(0.6)
  })

  it('swordSwing does not loop', () => {
    const cfg = Howl.mock.calls.find(
      (args) => (args[0] as { src: string[] }).src[0].includes('sword-swing')
    )?.[0] as { loop?: boolean } | undefined
    expect(cfg?.loop).toBeFalsy()
  })

  it('hit does not loop', () => {
    const cfg = Howl.mock.calls.find(
      (args) => (args[0] as { src: string[] }).src[0].includes('hit.wav')
    )?.[0] as { loop?: boolean } | undefined
    expect(cfg?.loop).toBeFalsy()
  })

  it('all sounds point to files under /assets/audio/', () => {
    for (const call of Howl.mock.calls) {
      const src = (call[0] as { src: string[] }).src[0]
      expect(src).toMatch(/^\/assets\/audio\/.*\.wav$/)
    }
  })
})
