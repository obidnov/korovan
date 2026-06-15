/**
 * Minimal audio surface needed to drive the footsteps loop. Modeled after Howl
 * so unit tests can substitute a plain object without pulling in Web Audio.
 */
export type FootstepsAudio = {
  play(): unknown
  stop(): unknown
}

export type FootstepsController = {
  /** Call once per frame with the player's current "is moving" state. */
  update(isMoving: boolean): void
  /** Force-stop the loop (e.g. on scene teardown). */
  stop(): void
}

/**
 * Edge-triggered driver for a looping footsteps sound. Starts the loop on the
 * rising edge of `isMoving` and stops it on the falling edge — never calls
 * play/stop while the state is steady.
 */
export function createFootstepsController(audio: FootstepsAudio): FootstepsController {
  let playing = false

  return {
    update(isMoving: boolean) {
      if (isMoving && !playing) {
        audio.play()
        playing = true
      } else if (!isMoving && playing) {
        audio.stop()
        playing = false
      }
    },
    stop() {
      if (playing) {
        audio.stop()
        playing = false
      }
    },
  }
}
