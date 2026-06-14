/**
 * Loot HUD — minimal DOM overlay that shows "[E] Loot" when the player is
 * within interaction range of the cart and all escorts are dead.
 *
 * Also shows a brief "Cart emptied!" flash on successful loot.
 */

export interface LootHud {
  /** Show or hide the "[E] Loot" prompt. */
  setPromptVisible(visible: boolean): void
  /** Flash "Cart emptied!" for 2 seconds, then hide. */
  flashLooted(): void
  /** Remove DOM nodes. */
  dispose(): void
}

export function createLootHud(): LootHud {
  const prompt = document.createElement('div')
  prompt.id = 'caravan-loot-prompt'
  prompt.textContent = '[E] Loot cart'
  prompt.style.cssText = [
    'position:fixed',
    'bottom:20%',
    'left:50%',
    'transform:translateX(-50%)',
    'color:#ffe',
    'font:bold 18px/1 sans-serif',
    'text-shadow:0 1px 4px #000',
    'pointer-events:none',
    'display:none',
    'background:rgba(0,0,0,.45)',
    'padding:6px 14px',
    'border-radius:6px',
  ].join(';')
  document.body.appendChild(prompt)

  const flash = document.createElement('div')
  flash.id = 'caravan-loot-flash'
  flash.textContent = 'Cart emptied!'
  flash.style.cssText = [
    'position:fixed',
    'top:40%',
    'left:50%',
    'transform:translateX(-50%)',
    'color:#ffd700',
    'font:bold 24px/1 sans-serif',
    'text-shadow:0 2px 6px #000',
    'pointer-events:none',
    'display:none',
    'transition:opacity .4s',
  ].join(';')
  document.body.appendChild(flash)

  let flashTimer: ReturnType<typeof setTimeout> | null = null

  function setPromptVisible(visible: boolean): void {
    prompt.style.display = visible ? 'block' : 'none'
  }

  function flashLooted(): void {
    if (flashTimer != null) clearTimeout(flashTimer)
    flash.style.opacity = '1'
    flash.style.display = 'block'
    flashTimer = setTimeout(() => {
      flash.style.opacity = '0'
      flashTimer = setTimeout(() => {
        flash.style.display = 'none'
        flashTimer = null
      }, 450)
    }, 1600)
  }

  function dispose(): void {
    prompt.remove()
    flash.remove()
    if (flashTimer != null) clearTimeout(flashTimer)
  }

  return { setPromptVisible, flashLooted, dispose }
}
