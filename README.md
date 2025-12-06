# Chart Predictoor 🎯

Predict where Bitcoin goes next. Compete on the leaderboard.

## Features

- **Real-time BTC price** via Binance WebSocket
- **Signature-smooth drawing** for predictions
- **Live accuracy scoring** as price moves
- **Animated leaderboard** with rankings

## Tech Stack

- Vanilla JavaScript (no framework overhead)
- [Lightweight Charts](https://tradingview.github.io/lightweight-charts/) by TradingView
- Canvas API with cardinal spline smoothing
- Binance WebSocket for live price data

## Development

```bash
npm run dev
```

Then open http://localhost:3000

## Deploy

Push to GitHub and connect to Vercel, or:

```bash
npx vercel
```

## License

MIT
