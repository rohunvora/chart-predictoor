// ============================================
// Chart Predictoor - Main Application
// ============================================

(function() {
  'use strict';

  // ============================================
  // State
  // ============================================
  const state = {
    nickname: null,
    chart: null,
    lineSeries: null,
    priceData: [],
    currentPrice: 0,
    startPrice: 0,
    isDrawing: false,
    isDrawingMode: false,
    drawingPoints: [],
    prediction: null,
    predictionStartTime: null,
    predictionDuration: 60000, // 60 seconds
    ws: null,
    leaderboard: []
  };

  // ============================================
  // DOM Elements
  // ============================================
  const elements = {
    nicknameModal: document.getElementById('nickname-modal'),
    nicknameInput: document.getElementById('nickname-input'),
    nicknameSubmit: document.getElementById('nickname-submit'),
    app: document.getElementById('app'),
    currentPrice: document.getElementById('current-price'),
    priceChange: document.getElementById('price-change'),
    userNickname: document.getElementById('user-nickname'),
    userAvatar: document.getElementById('user-avatar'),
    chartContainer: document.getElementById('chart-container'),
    drawingCanvas: document.getElementById('drawing-canvas'),
    drawingControls: document.getElementById('drawing-controls'),
    predictBtn: document.getElementById('predict-btn'),
    clearDrawing: document.getElementById('clear-drawing'),
    submitPrediction: document.getElementById('submit-prediction'),
    leaderboard: document.getElementById('leaderboard'),
    activePrediction: document.getElementById('active-prediction'),
    predictionAccuracy: document.getElementById('prediction-accuracy'),
    predictionCountdown: document.getElementById('prediction-countdown')
  };

  // ============================================
  // Mock Leaderboard Data
  // ============================================
  const mockUsers = [
    { id: 'u1', name: 'CryptoKing', accuracy: 94.2 },
    { id: 'u2', name: 'BitWizard', accuracy: 91.8 },
    { id: 'u3', name: 'MoonShot', accuracy: 89.5 },
    { id: 'u4', name: 'DiamondHands', accuracy: 87.3 },
    { id: 'u5', name: 'Satoshi Jr', accuracy: 85.1 },
    { id: 'u6', name: 'HODLer', accuracy: 82.7 },
    { id: 'u7', name: 'BullRunner', accuracy: 79.4 },
    { id: 'u8', name: 'ChartMaster', accuracy: 76.2 }
  ];

  // ============================================
  // Initialization
  // ============================================
  function init() {
    checkNickname();
    setupEventListeners();
  }

  function checkNickname() {
    const saved = localStorage.getItem('predictoor_nickname');
    if (saved) {
      state.nickname = saved;
      showApp();
    }
  }

  function showApp() {
    elements.nicknameModal.classList.add('hidden');
    elements.app.classList.remove('hidden');
    elements.userNickname.textContent = state.nickname;
    elements.userAvatar.textContent = state.nickname.charAt(0).toUpperCase();
    
    initChart();
    initCanvas();
    connectWebSocket();
    updateLeaderboard();
  }

  // ============================================
  // Event Listeners
  // ============================================
  function setupEventListeners() {
    // Nickname submission
    elements.nicknameSubmit.addEventListener('click', handleNicknameSubmit);
    elements.nicknameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleNicknameSubmit();
    });

    // Predict button
    elements.predictBtn.addEventListener('click', enterDrawingMode);

    // Drawing controls
    elements.clearDrawing.addEventListener('click', clearDrawing);
    elements.submitPrediction.addEventListener('click', submitPrediction);

    // Window resize
    window.addEventListener('resize', debounce(handleResize, 250));
  }

  function handleNicknameSubmit() {
    const nickname = elements.nicknameInput.value.trim();
    if (nickname.length >= 2) {
      state.nickname = nickname;
      localStorage.setItem('predictoor_nickname', nickname);
      showApp();
    } else {
      elements.nicknameInput.style.borderColor = '#f44336';
      setTimeout(() => {
        elements.nicknameInput.style.borderColor = '';
      }, 1000);
    }
  }

  // ============================================
  // Chart Setup (Lightweight Charts)
  // ============================================
  function initChart() {
    const container = elements.chartContainer;
    
    state.chart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: 'solid', color: '#ffffff' },
        textColor: '#333333',
        fontFamily: "'Space Grotesk', sans-serif"
      },
      grid: {
        vertLines: { color: 'rgba(0, 0, 0, 0.04)' },
        horzLines: { color: 'rgba(0, 0, 0, 0.04)' }
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(124, 179, 66, 0.4)',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed
        },
        horzLine: {
          color: 'rgba(124, 179, 66, 0.4)',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed
        }
      },
      rightPriceScale: {
        borderColor: 'rgba(0, 0, 0, 0.1)',
        scaleMargins: { top: 0.1, bottom: 0.1 }
      },
      timeScale: {
        borderColor: 'rgba(0, 0, 0, 0.1)',
        timeVisible: true,
        secondsVisible: true
      },
      handleScroll: false,
      handleScale: false
    });

    state.lineSeries = state.chart.addLineSeries({
      color: '#c62828',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: '#c62828',
      crosshairMarkerBackgroundColor: '#ffffff',
      priceLineVisible: true,
      priceLineWidth: 1,
      priceLineColor: '#c62828',
      priceLineStyle: LightweightCharts.LineStyle.Dashed
    });

    // Generate initial mock data
    generateInitialData();
  }

  function generateInitialData() {
    const now = Math.floor(Date.now() / 1000);
    const basePrice = 98000 + Math.random() * 2000;
    state.startPrice = basePrice;
    
    // Generate 60 seconds of historical data
    for (let i = 60; i >= 0; i--) {
      const time = now - i;
      const noise = (Math.random() - 0.5) * 100;
      const trend = Math.sin(i / 10) * 50;
      const price = basePrice + noise + trend;
      
      state.priceData.push({ time, value: price });
    }
    
    state.currentPrice = state.priceData[state.priceData.length - 1].value;
    state.lineSeries.setData(state.priceData);
    updatePriceDisplay();
  }

  function handleResize() {
    if (state.chart) {
      const container = elements.chartContainer;
      state.chart.resize(container.clientWidth, container.clientHeight);
      resizeCanvas();
    }
  }

  // ============================================
  // WebSocket Connection (Binance)
  // ============================================
  function connectWebSocket() {
    // Use Binance WebSocket for real BTC price
    const wsUrl = 'wss://stream.binance.com:9443/ws/btcusdt@trade';
    
    try {
      state.ws = new WebSocket(wsUrl);
      
      state.ws.onopen = () => {
        console.log('Connected to Binance WebSocket');
      };
      
      state.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handlePriceUpdate(parseFloat(data.p));
      };
      
      state.ws.onerror = (error) => {
        console.log('WebSocket error, falling back to mock data');
        startMockPriceUpdates();
      };
      
      state.ws.onclose = () => {
        console.log('WebSocket closed, reconnecting...');
        setTimeout(connectWebSocket, 3000);
      };
    } catch (e) {
      console.log('WebSocket not available, using mock data');
      startMockPriceUpdates();
    }
  }

  function startMockPriceUpdates() {
    setInterval(() => {
      const lastPrice = state.currentPrice;
      const change = (Math.random() - 0.5) * 50;
      const newPrice = lastPrice + change;
      handlePriceUpdate(newPrice);
    }, 500);
  }

  function handlePriceUpdate(price) {
    state.currentPrice = price;
    
    const now = Math.floor(Date.now() / 1000);
    const newPoint = { time: now, value: price };
    
    // Add new point, keep last 120 points
    state.priceData.push(newPoint);
    if (state.priceData.length > 120) {
      state.priceData.shift();
    }
    
    state.lineSeries.setData(state.priceData);
    updatePriceDisplay();
    
    // Update prediction accuracy if active
    if (state.prediction) {
      updatePredictionAccuracy();
    }
  }

  function updatePriceDisplay() {
    elements.currentPrice.textContent = formatPrice(state.currentPrice);
    
    const change = ((state.currentPrice - state.startPrice) / state.startPrice) * 100;
    const changeText = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
    elements.priceChange.textContent = changeText;
    elements.priceChange.className = 'price-change ' + (change >= 0 ? 'positive' : 'negative');
  }

  // ============================================
  // Canvas Drawing (Signature-smooth)
  // ============================================
  function initCanvas() {
    const canvas = elements.drawingCanvas;
    resizeCanvas();
    
    // Pointer events for smooth cross-device drawing
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp);
  }

  function resizeCanvas() {
    const canvas = elements.drawingCanvas;
    const container = elements.chartContainer;
    const dpr = window.devicePixelRatio || 1;
    
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    canvas.style.width = container.clientWidth + 'px';
    canvas.style.height = container.clientHeight + 'px';
    
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    
    // Redraw if we have points
    if (state.drawingPoints.length > 0) {
      redrawCanvas();
    }
  }

  function handlePointerDown(e) {
    if (!state.isDrawingMode) return;
    
    e.preventDefault();
    state.isDrawing = true;
    
    const point = getCanvasPoint(e);
    state.drawingPoints = [point];
    
    drawPoint(point);
  }

  function handlePointerMove(e) {
    if (!state.isDrawing) return;
    
    e.preventDefault();
    const point = getCanvasPoint(e);
    
    // Only add point if moved enough (smoothing)
    const lastPoint = state.drawingPoints[state.drawingPoints.length - 1];
    const dist = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
    
    if (dist > 2) {
      state.drawingPoints.push(point);
      redrawCanvas();
    }
  }

  function handlePointerUp(e) {
    if (!state.isDrawing) return;
    
    e.preventDefault();
    state.isDrawing = false;
    
    // Smooth the line with cardinal spline
    if (state.drawingPoints.length > 2) {
      state.drawingPoints = smoothLine(state.drawingPoints);
      redrawCanvas();
    }
  }

  function getCanvasPoint(e) {
    const canvas = elements.drawingCanvas;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  function drawPoint(point) {
    const canvas = elements.drawingCanvas;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#7cb342';
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function redrawCanvas() {
    const canvas = elements.drawingCanvas;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    
    // Clear
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    
    if (state.drawingPoints.length < 2) {
      if (state.drawingPoints.length === 1) {
        drawPoint(state.drawingPoints[0]);
      }
      return;
    }
    
    // Draw the prediction zone (right third of chart)
    const zoneStart = (canvas.width / dpr) * 0.65;
    ctx.fillStyle = 'rgba(124, 179, 66, 0.08)';
    ctx.fillRect(zoneStart, 0, (canvas.width / dpr) - zoneStart, canvas.height / dpr);
    
    // Draw vertical line at prediction start
    ctx.strokeStyle = 'rgba(124, 179, 66, 0.3)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(zoneStart, 0);
    ctx.lineTo(zoneStart, canvas.height / dpr);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Draw smooth prediction line
    ctx.strokeStyle = '#7cb342';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    ctx.moveTo(state.drawingPoints[0].x, state.drawingPoints[0].y);
    
    for (let i = 1; i < state.drawingPoints.length; i++) {
      const p = state.drawingPoints[i];
      ctx.lineTo(p.x, p.y);
    }
    
    ctx.stroke();
    
    // Draw glow effect
    ctx.strokeStyle = 'rgba(124, 179, 66, 0.3)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(state.drawingPoints[0].x, state.drawingPoints[0].y);
    for (let i = 1; i < state.drawingPoints.length; i++) {
      ctx.lineTo(state.drawingPoints[i].x, state.drawingPoints[i].y);
    }
    ctx.stroke();
    
    // Draw endpoint
    const lastPoint = state.drawingPoints[state.drawingPoints.length - 1];
    ctx.fillStyle = '#7cb342';
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, 6, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cardinal spline smoothing
  function smoothLine(points, tension = 0.5, numSegments = 16) {
    if (points.length < 3) return points;
    
    const result = [];
    
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[Math.min(points.length - 1, i + 1)];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      
      for (let t = 0; t < numSegments; t++) {
        const s = t / numSegments;
        
        const x = catmullRom(p0.x, p1.x, p2.x, p3.x, s, tension);
        const y = catmullRom(p0.y, p1.y, p2.y, p3.y, s, tension);
        
        result.push({ x, y });
      }
    }
    
    result.push(points[points.length - 1]);
    return result;
  }

  function catmullRom(p0, p1, p2, p3, t, tension) {
    const t2 = t * t;
    const t3 = t2 * t;
    
    const m0 = (p2 - p0) * tension;
    const m1 = (p3 - p1) * tension;
    
    return (2 * t3 - 3 * t2 + 1) * p1 +
           (t3 - 2 * t2 + t) * m0 +
           (-2 * t3 + 3 * t2) * p2 +
           (t3 - t2) * m1;
  }

  // ============================================
  // Drawing Mode
  // ============================================
  function enterDrawingMode() {
    if (state.prediction) {
      // Already have an active prediction
      return;
    }
    
    state.isDrawingMode = true;
    state.drawingPoints = [];
    
    elements.drawingCanvas.classList.add('active');
    elements.drawingControls.classList.remove('hidden');
    elements.predictBtn.classList.add('hidden');
    
    // Show prediction zone on canvas
    redrawCanvas();
  }

  function exitDrawingMode() {
    state.isDrawingMode = false;
    state.isDrawing = false;
    
    elements.drawingCanvas.classList.remove('active');
    elements.drawingControls.classList.add('hidden');
    elements.predictBtn.classList.remove('hidden');
  }

  function clearDrawing() {
    state.drawingPoints = [];
    const canvas = elements.drawingCanvas;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    redrawCanvas();
  }

  // ============================================
  // Prediction Submission & Scoring
  // ============================================
  function submitPrediction() {
    if (state.drawingPoints.length < 10) {
      // Need more points for a valid prediction
      alert('Draw a longer prediction line!');
      return;
    }
    
    // Convert canvas points to price predictions
    const canvas = elements.drawingCanvas;
    const dpr = window.devicePixelRatio || 1;
    const canvasHeight = canvas.height / dpr;
    
    // Get price range from chart
    const priceRange = getPriceRange();
    
    // Convert Y coordinates to prices
    state.prediction = {
      startTime: Date.now(),
      points: state.drawingPoints.map(p => ({
        // Normalize X to 0-1 representing prediction timeline
        t: p.x / (canvas.width / dpr),
        // Convert Y to price (inverted because canvas Y is top-down)
        price: priceRange.max - (p.y / canvasHeight) * (priceRange.max - priceRange.min)
      })),
      accuracy: 100
    };
    
    state.predictionStartTime = Date.now();
    
    // Show active prediction banner
    elements.activePrediction.classList.remove('hidden');
    
    // Start countdown
    startPredictionCountdown();
    
    // Exit drawing mode but keep line visible
    state.isDrawingMode = false;
    elements.drawingCanvas.classList.remove('active');
    elements.drawingControls.classList.add('hidden');
    elements.predictBtn.classList.add('hidden');
    
    // Add user to leaderboard
    addUserToLeaderboard();
  }

  function getPriceRange() {
    const prices = state.priceData.map(d => d.value);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const padding = (max - min) * 0.1;
    return { min: min - padding, max: max + padding };
  }

  function startPredictionCountdown() {
    const updateCountdown = () => {
      if (!state.prediction) return;
      
      const elapsed = Date.now() - state.predictionStartTime;
      const remaining = Math.max(0, state.predictionDuration - elapsed);
      const seconds = Math.ceil(remaining / 1000);
      
      elements.predictionCountdown.textContent = seconds + 's';
      
      if (remaining > 0) {
        requestAnimationFrame(updateCountdown);
      } else {
        finalizePrediction();
      }
    };
    
    requestAnimationFrame(updateCountdown);
  }

  function updatePredictionAccuracy() {
    if (!state.prediction) return;
    
    const elapsed = Date.now() - state.predictionStartTime;
    const progress = Math.min(1, elapsed / state.predictionDuration);
    
    // Get the predicted price at current progress
    const predictedPrice = interpolatePrediction(progress);
    
    // Calculate accuracy (inverse of error percentage)
    const error = Math.abs(state.currentPrice - predictedPrice) / state.currentPrice;
    const accuracy = Math.max(0, (1 - error * 10) * 100); // Scale error
    
    state.prediction.accuracy = accuracy;
    elements.predictionAccuracy.textContent = accuracy.toFixed(1) + '%';
    
    // Update in leaderboard
    updateUserInLeaderboard(accuracy);
  }

  function interpolatePrediction(progress) {
    if (!state.prediction || state.prediction.points.length === 0) {
      return state.currentPrice;
    }
    
    const points = state.prediction.points;
    
    // Find the two points to interpolate between
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i + 1].t >= progress) {
        const t = (progress - points[i].t) / (points[i + 1].t - points[i].t);
        return points[i].price + t * (points[i + 1].price - points[i].price);
      }
    }
    
    return points[points.length - 1].price;
  }

  function finalizePrediction() {
    // Prediction period ended
    const finalAccuracy = state.prediction.accuracy;
    
    // Clear prediction
    state.prediction = null;
    state.predictionStartTime = null;
    
    // Hide banner
    elements.activePrediction.classList.add('hidden');
    
    // Clear canvas
    clearDrawing();
    
    // Show predict button again
    elements.predictBtn.classList.remove('hidden');
    
    // Show result (could make this fancier)
    setTimeout(() => {
      alert(`Prediction complete! Final accuracy: ${finalAccuracy.toFixed(1)}%`);
    }, 100);
  }

  // ============================================
  // Leaderboard
  // ============================================
  function updateLeaderboard() {
    // Combine mock users with current user if they have a prediction
    state.leaderboard = [...mockUsers];
    
    // Sort by accuracy
    state.leaderboard.sort((a, b) => b.accuracy - a.accuracy);
    
    renderLeaderboard();
  }

  function addUserToLeaderboard() {
    // Remove existing user entry if present
    state.leaderboard = state.leaderboard.filter(u => u.id !== 'current-user');
    
    // Add current user
    state.leaderboard.push({
      id: 'current-user',
      name: state.nickname,
      accuracy: state.prediction.accuracy,
      isUser: true
    });
    
    // Sort and render
    state.leaderboard.sort((a, b) => b.accuracy - a.accuracy);
    renderLeaderboard();
  }

  function updateUserInLeaderboard(accuracy) {
    const userEntry = state.leaderboard.find(u => u.id === 'current-user');
    if (userEntry) {
      userEntry.accuracy = accuracy;
      state.leaderboard.sort((a, b) => b.accuracy - a.accuracy);
      renderLeaderboard();
    }
  }

  function renderLeaderboard() {
    const container = elements.leaderboard;
    container.innerHTML = '';
    
    state.leaderboard.slice(0, 10).forEach((user, index) => {
      const rank = index + 1;
      const item = document.createElement('div');
      item.className = 'leaderboard-item' + (user.isUser ? ' is-you' : '');
      
      const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : 'normal';
      const accuracyClass = user.accuracy >= 90 ? 'excellent' : user.accuracy >= 70 ? 'good' : 'poor';
      
      item.innerHTML = `
        <div class="rank ${rankClass}">${rank}</div>
        <div class="leaderboard-avatar">${user.name.charAt(0).toUpperCase()}</div>
        <div class="leaderboard-info">
          <div class="leaderboard-name">${user.name}${user.isUser ? ' (You)' : ''}</div>
          <div class="leaderboard-status">${user.isUser ? 'Active prediction' : 'Last prediction'}</div>
        </div>
        <div class="leaderboard-accuracy ${accuracyClass}">${user.accuracy.toFixed(1)}%</div>
      `;
      
      container.appendChild(item);
    });
  }

  // Simulate live leaderboard updates
  function startLeaderboardUpdates() {
    setInterval(() => {
      mockUsers.forEach(user => {
        // Small random fluctuation
        user.accuracy = Math.max(50, Math.min(99, user.accuracy + (Math.random() - 0.5) * 2));
      });
      
      if (!state.prediction) {
        updateLeaderboard();
      }
    }, 3000);
  }

  // ============================================
  // Utilities
  // ============================================
  function formatPrice(price) {
    return '$' + price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // ============================================
  // Start the app
  // ============================================
  document.addEventListener('DOMContentLoaded', () => {
    init();
    startLeaderboardUpdates();
  });

})();

