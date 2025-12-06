// Predictoor - Clean Layout, Minimal Y-Axis Labels
(function() {
  'use strict';

  const ROUND_DURATION = 60;

  const state = {
    chart: null,
    series: null,
    ws: null,
    
    // Prices
    currentPrice: 0,
    displayPrice: 0,
    targetPrice: 0,
    priceHistory: [],
    priceBuffer: [],
    
    // Round
    roundStartTime: 0,
    roundEndTime: 0,
    roundStartPrice: 0,
    roundStatus: 'active',
    
    // Predictions
    myPrediction: null,
    predictions: [], // { id, nickname, price, color, line }
    
    // Only these get Y-axis labels
    myPriceLine: null,
    leaderPriceLine: null,
    currentLeaderId: null,
    
    // Timing
    lastChartUpdate: 0,
  };

  const DOM = {};

  // ==========================================
  // INIT
  // ==========================================
  function init() {
    cacheDom();
    initChart();
    setupEventListeners();
    
    // Load data FIRST, then start everything else
    loadHistoricalData().then(() => {
      console.log('Data loaded, price:', state.currentPrice);
      startRound();
      connectWebSocket();
      setTimeout(addSimulatedPlayers, 500);
      // Start animation loop AFTER we have data
      requestAnimationFrame(animationLoop);
    }).catch(err => {
      console.error('Failed to load data:', err);
      // Fallback: start anyway with default price
      state.currentPrice = 90000;
      state.displayPrice = 90000;
      state.targetPrice = 90000;
      startRound();
      connectWebSocket();
      setTimeout(addSimulatedPlayers, 500);
      requestAnimationFrame(animationLoop);
    });
  }

  function cacheDom() {
    DOM.chartWrapper = document.getElementById('chart-wrapper');
    DOM.price = document.getElementById('current-price');
    DOM.change = document.getElementById('price-change');
    DOM.timer = document.getElementById('round-timer');
    DOM.progress = document.getElementById('progress-fill');
    DOM.playerCount = document.getElementById('player-count');
    
    DOM.inputMode = document.getElementById('input-mode');
    DOM.lockedMode = document.getElementById('locked-mode');
    DOM.priceInput = document.getElementById('price-input');
    DOM.btnSubmit = document.getElementById('btn-submit');
    DOM.lockedValue = document.getElementById('locked-value');
    
    DOM.standingsList = document.getElementById('standings-list');
    
    DOM.resultsSection = document.getElementById('results-section');
    DOM.winnerName = document.getElementById('winner-name');
    DOM.winnerPrice = document.getElementById('winner-price');
    DOM.finalPrice = document.getElementById('final-price');
    DOM.winnerAccuracy = document.getElementById('winner-accuracy');
    
    DOM.confetti = document.getElementById('confetti');
  }

  // ==========================================
  // CHART - Proper sizing
  // ==========================================
  function initChart() {
    const container = DOM.chartWrapper;
    const rect = container.getBoundingClientRect();
    
    state.chart = LightweightCharts.createChart(container, {
      width: rect.width,
      height: rect.height,
      layout: {
        background: { color: '#08080a' },
        textColor: '#52525b',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(255,255,255,0.03)' },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 5,
        barSpacing: 4,
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: 'rgba(247,147,26,0.3)', style: 2, labelBackgroundColor: '#f7931a' },
        horzLine: { color: 'rgba(247,147,26,0.3)', style: 2, labelBackgroundColor: '#f7931a' },
      },
      handleScroll: false,
      handleScale: false,
    });

    state.series = state.chart.addLineSeries({
      color: '#f7931a',
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
    });

    // Resize observer for responsive sizing
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        state.chart.applyOptions({ width, height });
      }
    });
    resizeObserver.observe(container);
    
    // Click to set price
    container.style.cursor = 'crosshair';
    container.addEventListener('click', handleChartClick);
  }

  function handleChartClick(e) {
    if (state.roundStatus !== 'active' || state.myPrediction) return;
    
    const rect = DOM.chartWrapper.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const price = state.series.coordinateToPrice(y);
    
    if (price && price > 0) {
      DOM.priceInput.value = Math.round(price).toString();
    }
  }

  // ==========================================
  // DATA
  // ==========================================
  async function loadHistoricalData() {
    const response = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=60');
    if (!response.ok) throw new Error('API error: ' + response.status);
    
    const klines = await response.json();
    if (!klines || klines.length === 0) throw new Error('No data received');
    
    const data = [];
    const now = Math.floor(Date.now() / 1000);
    
    for (const k of klines) {
      const open = parseFloat(k[1]);
      const high = parseFloat(k[2]);
      const low = parseFloat(k[3]);
      const close = parseFloat(k[4]);
      const baseTime = Math.floor(k[0] / 1000);
      
      // Interpolate for smoother chart (6 points per minute)
      for (let j = 0; j < 6; j++) {
        const t = baseTime + j * 10;
        if (t > now) break;
        
        const progress = j / 6;
        let price;
        if (progress < 0.25) {
          price = open + (high - open) * (progress / 0.25);
        } else if (progress < 0.6) {
          price = high - (high - low) * ((progress - 0.25) / 0.35);
        } else {
          price = low + (close - low) * ((progress - 0.6) / 0.4);
        }
        
        data.push({ time: t, value: price });
      }
    }
    
    // Dedupe and sort
    const seen = new Set();
    const uniqueData = data.filter(d => {
      if (seen.has(d.time)) return false;
      seen.add(d.time);
      return true;
    }).sort((a, b) => a.time - b.time);
    
    state.priceHistory = uniqueData;
    state.series.setData(uniqueData);
    
    if (uniqueData.length > 0) {
      const lastPrice = uniqueData[uniqueData.length - 1].value;
      state.currentPrice = lastPrice;
      state.displayPrice = lastPrice;
      state.targetPrice = lastPrice;
    } else {
      throw new Error('No valid data points');
    }
  }

  function connectWebSocket() {
    state.ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');
    
    state.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const price = parseFloat(data.p);
        
        state.priceBuffer.push(price);
        if (state.priceBuffer.length > 8) state.priceBuffer.shift();
        
        state.targetPrice = state.priceBuffer.reduce((a, b) => a + b, 0) / state.priceBuffer.length;
      } catch (err) {}
    };
    
    state.ws.onclose = () => setTimeout(connectWebSocket, 2000);
  }

  // ==========================================
  // ANIMATION LOOP
  // ==========================================
  function animationLoop(ts) {
    // Smooth price lerp (only if we have valid prices)
    if (state.targetPrice > 0) {
      state.displayPrice += (state.targetPrice - state.displayPrice) * 0.1;
      state.currentPrice = state.displayPrice;
    }
    
    updatePriceDisplay();
    updateChart(ts);
    updateTimer();
    updateStandings();
    
    requestAnimationFrame(animationLoop);
  }

  function updateChart(ts) {
    // Skip if no valid price yet
    if (!state.displayPrice || state.displayPrice <= 0) return;
    // Throttle updates to 200ms
    if (ts - state.lastChartUpdate < 200) return;
    state.lastChartUpdate = ts;
    
    const now = Math.floor(Date.now() / 1000);
    const last = state.priceHistory[state.priceHistory.length - 1];
    
    if (!last || now > last.time) {
      state.priceHistory.push({ time: now, value: state.displayPrice });
      state.series.update({ time: now, value: state.displayPrice });
      if (state.priceHistory.length > 500) state.priceHistory.shift();
    } else {
      state.series.update({ time: last.time, value: state.displayPrice });
    }
  }

  function updatePriceDisplay() {
    if (!DOM.price) return;
    DOM.price.textContent = formatPrice(state.displayPrice);
    
    if (state.roundStartPrice > 0) {
      const change = ((state.displayPrice - state.roundStartPrice) / state.roundStartPrice) * 100;
      DOM.change.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
      DOM.change.className = 'price-change ' + (change >= 0 ? 'up' : 'down');
    }
  }

  // ==========================================
  // PREDICTIONS - Minimal Y-axis labels
  // ==========================================
  function addPrediction(pred) {
    // Remove if exists
    removePrediction(pred.id);
    
    // Ghost line - NO axis label (axisLabelVisible: false)
    const isMe = pred.id === 'me';
    pred.line = state.series.createPriceLine({
      price: pred.price,
      color: hexToRgba(pred.color, isMe ? 0.6 : 0.15),
      lineWidth: isMe ? 2 : 1,
      lineStyle: isMe ? 0 : 2, // Solid for me, dashed for others
      axisLabelVisible: false, // KEY: No label clutter!
      title: '',
    });
    
    state.predictions.push(pred);
    
    // If it's my prediction, add special labeled line
    if (isMe) {
      updateMyPriceLine(pred.price);
    }
    
    DOM.playerCount.textContent = state.predictions.length;
  }

  function removePrediction(id) {
    const idx = state.predictions.findIndex(p => p.id === id);
    if (idx !== -1) {
      const pred = state.predictions[idx];
      if (pred.line) state.series.removePriceLine(pred.line);
      state.predictions.splice(idx, 1);
    }
  }

  function clearAllPredictions() {
    for (const pred of state.predictions) {
      if (pred.line) state.series.removePriceLine(pred.line);
    }
    state.predictions = [];
    state.myPrediction = null;
    
    if (state.myPriceLine) {
      state.series.removePriceLine(state.myPriceLine);
      state.myPriceLine = null;
    }
    if (state.leaderPriceLine) {
      state.series.removePriceLine(state.leaderPriceLine);
      state.leaderPriceLine = null;
    }
    state.currentLeaderId = null;
  }

  // Only YOUR prediction gets an axis label
  function updateMyPriceLine(price) {
    if (state.myPriceLine) {
      state.series.removePriceLine(state.myPriceLine);
    }
    state.myPriceLine = state.series.createPriceLine({
      price: price,
      color: '#22c55e',
      lineWidth: 2,
      lineStyle: 0,
      axisLabelVisible: true,
      title: '→ YOU',
    });
  }

  // Only LEADER gets an axis label
  function updateLeaderPriceLine(pred) {
    if (state.leaderPriceLine) {
      state.series.removePriceLine(state.leaderPriceLine);
    }
    state.leaderPriceLine = state.series.createPriceLine({
      price: pred.price,
      color: pred.id === 'me' ? '#22c55e' : pred.color,
      lineWidth: 3,
      lineStyle: 0,
      axisLabelVisible: true,
      title: '👑 ' + (pred.id === 'me' ? 'YOU' : pred.nickname),
    });
    state.currentLeaderId = pred.id;
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ==========================================
  // STANDINGS - Sidebar list instead of Y-axis
  // ==========================================
  function updateStandings() {
    if (state.predictions.length === 0 || state.currentPrice <= 0) return;
    
    // Sort by distance to current price
    const sorted = [...state.predictions].map(p => ({
      ...p,
      diff: Math.abs(p.price - state.currentPrice)
    })).sort((a, b) => a.diff - b.diff);
    
    // Update leader line if changed
    const leader = sorted[0];
    if (leader && leader.id !== state.currentLeaderId) {
      updateLeaderPriceLine(leader);
    }
    
    // Render standings list
    DOM.standingsList.innerHTML = sorted.slice(0, 10).map((p, i) => {
      const isLeader = i === 0;
      const isYou = p.id === 'me';
      const classes = ['standing-item'];
      if (isLeader) classes.push('is-leader');
      if (isYou) classes.push('is-you');
      
      return `
        <div class="${classes.join(' ')}">
          <span class="standing-rank">${isLeader ? '👑' : (i + 1)}</span>
          <span class="standing-color" style="background:${p.color}"></span>
          <span class="standing-name">${isYou ? 'You' : p.nickname}</span>
          <span class="standing-diff">$${p.diff.toFixed(0)}</span>
        </div>
      `;
    }).join('');
  }

  // ==========================================
  // ROUND
  // ==========================================
  function startRound() {
    state.roundStartTime = Date.now();
    state.roundEndTime = state.roundStartTime + (ROUND_DURATION * 1000);
    state.roundStatus = 'active';
    state.roundStartPrice = state.currentPrice || state.displayPrice;
    state.myPrediction = null;
    
    // Reset UI
    DOM.inputMode?.classList.remove('hidden');
    DOM.lockedMode?.classList.add('hidden');
    DOM.resultsSection?.classList.add('hidden');
    
    if (DOM.priceInput) {
      DOM.priceInput.value = '';
      DOM.priceInput.placeholder = state.currentPrice > 0 ? Math.round(state.currentPrice).toString() : '89650';
    }
    if (DOM.btnSubmit) {
      DOM.btnSubmit.textContent = 'Lock In';
      DOM.btnSubmit.disabled = false;
    }
    
    setTimeout(endRound, ROUND_DURATION * 1000);
  }

  function endRound() {
    state.roundStatus = 'ended';
    
    const finalPrice = state.currentPrice;
    let winner = null;
    let minDiff = Infinity;
    
    for (const p of state.predictions) {
      const diff = Math.abs(p.price - finalPrice);
      if (diff < minDiff) {
        minDiff = diff;
        winner = p;
      }
    }
    
    if (winner) {
      const accuracy = Math.max(0, 100 - (minDiff / finalPrice * 100)).toFixed(2);
      
      DOM.winnerName.textContent = winner.id === 'me' ? 'You!' : winner.nickname;
      DOM.winnerName.style.color = winner.color;
      DOM.winnerPrice.textContent = formatPrice(winner.price);
      DOM.finalPrice.textContent = formatPrice(finalPrice);
      DOM.winnerAccuracy.textContent = accuracy + '%';
      
      DOM.inputMode?.classList.add('hidden');
      DOM.lockedMode?.classList.add('hidden');
      DOM.resultsSection?.classList.remove('hidden');
      
      if (winner.id === 'me') {
        triggerConfetti();
      }
    }
    
    setTimeout(() => {
      clearAllPredictions();
      startRound();
      setTimeout(addSimulatedPlayers, 300);
    }, 5000);
  }

  function updateTimer() {
    const remaining = Math.max(0, Math.ceil((state.roundEndTime - Date.now()) / 1000));
    const elapsed = Date.now() - state.roundStartTime;
    const progress = Math.min(100, (elapsed / (ROUND_DURATION * 1000)) * 100);
    
    if (DOM.timer) {
      DOM.timer.textContent = remaining;
      DOM.timer.classList.toggle('urgent', remaining <= 15 && remaining > 5);
      DOM.timer.classList.toggle('critical', remaining <= 5);
    }
    
    if (DOM.progress) {
      DOM.progress.style.width = progress + '%';
      DOM.progress.classList.toggle('urgent', remaining <= 15 && remaining > 5);
      DOM.progress.classList.toggle('critical', remaining <= 5);
    }
  }

  // ==========================================
  // SIMULATED PLAYERS
  // ==========================================
  function addSimulatedPlayers() {
    const price = state.currentPrice || 89000;
    
    const players = [
      { name: 'CryptoKing', color: '#ef4444' },
      { name: 'SatoshiV', color: '#8b5cf6' },
      { name: 'MoonLambo', color: '#06b6d4' },
      { name: 'WAGMI', color: '#f59e0b' },
      { name: 'Diamond', color: '#ec4899' },
      { name: 'BTCMaxi', color: '#10b981' },
      { name: 'Degen420', color: '#6366f1' },
      { name: 'Whale', color: '#14b8a6' },
      { name: 'ChartWiz', color: '#f97316' },
      { name: 'PumpIt', color: '#a855f7' },
      { name: 'HodlGang', color: '#22c55e' },
      { name: 'BearHunter', color: '#e11d48' },
      { name: 'Saylor', color: '#0ea5e9' },
      { name: 'SilkRoad', color: '#84cc16' },
      { name: 'FOMO', color: '#d946ef' },
      { name: 'RektCap', color: '#fb923c' },
      { name: 'CZ_Fan', color: '#fbbf24' },
      { name: 'VitalikJr', color: '#38bdf8' },
      { name: 'GigaChad', color: '#c084fc' },
      { name: 'NFA_Andy', color: '#4ade80' },
    ];
    
    players.forEach((p, i) => {
      setTimeout(() => {
        if (state.roundStatus !== 'active') return;
        
        const variance = price * 0.001;
        const offset = (Math.random() - 0.5) * 2 * variance;
        
        addPrediction({
          id: 'bot_' + i,
          nickname: p.name,
          price: Math.round(price + offset),
          color: p.color,
        });
      }, i * 100);
    });
  }

  // ==========================================
  // USER INPUT
  // ==========================================
  function setupEventListeners() {
    DOM.btnSubmit?.addEventListener('click', submitPrediction);
    DOM.priceInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') submitPrediction();
    });
    DOM.priceInput?.addEventListener('input', e => {
      e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });
    DOM.priceInput?.addEventListener('focus', () => {
      if (!DOM.priceInput.value && state.currentPrice > 0) {
        DOM.priceInput.value = Math.round(state.currentPrice).toString();
        DOM.priceInput.select();
      }
    });
  }

  function submitPrediction() {
    if (state.roundStatus !== 'active') return;
    
    const price = parseFloat(DOM.priceInput?.value);
    if (isNaN(price) || price <= 0) return;
    
    if (state.myPrediction) {
      removePrediction('me');
    }
    
    state.myPrediction = {
      id: 'me',
      nickname: 'You',
      price: price,
      color: '#22c55e',
    };
    
    addPrediction(state.myPrediction);
    
    // Switch to locked mode
    DOM.inputMode?.classList.add('hidden');
    DOM.lockedMode?.classList.remove('hidden');
    DOM.lockedValue.textContent = formatPrice(price);
  }

  // ==========================================
  // CONFETTI
  // ==========================================
  function triggerConfetti() {
    if (!DOM.confetti) return;
    DOM.confetti.innerHTML = '';
    DOM.confetti.classList.add('active');
    
    const colors = ['#f7931a', '#22c55e', '#ef4444', '#8b5cf6', '#f59e0b'];
    for (let i = 0; i < 100; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = Math.random() * 0.5 + 's';
      DOM.confetti.appendChild(piece);
    }
    
    setTimeout(() => DOM.confetti.classList.remove('active'), 3000);
  }

  // ==========================================
  // UTILS
  // ==========================================
  function formatPrice(p) {
    if (!p || isNaN(p)) return '$--,---';
    return '$' + Math.round(p).toLocaleString();
  }

  // ==========================================
  // START
  // ==========================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
