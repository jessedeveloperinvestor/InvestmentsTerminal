# Ledger — Personal Trading Terminal (React)

Full trading terminal converted from the original HTML app into a Vite + React project.

## Features

- **Dashboard / Watchlist** — live prices (Twelve Data, brapi.dev B3, CoinGecko)
- **Trading Plan** — editable rules
- **Journal** — day / swing / holding entries with P/L
- **Portfolio** — average purchase price, shares, unrealized return
- **Analytics** — Chart.js (P/L, cumulative, win rate, allocation)
- **Settings** — API keys, favorites, JSON export/import
- Data persists in **browser localStorage**

## Run (React)

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Standalone HTML (no build)

Open `public/ledger-standalone.html` in a browser, or:

```bash
npx serve public
```

Then open `/ledger-standalone.html`.

## Import your data

1. Settings → Import JSON  
2. Use `public/ledger-data.json` (your exported Ledger data)

## Brazilian markets

- Select **B3 / Bovespa (BVMF)** when adding favorites or positions  
- Free brapi.dev tickers: PETR4, VALE3, MGLU3, ITUB4  
- Other B3 tickers: free token at https://brapi.dev/dashboard
