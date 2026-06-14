import { Howl, Howler } from 'howler'

// Global volume baseline per spec (BOO-389)
Howler.volume(0.6)

/**
 * Looping footstep sound. Call .play() when the player starts moving,
 * .pause() or .stop() when they stop.
 */
export const footsteps = new Howl({
  src: ['/assets/audio/footsteps.wav'],
  loop: true,
})

/**
 * One-shot sword-swing effect. Triggered on each attack input.
 */
export const swordSwing = new Howl({
  src: ['/assets/audio/sword-swing.wav'],
})

/**
 * One-shot hit feedback. Triggered when the player or an enemy takes a hit.
 */
export const hit = new Howl({
  src: ['/assets/audio/hit.wav'],
})

/**
 * Looping forest-ambient background. Starts at low volume to avoid drowning
 * out gameplay audio. Call .play() once on scene load.
 */
export const forestAmbient = new Howl({
  src: ['/assets/audio/forest-ambient.wav'],
  loop: true,
  volume: 0.25,
})
