import type { InputState } from './player'

export type InputHandler = {
  state: InputState
  dispose(): void
}

export function createInputHandler(canvas: HTMLCanvasElement): InputHandler {
  const state: InputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
  }

  function onKey(e: KeyboardEvent, down: boolean) {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        state.forward = down
        break
      case 'KeyS':
      case 'ArrowDown':
        state.backward = down
        break
      case 'KeyA':
      case 'ArrowLeft':
        state.left = down
        break
      case 'KeyD':
      case 'ArrowRight':
        state.right = down
        break
      case 'Space':
        state.jump = down
        e.preventDefault()
        break
    }
  }

  const keydown = (e: KeyboardEvent) => onKey(e, true)
  const keyup = (e: KeyboardEvent) => onKey(e, false)

  window.addEventListener('keydown', keydown)
  window.addEventListener('keyup', keyup)

  // Pointer-lock click to enter; Escape releases automatically.
  canvas.addEventListener('click', () => {
    canvas.requestPointerLock()
  })

  function dispose() {
    window.removeEventListener('keydown', keydown)
    window.removeEventListener('keyup', keyup)
  }

  return { state, dispose }
}
