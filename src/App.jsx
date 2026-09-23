import { useEffect, useRef } from 'react'
import './index.css'
import './ledger.css'
import bodyHtml from './ledger-body.html?raw'
import scriptSource from './ledger-script.js?raw'
import Chart from 'chart.js/auto'

/**
 * Ledger — Personal Trading Terminal (React)
 * Watchlist, journal, portfolio (avg price), analytics, trading plan, settings.
 * Supports B3 (brapi.dev) + global markets (Twelve Data) + crypto (CoinGecko).
 */
export default function App() {
  const rootRef = useRef(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    window.Chart = Chart

    const mount = rootRef.current
    if (!mount) return
    mount.innerHTML = bodyHtml

    try {
      // Original imperative app (localStorage, fetch, Chart.js)
      // eslint-disable-next-line no-new-func
      const run = new Function(scriptSource)
      run()
    } catch (err) {
      console.error('Ledger boot error:', err)
      mount.insertAdjacentHTML(
        'afterbegin',
        `<div class="status-box error" style="margin:20px">Failed to start Ledger: ${String(err.message || err)}</div>`
      )
    }
  }, [])

  return <div ref={rootRef} id="ledger-root" />
}
