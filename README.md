# Chart Predictoor 📈

**A real-time BTC price prediction game where your rank changes live as the market moves toward or away from your guess.**

The magic isn't in predicting the exact price—it's watching your position climb and fall in real-time as each price tick brings you closer to victory or defeat. Make your prediction, then experience the genuine tension of live rank tracking during 60-second rounds.

**🎮 [Play Live Demo](https://chart-pred.vercel.app)**

![Status](https://img.shields.io/badge/status-archived-yellow)

## What It Does

- **Live price predictions** — Guess where BTC will be when the 60-second round ends
- **Real-time rank updates** — Watch your leaderboard position change as price moves
- **Visual feedback** — See your prediction line on the TradingView chart
- **Instant competition** — Jump in and play immediately, no signup required
- **Mobile responsive** — Works seamlessly on desktop and mobile

## How It Works

1. **Join a round** — Rounds sync to the minute, so everyone predicts the same target time
2. **Make your prediction** — Enter your price guess and see it plotted on the live chart
3. **Watch the tension build** — Your rank updates in real-time as the market moves
4. **See who wins** — Closest prediction when time expires takes the round

## Tech Stack

- **Frontend:** Vanilla JavaScript (no framework overhead)
- **Charts:** [Lightweight Charts](https://github.com/tradingview/lightweight-charts) by TradingView
- **Live Data:** Binance WebSocket API (`btcusdt@aggTrade`)
- **Deployment:** Vercel static hosting

## Quick Start

```bash
# Clone and run locally
git clone https://github.com/yourusername/chart-predictoor
cd chart-predictoor
npx serve public -l 3000
```

Open `http://localhost:3000` and start predicting!

## Project Status: Archived

This was an experiment in real-time game mechanics. The **live rank visualization worked brilliantly**—that moment when you watch your position change as each price tick comes in creates genuine engagement.

However, 60-second BTC predictions are essentially random. The core mechanic (live rank tracking during market movement) has potential for other applications where skill actually matters.

### Key Learnings

✅ **Live rank updates create real tension**  
✅ **Low-friction entry drives participation**  
✅ **Visual polish significantly impacts engagement**  

❌ **Ultra-short timeframes eliminate skill**  
❌ **No stakes = no lasting engagement**  
❌ **Simulated multiplayer feels hollow**

## License

MIT - Feel free to fork and experiment with the live ranking mechanics in your own projects.