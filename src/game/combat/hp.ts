/**
 * HP component — pure logic, no engine deps. Testable in isolation.
 *
 * Integer HP in range [0, maxHp]. Zero fires onDeath callbacks exactly once
 * per death event; reset() restores to full and allows future deaths.
 */

export interface HpComponent {
  readonly hp: number
  readonly maxHp: number
  readonly isDead: boolean
  /** Reduce HP by amount (floored at 0). No-op when already dead. */
  takeDamage(amount: number): void
  /** Increase HP by amount (capped at maxHp). */
  heal(amount: number): void
  /** Restore to maxHp. */
  reset(): void
  /** Register a callback to fire when HP first reaches zero. */
  onDeath(cb: () => void): void
}

export function createHpComponent(maxHp: number): HpComponent {
  if (maxHp <= 0) throw new Error(`maxHp must be positive, got: ${maxHp}`)

  let hp = maxHp
  const deathCbs: (() => void)[] = []

  return {
    get hp() {
      return hp
    },
    get maxHp() {
      return maxHp
    },
    get isDead() {
      return hp <= 0
    },

    takeDamage(amount: number): void {
      if (hp <= 0) return
      hp = Math.max(0, hp - amount)
      if (hp === 0) {
        for (const cb of deathCbs) cb()
      }
    },

    heal(amount: number): void {
      hp = Math.min(maxHp, hp + amount)
    },

    reset(): void {
      hp = maxHp
    },

    onDeath(cb: () => void): void {
      deathCbs.push(cb)
    },
  }
}
