import { describe, it, expect } from 'vitest'
import { setupCounter } from '../src/counter'

describe('setupCounter', () => {
  it('renders "count is 0" initially', () => {
    const button = document.createElement('button')
    setupCounter(button)
    expect(button.innerHTML).toBe('count is 0')
  })

  it('increments on each click', () => {
    const button = document.createElement('button')
    setupCounter(button)
    button.click()
    expect(button.innerHTML).toBe('count is 1')
    button.click()
    expect(button.innerHTML).toBe('count is 2')
  })
})
