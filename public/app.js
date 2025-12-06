// Predictoor - Improved UX with clear labels and auto-scaling
(function() {
  'use strict';

  const ROUND_DURATION = 60;
  const PREDICTION_CUTOFF = 5;

  const state = {
    chart: null,
    series: null,
    ws: null,
    
    // Prices
    currentPrice: 0,
    displayPrice: 0,
    targetPrice: 0,
    priceHistory: [],
    
    // Round
    roundStartTime: 0,
    roundEndTime: 0,
    roundStartPrice: 0,
    roundStatus: 'active',
    roundNumber: 0,
    
    // Predictions
    myPrediction: null,
    predictions: [],
    
    // Live rank tracking
    myRank: null,
    lastRank: null,
    myDistance: null,
    
    // Price lines
    myPriceLine: null,
    leaderPriceLine: null,
    currentLeaderId: null,
    
    // Stats
    streak: 0,
    totalWins: 0,
    totalPlayed: 0,
    
    // Timing
    lastChartUpdate: 0,
    userHasInteracted: false,
  };

  const DOM = {};

  // ==========================================
  // INIT
  // ==========================================
  function init() {
    loadStats();
    cacheDom();
    initChart();
    setupEventListeners();
    
    loadHistoricalData().then(() => {
      console.log('Data loaded, price:', state.currentPrice);
      startRound();
      connectWebSocket();
      setTimeout(addSimulatedPlayers, 500);
      requestAnimationFrame(animationLoop);
    }).catch(err => {
      console.error('Failed to load data:', err);
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
    DOM.timerTarget = document.getElementById('round-target');
    DOM.progress = document.getElementById('progress-fill');
    DOM.playerCount = document.getElementById('player-count');
    
    DOM.inputMode = document.getElementById('input-mode');
    DOM.lockedMode = document.getElementById('locked-mode');
    DOM.priceInput = document.getElementById('price-input');
    DOM.btnSubmit = document.getElementById('btn-submit');
    DOM.lockedValue = document.getElementById('locked-value');
    DOM.promptTime = document.getElementById('prompt-time');
    
    DOM.standingsList = document.getElementById('standings-list');
    
    DOM.resultsSection = document.getElementById('results-section');
    DOM.winnerName = document.getElementById('winner-name');
    DOM.winnerPrice = document.getElementById('winner-price');
    DOM.finalPrice = document.getElementById('final-price');
    DOM.winnerAccuracy = document.getElementById('winner-accuracy');
    DOM.yourResult = document.getElementById('your-result');
    
    DOM.confetti = document.getElementById('confetti');
    DOM.streak = document.getElementById('streak-count');
    DOM.legend = document.getElementById('chart-legend');
  }

  // ==========================================
  // STATS (localStorage)
  // ==========================================
  function loadStats() {
    try {
      const saved = localStorage.getItem('predictoor_stats');
      if (saved) {
        const data = JSON.parse(saved);
        state.streak = data.streak || 0;
        state.totalWins = data.totalWins || 0;
        state.totalPlayed = data.totalPlayed || 0;
      }
    } catch (e) {}
  }
  
  function saveStats() {
    try {
      localStorage.setItem('predictoor_stats', JSON.stringify({
        streak: state.streak,
        totalWins: state.totalWins,
        totalPlayed: state.totalPlayed,
      }));
    } catch (e) {}
  }

  // ==========================================
  // CHART
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
        barSpacing: 6,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.15, bottom: 0.15 },
        autoScale: true,
        alignLabels: true,
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: 'rgba(247,147,26,0.3)', style: 2, labelBackgroundColor: '#f7931a' },
        horzLine: { color: 'rgba(247,147,26,0.3)', style: 2, labelBackgroundColor: '#f7931a' },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        mouseWheel: true,
        pinch: true,
      },
    });

    state.series = state.chart.addLineSeries({
      color: '#f7931a',
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        state.chart.applyOptions({ width, height });
      }
    });
    resizeObserver.observe(container);
    
    // Track user interaction (for auto-scroll behavior)
    container.addEventListener('mousedown', () => { state.userHasInteracted = true; });
    container.addEventListener('touchstart', () => { state.userHasInteracted = true; });
    
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
  
  // Fit chart to show recent data nicely
  function fitChartToData() {
    if (!state.chart || state.priceHistory.length < 2) return;
    
    // Show last 3 minutes of data + some future space
    const now = Math.floor(Date.now() / 1000);
    const from = now - 180; // 3 minutes ago
    const to = now + 30; // 30 seconds into future
    
    state.chart.timeScale().setVisibleRange({ from, to });
  }

  // ==========================================
  // DATA
  // ==========================================
  async function loadHistoricalData() {
    const response = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=30');
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
    
    // Initial fit
    setTimeout(fitChartToData, 100);
  }

  function connectWebSocket() {
    state.ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@aggTrade');
    
    state.ws.onopen = () => console.log('WebSocket connected');
    
    state.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        state.targetPrice = parseFloat(data.p);
      } catch (err) {}
    };
    
    state.ws.onerror = (err) => console.error('WS error:', err);
    state.ws.onclose = () => setTimeout(connectWebSocket, 1000);
  }

  // ==========================================
  // ANIMATION LOOP
  // ==========================================
  function animationLoop(ts) {
    if (state.targetPrice > 0) {
      state.displayPrice += (state.targetPrice - state.displayPrice) * 0.8;
      state.currentPrice = state.displayPrice;
    }
    
    updatePriceDisplay();
    updateChart(ts);
    updateTimer();
    updateStandings();
    updateLegend();
    
    requestAnimationFrame(animationLoop);
  }

  function updateChart(ts) {
    if (!state.displayPrice || state.displayPrice <= 0) return;
    if (ts - state.lastChartUpdate < 50) return;
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
  // LEGEND (Clear labels for chart lines)
  // ==========================================
  function updateLegend() {
    if (!DOM.legend) return;
    
    const items = [];
    
    // Current price
    items.push(`<span class="legend-item"><span class="legend-dot" style="background:#f7931a"></span>BTC Price</span>`);
    
    // Leader
    if (state.currentLeaderId && state.predictions.length > 0) {
      const leader = state.predictions.find(p => p.id === state.currentLeaderId);
      if (leader) {
        const label = leader.id === 'me' ? 'You (Leading!)' : `👑 ${leader.nickname}`;
        items.push(`<span class="legend-item"><span class="legend-dot" style="background:${leader.color}"></span>${label}</span>`);
      }
    }
    
    // Your prediction (if not leader)
    if (state.myPrediction && state.currentLeaderId !== 'me') {
      items.push(`<span class="legend-item"><span class="legend-dot" style="background:#22c55e"></span>Your Prediction</span>`);
    }
    
    DOM.legend.innerHTML = items.join('');
  }

  // ==========================================
  // PREDICTIONS
  // ==========================================
  function addPrediction(pred) {
    removePrediction(pred.id);
    
    const isMe = pred.id === 'me';
    pred.line = state.series.createPriceLine({
      price: pred.price,
      color: hexToRgba(pred.color, isMe ? 0.7 : 0.12),
      lineWidth: isMe ? 2 : 1,
      lineStyle: isMe ? 0 : 2,
      axisLabelVisible: false,
      title: '',
    });
    
    state.predictions.push(pred);
    
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
      title: 'YOU',
    });
  }

  function updateLeaderPriceLine(pred) {
    if (state.leaderPriceLine) {
      state.series.removePriceLine(state.leaderPriceLine);
    }
    
    // Don't duplicate if leader is me
    if (pred.id === 'me') {
      state.currentLeaderId = 'me';
      return;
    }
    
    state.leaderPriceLine = state.series.createPriceLine({
      price: pred.price,
      color: pred.color,
      lineWidth: 3,
      lineStyle: 0,
      axisLabelVisible: true,
      title: '👑 ' + pred.nickname,
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
  // STANDINGS
  // ==========================================
  function updateStandings() {
    if (state.predictions.length === 0 || state.currentPrice <= 0) return;
    
    const sorted = [...state.predictions].map(p => ({
      ...p,
      diff: Math.abs(p.price - state.currentPrice)
    })).sort((a, b) => a.diff - b.diff);
    
    // Track my rank
    const myIndex = sorted.findIndex(p => p.id === 'me');
    if (myIndex !== -1) {
      const newRank = myIndex + 1;
      state.lastRank = state.myRank;
      state.myRank = newRank;
      state.myDistance = sorted[myIndex].diff;
      updateMyRankDisplay();
    }
    
    // Update leader
    const leader = sorted[0];
    if (leader && leader.id !== state.currentLeaderId) {
      updateLeaderPriceLine(leader);
    }
    
    // Render standings
    DOM.standingsList.innerHTML = sorted.slice(0, 10).map((p, i) => {
      const isLeader = i === 0;
      const isYou = p.id === 'me';
      const classes = ['standing-item'];
      if (isLeader) classes.push('is-leader');
      if (isYou) classes.push('is-you');
      
      // Rank change indicator
      let rankIndicator = '';
      if (isYou && state.lastRank !== null && state.lastRank !== state.myRank) {
        rankIndicator = state.myRank < state.lastRank 
          ? '<span class="rank-up">▲</span>' 
          : '<span class="rank-down">▼</span>';
      }
      
      // Show predicted price AND distance
      const direction = p.price > state.currentPrice ? '↑' : '↓';
      
      return `
        <div class="${classes.join(' ')}">
          <span class="standing-rank">${isLeader ? '👑' : (i + 1)}</span>
          <span class="standing-color" style="background:${p.color}"></span>
          <span class="standing-name">${isYou ? 'YOU' : p.nickname}${rankIndicator}</span>
          <span class="standing-price">$${p.price.toLocaleString()}</span>
          <span class="standing-diff ${p.diff < 10 ? 'close' : ''}">${direction} $${p.diff.toFixed(0)}</span>
        </div>
      `;
    }).join('');
  }
  
  function updateMyRankDisplay() {
    if (!state.myPrediction || !DOM.lockedMode) return;
    
    const rankText = state.myRank === 1 ? '🏆 1st' : 
                     state.myRank === 2 ? '🥈 2nd' : 
                     state.myRank === 3 ? '🥉 3rd' : 
                     `#${state.myRank}`;
    
    const distText = `$${state.myDistance?.toFixed(0) || '0'} away from current`;
    
    if (DOM.lockedValue) {
      DOM.lockedValue.innerHTML = `
        <div class="your-rank">${rankText}</div>
        <div class="your-distance">${distText}</div>
      `;
    }
  }

  // ==========================================
  // ROUND
  // ==========================================
  function startRound() {
    const now = Date.now();
    const msUntilNextMinute = 60000 - (now % 60000);
    
    state.roundStartTime = now;
    state.roundEndTime = now + msUntilNextMinute;
    state.roundStatus = 'active';
    state.roundStartPrice = state.currentPrice || state.displayPrice;
    state.myPrediction = null;
    state.myRank = null;
    state.lastRank = null;
    state.roundNumber++;
    
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
    
    // Update streak display
    if (DOM.streak) {
      DOM.streak.textContent = state.streak;
      DOM.streak.parentElement.classList.toggle('has-streak', state.streak > 0);
    }
    
    setTimeout(endRound, msUntilNextMinute);
    
    const targetDate = new Date(state.roundEndTime);
    const targetTimeStr = targetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (DOM.timerTarget) DOM.timerTarget.textContent = targetTimeStr;
    
    // Reset user interaction flag and fit chart
    state.userHasInteracted = false;
    setTimeout(fitChartToData, 100);
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
    
    // Update stats
    if (state.myPrediction) {
      state.totalPlayed++;
      
      if (winner && winner.id === 'me') {
        state.totalWins++;
        state.streak++;
      } else {
        state.streak = 0;
      }
      saveStats();
    }
    
    if (winner) {
      const accuracy = Math.max(0, 100 - (minDiff / finalPrice * 100)).toFixed(2);
      const isMe = winner.id === 'me';
      
      DOM.winnerName.textContent = isMe ? 'You won! 🎉' : winner.nickname;
      DOM.winnerName.style.color = winner.color;
      DOM.winnerPrice.textContent = formatPrice(winner.price);
      DOM.finalPrice.textContent = formatPrice(finalPrice);
      DOM.winnerAccuracy.textContent = accuracy + '% accuracy';
      
      // Show your result if you played
      if (DOM.yourResult && state.myPrediction) {
        if (isMe) {
          DOM.yourResult.innerHTML = `<span class="win-message">🏆 You won! Streak: ${state.streak}</span>`;
        } else {
          const myDiff = Math.abs(state.myPrediction.price - finalPrice);
          const myRank = state.predictions
            .map(p => Math.abs(p.price - finalPrice))
            .sort((a, b) => a - b)
            .indexOf(myDiff) + 1;
          DOM.yourResult.innerHTML = `You placed #${myRank} ($${myDiff.toFixed(0)} off)`;
        }
        DOM.yourResult.classList.remove('hidden');
      }
      
      DOM.inputMode?.classList.add('hidden');
      DOM.lockedMode?.classList.add('hidden');
      DOM.resultsSection?.classList.remove('hidden');
      
      if (isMe) triggerConfetti();
    }
    
    setTimeout(() => {
      clearAllPredictions();
      startRound();
      setTimeout(addSimulatedPlayers, 300);
    }, 5000);
  }

  function updateTimer() {
    const now = Date.now();
    const remaining = Math.max(0, Math.ceil((state.roundEndTime - now) / 1000));
    const totalDuration = state.roundEndTime - state.roundStartTime;
    const elapsed = now - state.roundStartTime;
    const progress = Math.min(100, (elapsed / totalDuration) * 100);
    const isLocked = remaining <= PREDICTION_CUTOFF;
    
    if (DOM.timer) {
      DOM.timer.textContent = remaining;
      DOM.timer.classList.toggle('urgent', remaining <= 15 && remaining > 5);
      DOM.timer.classList.toggle('critical', remaining <= 5);
    }
    
    if (DOM.promptTime) {
      DOM.promptTime.textContent = remaining;
    }
    
    if (DOM.progress) {
      DOM.progress.style.width = progress + '%';
      DOM.progress.classList.toggle('urgent', remaining <= 15 && remaining > 5);
      DOM.progress.classList.toggle('critical', remaining <= 5);
    }
    
    if (DOM.btnSubmit && !state.myPrediction) {
      if (isLocked) {
        DOM.btnSubmit.disabled = true;
        DOM.btnSubmit.textContent = 'Too Late!';
      } else {
        DOM.btnSubmit.disabled = false;
        DOM.btnSubmit.textContent = 'Lock In';
      }
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
    ];
    
    players.forEach((p, i) => {
      setTimeout(() => {
        if (state.roundStatus !== 'active') return;
        
        const variance = price * 0.0008;
        const offset = (Math.random() - 0.5) * 2 * variance;
        
        addPrediction({
          id: 'bot_' + i,
          nickname: p.name,
          price: Math.round(price + offset),
          color: p.color,
        });
      }, i * 80);
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
    
    const remaining = (state.roundEndTime - Date.now()) / 1000;
    if (remaining < PREDICTION_CUTOFF) return;
    
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
    
    DOM.inputMode?.classList.add('hidden');
    DOM.lockedMode?.classList.remove('hidden');
    
    const lockedPriceEl = document.getElementById('locked-price-value');
    if (lockedPriceEl) lockedPriceEl.textContent = formatPrice(price);
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
