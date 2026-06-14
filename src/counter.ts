export function setupCounter(element: HTMLButtonElement): void {
  let count = 0
  const setCount = (n: number) => {
    element.innerHTML = `count is ${n}`
  }
  element.addEventListener('click', () => setCount(++count))
  setCount(0)
}
