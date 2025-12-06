# Predictoor 📈

A real-time BTC price prediction game. Guess where the price will be when the round ends, compete against other players, climb the live leaderboard.

**Live Demo:** https://chart-pred.vercel.app

![Predictoor Screenshot](https://img.shields.io/badge/status-archived-yellow)

---

## The Idea

What if predicting price movements felt like a game? You see a live BTC chart, type your prediction, and watch your rank change in real-time as the price moves toward or away from your guess. Closest prediction when the round ends wins.

**Core mechanics:**
- 60-second rounds synced to the minute
- Real-time Binance price data via WebSocket
- Live leaderboard that updates as price moves
- Visual feedback: your prediction line on the chart, rank changes (▲/▼), win streaks

---

## Tech Stack

- **Frontend:** Vanilla JS, HTML, CSS (no framework)
- **Charting:** [Lightweight Charts](https://github.com/nickingh/lightweight-charts) (TradingView's open-source library)
- **Data:** Binance WebSocket API (`btcusdt@aggTrade`)
- **Hosting:** Vercel (static)

---

## Retrospective

### What worked
- **The live rank tracking creates genuine tension.** Watching your position change as price ticks toward or away from your prediction is surprisingly engaging.
- **Low friction entry.** Click, type a number, play. No signup, no wallet connection.
- **The UX polish paid off.** Smooth chart, clear visual hierarchy, mobile-responsive.

### What didn't work
- **60-second predictions are pure noise.** There's no skill in guessing where BTC will be in a minute. It's a random number generator with extra steps.
- **No real stakes = no real engagement.** Without money/points/reputation on the line, winning feels hollow.
- **Simulated multiplayer is a band-aid.** The 20 "players" are bots. Real multiplayer would need a backend, and then you're building infrastructure for a game mechanic that might not even be fun.

### What would've made it work
1. **Longer timeframes** — End-of-day predictions where analysis matters
2. **Real stakes** — Prediction markets with actual money (but then: legal complexity)
3. **Social mechanics** — Shareable results, friend challenges, persistent leaderboards
4. **Different core mechanic** — Drawing predictions (the original idea) or binary up/down

### The takeaway
The interesting part wasn't "guess the exact price" — it was the **live competition visualization**. Seeing where you stand relative to others in real-time, watching that change. That mechanic could work in a different game.

---

## Run Locally

```bash
# Clone
git clone https://github.com/rohunvora/chart-pred.git
cd chart-pred

# Serve (any static server works)
npx serve public

# Or just open public/index.html in a browser
```

---

## License

MIT — do whatever you want with it.

---

*Built in a weekend. Archived with love. gg* 🎮
