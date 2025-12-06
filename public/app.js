// Chart Predictoor - Production Multiplayer Version
// With Supabase real-time sync, ghost lines, and synchronized rounds

(function() {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================
  const CONFIG = {
    // Supabase - Replace with your project details
    SUPABASE_URL: 'YOUR_SUPABASE_URL',
    SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
    
    // Feature flags
    MULTIPLAYER_ENABLED: false, // Set to true when Supabase is configured
    
    // Timing
    ROUND_DURATION: 60, // seconds
    LOCK_BEFORE_END: 5, // seconds before end when submissions lock
  };

  // Check if Supabase is configured
  const isMultiplayer = CONFIG.MULTIPLAYER_ENABLED && 
    CONFIG.SUPABASE_URL !== 'YOUR_SUPABASE_URL';

  // ============================================
  // STATE
  // ============================================
  const state = {
    // Supabase
    supabase: null,
    userId: null,
    sessionToken: null,
    
    // Chart
    chart: null,
    series: null,
    ws: null,
    
    // Price
    currentPrice: 0,
    displayPrice: 0,
    previousPrice: 0,
    startPrice: 0,
    lastTime: 0,
    
    // Round (synchronized)
    currentRound: null,
    roundEndTime: null,
    roundStatus: 'waiting', // waiting, active, locked, results
    
    // Prediction
    mode: 'idle', // idle, drawing, submitted, results
    targetPrice: null,
    myPrediction: null,
    
    // Ghost lines (other players)
    ghostPredictions: [],
    
    // Drawing
    isDrawing: false,
    drawPath: [],
    
    // Leaderboard
    leaderboard: [],
    roundResults: [],
    
    // UI
    playerCount: 0,
  };

  const DOM = {};

  // ============================================
  // INITIALIZATION
  // ============================================
  async function init() {
    cacheDom();
    initChart();
    initCanvas();
    setupEventListeners();
    
    // Load historical data and start price feed
    await loadHistoricalData();
    connectPriceFeed();
    
    if (isMultiplayer) {
      await initSupabase();
      await joinGame();
      startRoundSync();
    } else {
      // Single player mode - use mock data
      initMockLeaderboard();
      startLocalRound();
    }
    
    startAnimationLoop();
  }

  function cacheDom() {
    DOM.tickerPrice = document.getElementById('ticker-price');
    DOM.tickerChange = document.getElementById('ticker-change');
    DOM.tickerArrow = document.getElementById('ticker-arrow');
    DOM.lastUpdate = document.getElementById('last-update');
    DOM.chartContainer = document.getElementById('chart-container');
    DOM.canvas = document.getElementById('drawing-canvas');
    
    // Round info
    DOM.roundInfo = document.getElementById('round-info');
    DOM.roundNumber = document.getElementById('round-number');
    DOM.roundTimer = document.getElementById('round-timer');
    DOM.playerCount = document.getElementById('player-count');
    
    // Panels
    DOM.waitingMode = document.getElementById('waiting-mode');
    DOM.drawingMode = document.getElementById('drawing-mode');
    DOM.submittedMode = document.getElementById('submitted-mode');
    DOM.resultsMode = document.getElementById('results-mode');
    
    // Drawing
    DOM.targetPrice = document.getElementById('target-price');
    DOM.targetDiff = document.getElementById('target-diff');
    DOM.btnDraw = document.getElementById('btn-draw');
    DOM.btnCancel = document.getElementById('btn-cancel');
    DOM.btnSubmit = document.getElementById('btn-submit');
    
    // Results
    DOM.resultsList = document.getElementById('results-list');
    DOM.myResult = document.getElementById('my-result');
    
    // Leaderboard
    DOM.leaderboard = document.getElementById('leaderboard');
  }

  // ============================================
  // SUPABASE INTEGRATION
  // ============================================
  async function initSupabase() {
    // Dynamic import for Supabase
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    state.supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    
    // Get or create session token
    state.sessionToken = localStorage.getItem('predictoor_session');
    if (!state.sessionToken) {
      state.sessionToken = crypto.randomUUID();
      localStorage.setItem('predictoor_session', state.sessionToken);
    }
  }

  async function joinGame() {
    if (!state.supabase) return;
    
    try {
      // Get or create user
      const { data, error } = await state.supabase.rpc('get_or_create_user', {
        p_session_token: state.sessionToken,
        p_nickname: localStorage.getItem('predictoor_nickname')
      });
      
      if (error) throw error;
      state.userId = data;
      
      // Subscribe to current round
      subscribeToRound();
      
      // Subscribe to predictions (ghost lines)
      subscribeToPredictions();
      
      // Load leaderboard
      await loadLeaderboard();
      
    } catch (e) {
      console.error('Failed to join game:', e);
    }
  }

  function subscribeToRound() {
    if (!state.supabase) return;
    
    state.supabase
      .channel('rounds')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'rounds'
      }, (payload) => {
        handleRoundUpdate(payload.new);
      })
      .subscribe();
  }

  function subscribeToPredictions() {
    if (!state.supabase) return;
    
    state.supabase
      .channel('predictions')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'predictions'
      }, (payload) => {
        // Add ghost line for other player's prediction
        if (payload.new.user_id !== state.userId && payload.new.draw_path) {
          addGhostPrediction(payload.new);
        }
      })
      .subscribe();
  }

  async function loadLeaderboard() {
    if (!state.supabase) return;
    
    try {
      const { data, error } = await state.supabase.rpc('get_leaderboard', { p_limit: 10 });
      if (error) throw error;
      state.leaderboard = data || [];
      renderLeaderboard();
    } catch (e) {
      console.error('Failed to load leaderboard:', e);
    }
  }

  async function submitPrediction() {
    if (!state.targetPrice) return;
    
    if (isMultiplayer && state.supabase && state.currentRound) {
      try {
        // Normalize draw path for storage
        const normalizedPath = state.drawPath.map(p => ({
          x: p.x / DOM.canvas.width,
          y: p.y / DOM.canvas.height
        }));
        
        const { data, error } = await state.supabase.rpc('submit_prediction', {
          p_session_token: state.sessionToken,
          p_round_id: state.currentRound.id,
          p_target_price: state.targetPrice,
          p_draw_path: normalizedPath
        });
        
        if (error) throw error;
        
        if (data?.[0]?.success) {
          state.myPrediction = {
            target_price: state.targetPrice,
            draw_path: state.drawPath
          };
          setMode('submitted');
        } else {
          console.error('Submission failed:', data?.[0]?.message);
        }
      } catch (e) {
        console.error('Failed to submit prediction:', e);
      }
    } else {
      // Local mode
      state.myPrediction = {
        target_price: state.targetPrice,
        draw_path: [...state.drawPath]
      };
      setMode('submitted');
    }
  }

  // ============================================
  // ROUND MANAGEMENT
  // ============================================
  function startRoundSync() {
    // Poll for round updates every second
    setInterval(async () => {
      if (!state.supabase) return;
      
      try {
        // Call edge function to manage round lifecycle
        await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/manage-round`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({ action: 'check_rounds' })
        });
        
        // Get current round
        const { data } = await state.supabase.rpc('get_current_round');
        if (data?.[0]) {
          handleRoundUpdate(data[0]);
        }
      } catch (e) {
        console.error('Round sync error:', e);
      }
    }, 1000);
  }

  function handleRoundUpdate(round) {
    if (!round) return;
    
    const prevRound = state.currentRound;
    state.currentRound = round;
    state.playerCount = round.player_count || 0;
    
    // Update UI
    if (DOM.roundNumber) DOM.roundNumber.textContent = `#${round.id}`;
    if (DOM.playerCount) DOM.playerCount.textContent = `${state.playerCount} players`;
    
    // Handle status changes
    if (round.status === 'active' && state.mode === 'idle') {
      setMode('drawing');
      state.ghostPredictions = [];
    }
    
    if (round.status === 'locked' && state.mode === 'drawing') {
      // Force submit or cancel
      if (state.targetPrice) {
        submitPrediction();
      } else {
        setMode('submitted');
      }
    }
    
    if (round.status === 'completed' && prevRound?.status !== 'completed') {
      showResults(round);
    }
    
    // Update round end time
    if (round.end_time) {
      state.roundEndTime = new Date(round.end_time).getTime();
    }
  }

  async function showResults(round) {
    setMode('results');
    
    if (isMultiplayer && state.supabase) {
      try {
        const response = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/manage-round`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({ action: 'get_results', round_id: round.id })
        });
        
        const { predictions } = await response.json();
        state.roundResults = predictions || [];
        renderResults();
        
        // Refresh leaderboard
        await loadLeaderboard();
        
      } catch (e) {
        console.error('Failed to get results:', e);
      }
    } else {
      // Local mode results
      calculateLocalResults();
    }
    
    // After 8 seconds, start new round
    setTimeout(() => {
      resetForNewRound();
    }, 8000);
  }

  function resetForNewRound() {
    state.targetPrice = null;
    state.myPrediction = null;
    state.drawPath = [];
    state.ghostPredictions = [];
    state.roundResults = [];
    
    setMode('idle');
    
    // Reset chart scroll
    state.chart.timeScale().scrollToRealTime();
    state.chart.timeScale().applyOptions({ rightOffset: 50 });
    
    // Clear canvas
    const ctx = DOM.canvas.getContext('2d');
    ctx.clearRect(0, 0, DOM.canvas.width, DOM.canvas.height);
  }

  // Local round for single player
  function startLocalRound() {
    const now = Date.now();
    const roundStart = Math.ceil(now / 60000) * 60000;
    
    state.currentRound = {
      id: Math.floor(roundStart / 60000),
      start_time: new Date(roundStart).toISOString(),
      end_time: new Date(roundStart + 60000).toISOString(),
      status: 'waiting'
    };
    
    state.roundEndTime = roundStart + 60000;
    
    // Check round status every second
    setInterval(() => {
      const now = Date.now();
      const roundStart = state.currentRound ? new Date(state.currentRound.start_time).getTime() : 0;
      const roundEnd = state.roundEndTime || 0;
      
      if (now >= roundStart && now < roundEnd - 5000 && state.currentRound.status === 'waiting') {
        state.currentRound.status = 'active';
        if (state.mode === 'idle') setMode('drawing');
      }
      
      if (now >= roundEnd - 5000 && now < roundEnd && state.currentRound.status === 'active') {
        state.currentRound.status = 'locked';
        if (state.mode === 'drawing' && state.targetPrice) {
          submitPrediction();
        }
      }
      
      if (now >= roundEnd && state.currentRound.status !== 'completed') {
        state.currentRound.status = 'completed';
        showResults(state.currentRound);
        
        // Schedule next round
        setTimeout(() => {
          const nextRoundStart = Math.ceil(Date.now() / 60000) * 60000;
          state.currentRound = {
            id: Math.floor(nextRoundStart / 60000),
            start_time: new Date(nextRoundStart).toISOString(),
            end_time: new Date(nextRoundStart + 60000).toISOString(),
            status: 'waiting'
          };
          state.roundEndTime = nextRoundStart + 60000;
        }, 8000);
      }
    }, 100);
  }

  function calculateLocalResults() {
    if (!state.myPrediction) {
      state.roundResults = [];
      return;
    }
    
    const accuracy = Math.max(0, 100 - (Math.abs(state.currentPrice - state.myPrediction.target_price) / state.currentPrice * 1000));
    
    state.roundResults = [
      { rank: 1, users: { nickname: localStorage.getItem('predictoor_nickname') || 'You' }, target_price: state.myPrediction.target_price, accuracy }
    ];
    
    renderResults();
  }

  // ============================================
  // GHOST LINES
  // ============================================
  function addGhostPrediction(prediction) {
    if (!prediction.draw_path) return;
    
    // Convert normalized path back to canvas coordinates
    const path = prediction.draw_path.map(p => ({
      x: p.x * DOM.canvas.width,
      y: p.y * DOM.canvas.height
    }));
    
    state.ghostPredictions.push({
      user_id: prediction.user_id,
      path: path,
      target_price: prediction.target_price,
      color: `hsl(${Math.random() * 360}, 50%, 50%)`,
      opacity: 0.3
    });
    
    // Update player count
    state.playerCount = state.ghostPredictions.length + 1;
    if (DOM.playerCount) DOM.playerCount.textContent = `${state.playerCount} players`;
  }

  // ============================================
  // MODE MANAGEMENT
  // ============================================
  function setMode(mode) {
    state.mode = mode;
    
    // Hide all panels
    DOM.waitingMode?.classList.add('hidden');
    DOM.drawingMode?.classList.add('hidden');
    DOM.submittedMode?.classList.add('hidden');
    DOM.resultsMode?.classList.add('hidden');
    
    // Show appropriate panel
    switch (mode) {
      case 'idle':
        DOM.waitingMode?.classList.remove('hidden');
        DOM.canvas.classList.remove('active');
        break;
      case 'drawing':
        DOM.drawingMode?.classList.remove('hidden');
        DOM.canvas.classList.add('active');
        DOM.targetPrice.textContent = 'Draw on chart';
        DOM.targetPrice.classList.add('empty');
        DOM.targetDiff.textContent = '';
        break;
      case 'submitted':
        DOM.submittedMode?.classList.remove('hidden');
        DOM.canvas.classList.remove('active');
        break;
      case 'results':
        DOM.resultsMode?.classList.remove('hidden');
        DOM.canvas.classList.remove('active');
        break;
    }
  }

  // ============================================
  // CHART
  // ============================================
  function initChart() {
    state.chart = LightweightCharts.createChart(DOM.chartContainer, {
      width: DOM.chartContainer.clientWidth,
      height: DOM.chartContainer.clientHeight,
      layout: {
        background: { color: '#111114' },
        textColor: '#606068',
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 50,
        barSpacing: 8,
        shiftVisibleRangeOnNewBar: true,
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.15, bottom: 0.15 },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: 'rgba(247, 147, 26, 0.3)', labelBackgroundColor: '#f7931a' },
        horzLine: { color: 'rgba(247, 147, 26, 0.3)', labelBackgroundColor: '#f7931a' },
      },
    });

    state.series = state.chart.addLineSeries({
      color: '#f7931a',
      lineWidth: 2,
      priceLineVisible: true,
      priceLineColor: 'rgba(247, 147, 26, 0.5)',
      lastValueVisible: true,
    });

    new ResizeObserver(() => {
      state.chart.applyOptions({
        width: DOM.chartContainer.clientWidth,
        height: DOM.chartContainer.clientHeight,
      });
      resizeCanvas();
    }).observe(DOM.chartContainer);
  }

  async function loadHistoricalData() {
    try {
      const response = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=60');
      const klines = await response.json();
      
      const data = [];
      for (const k of klines) {
        data.push({ time: Math.floor(k[0] / 1000), value: parseFloat(k[4]) });
      }
      
      state.series.setData(data);
      state.currentPrice = data[data.length - 1].value;
      state.displayPrice = state.currentPrice;
      state.startPrice = data[0].value;
      state.lastTime = data[data.length - 1].time;
      
      updateTicker();
      state.chart.timeScale().scrollToRealTime();
    } catch (e) {
      console.error('Failed to load data:', e);
    }
  }

  function connectPriceFeed() {
    state.ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@aggTrade');
    
    let lastUpdate = 0;
    state.ws.onmessage = (event) => {
      const now = Date.now();
      if (now - lastUpdate < 100) return;
      lastUpdate = now;
      
      const data = JSON.parse(event.data);
      state.previousPrice = state.currentPrice;
      state.currentPrice = parseFloat(data.p);
      
      if (state.startPrice === 0) {
        state.startPrice = state.currentPrice;
        state.displayPrice = state.currentPrice;
      }
      
      animatePriceChange();
    };
    
    state.ws.onclose = () => setTimeout(connectPriceFeed, 2000);
  }

  function animatePriceChange() {
    if (!DOM.tickerPrice) return;
    
    const dir = state.currentPrice > state.previousPrice ? 'up' : 
                state.currentPrice < state.previousPrice ? 'down' : 'neutral';
    
    DOM.tickerPrice.classList.remove('pulse-up', 'pulse-down');
    void DOM.tickerPrice.offsetWidth;
    DOM.tickerPrice.classList.add(`pulse-${dir}`);
    
    if (DOM.tickerArrow) {
      DOM.tickerArrow.textContent = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '';
      DOM.tickerArrow.className = `ticker-arrow ${dir}`;
    }
  }

  // ============================================
  // ANIMATION LOOP
  // ============================================
  function startAnimationLoop() {
    let lastChartUpdate = 0;
    
    function animate(timestamp) {
      // Lerp price
      state.displayPrice += (state.currentPrice - state.displayPrice) * 0.12;
      updateTicker();
      
      // Update chart
      if (timestamp - lastChartUpdate >= 500 && state.currentPrice > 0) {
        lastChartUpdate = timestamp;
        const now = Math.floor(Date.now() / 1000);
        if (now > state.lastTime) {
          state.series.update({ time: now, value: state.displayPrice });
          state.lastTime = now;
        } else {
          state.series.update({ time: state.lastTime, value: state.displayPrice });
        }
      }
      
      // Update round timer
      updateRoundTimer();
      
      // Redraw canvas
      if (state.mode === 'drawing' || state.mode === 'submitted') {
        redrawCanvas();
      }
      
      requestAnimationFrame(animate);
    }
    
    requestAnimationFrame(animate);
  }

  function updateTicker() {
    if (!DOM.tickerPrice) return;
    DOM.tickerPrice.textContent = formatPrice(state.displayPrice);
    
    if (state.startPrice > 0) {
      const change = ((state.displayPrice - state.startPrice) / state.startPrice) * 100;
      DOM.tickerChange.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
      DOM.tickerChange.className = 'ticker-change ' + (change >= 0 ? 'up' : 'down');
    }
  }

  function updateRoundTimer() {
    if (!DOM.roundTimer || !state.roundEndTime) return;
    
    const remaining = Math.max(0, Math.ceil((state.roundEndTime - Date.now()) / 1000));
    DOM.roundTimer.textContent = remaining + 's';
    DOM.roundTimer.classList.toggle('ending', remaining <= 5);
  }

  // ============================================
  // CANVAS
  // ============================================
  function initCanvas() {
    resizeCanvas();
    DOM.canvas.addEventListener('pointerdown', onPointerDown);
    DOM.canvas.addEventListener('pointermove', onPointerMove);
    DOM.canvas.addEventListener('pointerup', onPointerUp);
    DOM.canvas.addEventListener('pointerleave', onPointerUp);
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    DOM.canvas.width = DOM.chartContainer.clientWidth * dpr;
    DOM.canvas.height = DOM.chartContainer.clientHeight * dpr;
    DOM.canvas.style.width = DOM.chartContainer.clientWidth + 'px';
    DOM.canvas.style.height = DOM.chartContainer.clientHeight + 'px';
  }

  function getCoord(e) {
    const rect = DOM.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
  }

  function getAnchor() {
    const now = state.lastTime || Math.floor(Date.now() / 1000);
    const x = state.chart.timeScale().timeToCoordinate(now);
    const y = state.series.priceToCoordinate(state.displayPrice);
    if (x === null || y === null) return null;
    const dpr = window.devicePixelRatio || 1;
    return { x: x * dpr, y: y * dpr };
  }

  function onPointerDown(e) {
    if (state.mode !== 'drawing') return;
    e.preventDefault();
    state.isDrawing = true;
    state.drawPath = [getCoord(e)];
  }

  function onPointerMove(e) {
    if (state.mode !== 'drawing' || !state.isDrawing) return;
    e.preventDefault();
    state.drawPath.push(getCoord(e));
    updateTargetFromDrawing();
  }

  function onPointerUp() {
    state.isDrawing = false;
  }

  function updateTargetFromDrawing() {
    if (state.drawPath.length === 0) return;
    const end = state.drawPath[state.drawPath.length - 1];
    const dpr = window.devicePixelRatio || 1;
    const price = state.series.coordinateToPrice(end.y / dpr);
    
    if (price && price > 0) {
      state.targetPrice = price;
      DOM.targetPrice.textContent = formatPrice(price);
      DOM.targetPrice.classList.remove('empty');
      
      const diff = price - state.currentPrice;
      const pct = (diff / state.currentPrice) * 100;
      DOM.targetDiff.textContent = `${diff >= 0 ? '+' : ''}${formatPrice(diff)} (${diff >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
      DOM.targetDiff.className = 'target-diff ' + (diff >= 0 ? 'up' : 'down');
    }
  }

  function redrawCanvas() {
    const ctx = DOM.canvas.getContext('2d');
    const w = DOM.canvas.width;
    const h = DOM.canvas.height;
    const dpr = window.devicePixelRatio || 1;
    
    ctx.clearRect(0, 0, w, h);
    
    const anchor = getAnchor();
    if (!anchor) return;
    
    // Draw ghost lines first (behind user's line)
    for (const ghost of state.ghostPredictions) {
      if (ghost.path.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(150, 150, 150, ${ghost.opacity})`;
        ctx.lineWidth = 2 * dpr;
        ctx.lineCap = 'round';
        ctx.moveTo(ghost.path[0].x, ghost.path[0].y);
        for (let i = 1; i < ghost.path.length; i++) {
          ctx.lineTo(ghost.path[i].x, ghost.path[i].y);
        }
        ctx.stroke();
      }
    }
    
    // Anchor
    if (state.mode === 'drawing') {
      const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;
      ctx.beginPath();
      ctx.fillStyle = `rgba(247, 147, 26, ${0.2 * pulse})`;
      ctx.arc(anchor.x, anchor.y, 25 * dpr, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.beginPath();
      ctx.fillStyle = '#f7931a';
      ctx.arc(anchor.x, anchor.y, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // User's line
    if (state.drawPath.length > 0) {
      // Leash
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(247, 147, 26, 0.4)';
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([6 * dpr, 6 * dpr]);
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(state.drawPath[0].x, state.drawPath[0].y);
      ctx.stroke();
      ctx.setLineDash([]);
      
      if (state.drawPath.length > 1) {
        // Glow
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0, 210, 106, 0.2)';
        ctx.lineWidth = 14 * dpr;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(state.drawPath[0].x, state.drawPath[0].y);
        for (let i = 1; i < state.drawPath.length; i++) {
          ctx.lineTo(state.drawPath[i].x, state.drawPath[i].y);
        }
        ctx.stroke();
        
        // Main line
        ctx.beginPath();
        ctx.strokeStyle = '#00d26a';
        ctx.lineWidth = 3 * dpr;
        ctx.moveTo(state.drawPath[0].x, state.drawPath[0].y);
        for (let i = 1; i < state.drawPath.length; i++) {
          ctx.lineTo(state.drawPath[i].x, state.drawPath[i].y);
        }
        ctx.stroke();
        
        // End dot
        const end = state.drawPath[state.drawPath.length - 1];
        ctx.beginPath();
        ctx.fillStyle = '#00d26a';
        ctx.arc(end.x, end.y, 6 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    
    // Ghost count indicator
    if (state.ghostPredictions.length > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = `${12 * dpr}px JetBrains Mono`;
      ctx.fillText(`${state.ghostPredictions.length} other predictions`, 10 * dpr, 20 * dpr);
    }
  }

  // ============================================
  // RENDERING
  // ============================================
  function renderResults() {
    if (!DOM.resultsList) return;
    
    DOM.resultsList.innerHTML = state.roundResults.slice(0, 5).map((p, i) => `
      <div class="result-item ${p.user_id === state.userId ? 'is-you' : ''}">
        <span class="result-rank">${p.rank || i + 1}</span>
        <span class="result-name">${p.users?.nickname || 'Player'}</span>
        <span class="result-target">${formatPrice(p.target_price)}</span>
        <span class="result-accuracy">${p.accuracy?.toFixed(1) || '0.0'}%</span>
      </div>
    `).join('');
    
    // Show user's result
    const myResult = state.roundResults.find(p => p.user_id === state.userId);
    if (myResult && DOM.myResult) {
      DOM.myResult.innerHTML = `
        <div class="my-result-rank">#${myResult.rank || '?'}</div>
        <div class="my-result-accuracy">${myResult.accuracy?.toFixed(1) || '0.0'}%</div>
      `;
    }
  }

  function renderLeaderboard() {
    if (!DOM.leaderboard) return;
    
    DOM.leaderboard.innerHTML = state.leaderboard.map((u, i) => `
      <div class="leaderboard-item ${u.user_id === state.userId ? 'is-you' : ''}">
        <span class="lb-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}">${i + 1}</span>
        <div class="lb-avatar">${u.nickname?.[0] || '?'}</div>
        <div class="lb-info">
          <div class="lb-name">${u.nickname || 'Player'}</div>
          <div class="lb-predictions">${u.total_predictions} predictions</div>
        </div>
        <span class="lb-accuracy">${u.avg_accuracy?.toFixed(1) || '0.0'}%</span>
      </div>
    `).join('');
  }

  function initMockLeaderboard() {
    const names = ['CryptoKing', 'SatoshiV', 'MoonLambo', 'WAGMI', 'Diamond', 'ChartPro'];
    state.leaderboard = names.map((name, i) => ({
      nickname: name,
      total_predictions: Math.floor(80 + Math.random() * 200),
      avg_accuracy: parseFloat((96 - i * 3.5 + Math.random() * 2).toFixed(1)),
    }));
    renderLeaderboard();
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================
  function setupEventListeners() {
    DOM.btnDraw?.addEventListener('click', () => setMode('drawing'));
    DOM.btnCancel?.addEventListener('click', () => {
      state.drawPath = [];
      state.targetPrice = null;
      setMode('idle');
    });
    DOM.btnSubmit?.addEventListener('click', submitPrediction);
  }

  // ============================================
  // UTILS
  // ============================================
  function formatPrice(p) {
    if (!p || isNaN(p)) return '$--,---.--';
    return '$' + p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ============================================
  // START
  // ============================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
