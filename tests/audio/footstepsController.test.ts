import { describe, it, expect, vi } from 'vitest'
import { createFootstepsController } from '../../src/audio/footstepsController'

function makeAudio() {
  return { play: vi.fn(), stop: vi.fn() }
}

describe('createFootstepsController', () => {
  it('starts loop on rising edge of isMoving', () => {
    const audio = makeAudio()
    const ctl = createFootstepsController(audio)

    ctl.update(false)
    expect(audio.play).not.toHaveBeenCalled()

    ctl.update(true)
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.stop).not.toHaveBeenCalled()
  })

  it('stops loop on falling edge of isMoving', () => {
    const audio = makeAudio()
    const ctl = createFootstepsController(audio)

    ctl.update(true)
    ctl.update(false)

    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.stop).toHaveBeenCalledTimes(1)
  })

  it('does not re-trigger play while continuously moving', () => {
    const audio = makeAudio()
    const ctl = createFootstepsController(audio)

    for (let i = 0; i < 10; i++) ctl.update(true)

    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.stop).not.toHaveBeenCalled()
  })

  it('does not re-trigger stop while continuously idle', () => {
    const audio = makeAudio()
    const ctl = createFootstepsController(audio)

    for (let i = 0; i < 10; i++) ctl.update(false)

    expect(audio.play).not.toHaveBeenCalled()
    expect(audio.stop).not.toHaveBeenCalled()
  })

  it('toggles play/stop across multiple cycles', () => {
    const audio = makeAudio()
    const ctl = createFootstepsController(audio)

    ctl.update(true)
    ctl.update(false)
    ctl.update(true)
    ctl.update(false)
    ctl.update(true)

    expect(audio.play).toHaveBeenCalledTimes(3)
    expect(audio.stop).toHaveBeenCalledTimes(2)
  })

  it('stop() halts a playing loop and is idempotent when already stopped', () => {
    const audio = makeAudio()
    const ctl = createFootstepsController(audio)

    ctl.update(true)
    ctl.stop()
    expect(audio.stop).toHaveBeenCalledTimes(1)

    ctl.stop()
    expect(audio.stop).toHaveBeenCalledTimes(1)
  })

  it('stop() leaves controller able to resume on next rising edge', () => {
    const audio = makeAudio()
    const ctl = createFootstepsController(audio)

    ctl.update(true)
    ctl.stop()

    ctl.update(true)
    expect(audio.play).toHaveBeenCalledTimes(2)
  })
})
