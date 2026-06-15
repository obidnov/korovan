import { forestAmbient } from './sounds'

const FADE_IN_MS = 2_000
const FADE_OUT_MS = 1_000
const TARGET_VOLUME = 0.25

export interface SceneAudioHandle {
  /** Pause ambient immediately (e.g. pause menu, death screen). */
  pause(): void
  /** Resume ambient after a pause. No-op if the tab is currently hidden. */
  resume(): void
  /**
   * Fade out and stop the ambient loop.
   *
   * Removes the visibilitychange listener. Safe to call from beforeunload or
   * any scene-teardown path. Resolves after the fade completes (or immediately
   * if volume is already 0).
   */
  unload(): Promise<void>
}

/**
 * Start the forest ambient loop for the current scene.
 *
 * Fades in from silence over 2 s. Wires `visibilitychange` so the loop
 * auto-pauses when the tab is hidden and resumes when visible (unless the
 * game is paused, in which case tab-resume is suppressed).
 *
 * Returns a {@link SceneAudioHandle}. Wire `pause`/`resume` to pause-menu
 * open/close and death-screen show/hide. Call `unload` before scene teardown,
 * on return-to-menu, or on beforeunload.
 */
export function startSceneAudio(): SceneAudioHandle {
  forestAmbient.volume(0)
  forestAmbient.play()
  forestAmbient.fade(0, TARGET_VOLUME, FADE_IN_MS)

  let gamePaused = false

  function onVisibilityChange() {
    if (document.hidden) {
      forestAmbient.pause()
    } else if (!gamePaused) {
      forestAmbient.play()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  return {
    pause() {
      gamePaused = true
      forestAmbient.pause()
    },

    resume() {
      if (document.hidden) return
      gamePaused = false
      forestAmbient.play()
    },

    unload(): Promise<void> {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      const vol = forestAmbient.volume() as number
      if (vol <= 0) {
        forestAmbient.stop()
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        forestAmbient.once('fade', () => {
          forestAmbient.stop()
          resolve()
        })
        forestAmbient.fade(vol, 0, FADE_OUT_MS)
      })
    },
  }
}
