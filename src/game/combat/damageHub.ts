// Damage notification hub. BOO-386 (Melee combat + HP) calls
// notifyDamageReceived() whenever a hit lands on the player or an enemy.

type DamageHandler = () => void

const handlers: DamageHandler[] = []

/**
 * Register a callback to be invoked on every damage-received event.
 * Returns an unsubscribe function.
 */
export function onDamageReceived(handler: DamageHandler): () => void {
  handlers.push(handler)
  return () => {
    const idx = handlers.indexOf(handler)
    if (idx !== -1) handlers.splice(idx, 1)
  }
}

/**
 * Call this when a hit lands. Invokes all registered damage handlers.
 * Called by the melee combat system (BOO-386) for both player and enemy hits.
 */
export function notifyDamageReceived(): void {
  for (const handler of handlers) {
    handler()
  }
}
