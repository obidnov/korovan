import './style.css'
import { setupCounter } from './counter'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div>
    <h1>korovan</h1>
    <div class="card">
      <button id="counter" type="button"></button>
    </div>
    <p style="margin-top:1rem;color:#888;font-size:0.85rem">
      3D action game — development build
    </p>
  </div>
`

setupCounter(document.querySelector<HTMLButtonElement>('#counter')!)
