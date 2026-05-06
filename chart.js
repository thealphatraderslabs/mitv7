// ═══════════════════════════════════════════════════════════════
// CHART RENDERER
// ═══════════════════════════════════════════════════════════════
function renderChart(candles, stData, fvgs, swings, srLevels) {
  _lastChartState = { candles, stData, fvgs, swings, srLevels };
  const canvas = document.getElementById('priceCanvas');
  const wrap   = document.getElementById('canvasWrap');
  const dpr = window.devicePixelRatio || 1;
  const W0 = wrap.offsetWidth || 640, H0 = wrap.offsetHeight || 300;
  canvas.width = W0*dpr; canvas.height = H0*dpr;
  canvas.style.width = W0+'px'; canvas.style.height = H0+'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W=W0, H=H0;
  ctx.clearRect(0,0,W,H);

  const CHART_H = Math.floor(H*0.60);
  const VOL_H   = Math.floor(H*0.12);
  const RSI_H   = Math.floor(H*0.18);
  const pad = {top:14,left:4,right:68};
  const chartTop = pad.top;
  const volTop   = chartTop + CHART_H + 2;
  const rsiTop   = volTop + VOL_H + 2;

  const DISPLAY_BARS = Math.min(80, candles.length);
  const display = candles.slice(-DISPLAY_BARS);
  const n = display.length;
  const allCandles = candles;
  const cw = (W - pad.left - pad.right) / n;
  const barW = Math.max(cw * 0.72, 1);

  const prices = display.flatMap(c => [c.high, c.low]);
  const rawMin = Math.min(...prices), rawMax = Math.max(...prices);
  const pPad = (rawMax-rawMin)*0.04;
  const minP = rawMin-pPad, maxP = rawMax+pPad;
  const pRange = maxP-minP || 1;

  const cx  = i => pad.left + i*cw + cw*0.14;
  const cxm = i => pad.left + i*cw + cw*0.14 + barW/2;
  const py  = (p,top,h) => top + h*(1-(p-minP)/pRange);

  const lastTrend = stData.trend[allCandles.length-1];
  ctx.fillStyle = lastTrend===1 ? 'rgba(0,230,118,0.025)' : 'rgba(255,68,68,0.025)';
  ctx.fillRect(pad.left, chartTop, W-pad.left-pad.right, CHART_H);

  ctx.font = '8px JetBrains Mono';
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.5;
  for (let i=0; i<=5; i++) {
    const y = chartTop + (CHART_H/5)*i;
    const price = maxP - (pRange/5)*i;
    ctx.beginPath(); ctx.moveTo(pad.left,y); ctx.lineTo(W-pad.right,y); ctx.stroke();
    ctx.fillStyle = '#5a6470';
    ctx.fillText(fmtPrice(price), W-pad.right+3, y+3);
  }
  for (let i=0; i<n; i+=10) {
    const x = cx(i);
    ctx.strokeStyle='rgba(255,255,255,0.04)';
    ctx.beginPath(); ctx.moveTo(x,chartTop); ctx.lineTo(x,chartTop+CHART_H); ctx.stroke();
    if (display[i]) {
      ctx.fillStyle='#5a6470';
      const dt = new Date(display[i].time);
      const isDailyOrWeekly = (_lastTF === '1d' || _lastTF === '1w');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const timeLabel = isDailyOrWeekly
        ? dt.getUTCDate() + ' ' + months[dt.getUTCMonth()]
        : (dt.getUTCHours()+'').padStart(2,'0')+':'+(dt.getUTCMinutes()+'').padStart(2,'0');
      ctx.fillText(timeLabel, x - (isDailyOrWeekly ? 10 : 8), chartTop+CHART_H+10);
    }
  }

  // FVGs
  fvgs.filter(g=>!g.filled).forEach(g => {
    const gy1 = py(g.top,chartTop,CHART_H), gy2 = py(g.bottom,chartTop,CHART_H);
    ctx.fillStyle = g.type==='bull' ? 'rgba(0,230,118,0.07)' : 'rgba(255,68,68,0.07)';
    ctx.fillRect(pad.left, gy1, W-pad.left-pad.right, gy2-gy1);
  });

  // SR lines
  srLevels.slice(0,6).forEach(l => {
    const y = py(l.price, chartTop, CHART_H);
    ctx.strokeStyle = l.zone==='resistance' ? 'rgba(255,68,68,0.35)' : l.zone==='support' ? 'rgba(0,230,118,0.35)' : 'rgba(255,213,79,0.35)';
    ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(pad.left,y); ctx.lineTo(W-pad.right,y); ctx.stroke();
    ctx.setLineDash([]);
  });

  // SuperTrend line
  const stLineDisplay = stData.stLine.slice(-DISPLAY_BARS);
  const stTrendDisplay = stData.trend.slice(-DISPLAY_BARS);
  ctx.lineWidth=1.5;
  for (let i=1; i<n; i++) {
    if (!stLineDisplay[i]||!stLineDisplay[i-1]) continue;
    ctx.strokeStyle = stTrendDisplay[i]===1 ? 'rgba(0,230,118,0.7)' : 'rgba(255,68,68,0.7)';
    ctx.beginPath();
    ctx.moveTo(cxm(i-1), py(stLineDisplay[i-1],chartTop,CHART_H));
    ctx.lineTo(cxm(i),   py(stLineDisplay[i],  chartTop,CHART_H));
    ctx.stroke();
  }
  ctx.lineWidth=1;

  // Candles
  for (let i=0; i<n; i++) {
    const c = display[i];
    const x = cx(i);
    const o = py(c.open, chartTop, CHART_H), cl = py(c.close, chartTop, CHART_H);
    const h = py(c.high, chartTop, CHART_H), l = py(c.low, chartTop, CHART_H);
    const bull = c.close >= c.open;
    ctx.strokeStyle = bull ? '#00e676' : '#ff4444';
    ctx.fillStyle   = bull ? 'rgba(0,230,118,0.75)' : 'rgba(255,68,68,0.75)';
    ctx.beginPath(); ctx.moveTo(cxm(i),h); ctx.lineTo(cxm(i),l); ctx.stroke();
    const top=Math.min(o,cl), ht=Math.max(Math.abs(cl-o),1);
    ctx.fillRect(x, top, barW, ht);
  }

  // FIX 10 — STRONG/WEAK HIGH/LOW LABELS
  const { highs, lows } = swings;
  // LuxAlgo logic: swingTrend === BEARISH → most recent high = Strong High (structural)
  //                swingTrend === BULLISH → most recent high = Weak High (will be broken)
  //                swingTrend === BULLISH → most recent low  = Strong Low
  //                swingTrend === BEARISH → most recent low  = Weak Low
  // We read swingTrend from the struct object if it was passed via swings, otherwise
  // call detectStructure here using the full candle array.
  // To avoid double-calling detectStructure on every render, we store the last result
  // on the swings object itself (set by renderChart caller in analysis.js).
  const _structForLabels = detectStructure(allCandles, highs, lows);
  const _swingTrend = _structForLabels.swingTrend; // 1=bull, -1=bear, 0=unknown

  highs.forEach(sh => {
    const di = n - (allCandles.length - sh.idx);
    if (di < 0 || di >= n) return;
    const y = py(sh.price, chartTop, CHART_H);
    // FIX 10: last swing high gets Strong/Weak label; others get plain H
    const isLast = sh === highs[highs.length - 1];
    if (isLast && _swingTrend !== 0) {
      const isStrong = _swingTrend === -1; // bearish trend = Strong High
      ctx.fillStyle = isStrong ? 'rgba(255,68,68,1)' : 'rgba(255,68,68,0.5)';
      ctx.font = '7px JetBrains Mono';
      ctx.fillText(isStrong ? 'SH' : 'WH', cxm(di) - 4, y - 4);
    } else {
      ctx.fillStyle = 'rgba(255,68,68,0.8)';
      ctx.font = '7px JetBrains Mono';
      ctx.fillText('H', cxm(di) - 3, y - 4);
    }
  });
  lows.forEach(sl => {
    const di = n - (allCandles.length - sl.idx);
    if (di < 0 || di >= n) return;
    const y = py(sl.price, chartTop, CHART_H);
    const isLast = sl === lows[lows.length - 1];
    if (isLast && _swingTrend !== 0) {
      const isStrong = _swingTrend === 1; // bullish trend = Strong Low
      ctx.fillStyle = isStrong ? 'rgba(0,230,118,1)' : 'rgba(0,230,118,0.5)';
      ctx.font = '7px JetBrains Mono';
      ctx.fillText(isStrong ? 'SL' : 'WL', cxm(di) - 4, y + 9);
    } else {
      ctx.fillStyle = 'rgba(0,230,118,0.8)';
      ctx.font = '7px JetBrains Mono';
      ctx.fillText('L', cxm(di) - 3, y + 9);
    }
  });

  // Volume bars
  const vols = display.map(c => c.vol);
  const maxVol = Math.max(...vols) || 1;
  for (let i=0; i<n; i++) {
    const c = display[i];
    const vh = Math.max((c.vol/maxVol)*VOL_H*0.9, 1);
    ctx.fillStyle = c.close >= c.open ? 'rgba(0,230,118,0.4)' : 'rgba(255,68,68,0.4)';
    ctx.fillRect(cx(i), volTop + VOL_H - vh, barW, vh);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath(); ctx.moveTo(pad.left,volTop); ctx.lineTo(W-pad.right,volTop); ctx.stroke();

  // RSI sub-panel
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath(); ctx.moveTo(pad.left,rsiTop); ctx.lineTo(W-pad.right,rsiTop); ctx.stroke();
  const rsiArr = calcRSI(allCandles.map(c=>c.close), 14);
  const rsiDisplay = rsiArr.slice(-DISPLAY_BARS);
  const rsiY = v => rsiTop + RSI_H * (1 - (v-20)/80);
  ctx.fillStyle = 'rgba(255,68,68,0.06)';
  ctx.fillRect(pad.left, rsiY(70), W-pad.left-pad.right, rsiY(80)-rsiY(70));
  ctx.fillStyle = 'rgba(0,230,118,0.06)';
  ctx.fillRect(pad.left, rsiY(30), W-pad.left-pad.right, rsiY(20)-rsiY(30));
  ctx.strokeStyle = '#8892a0'; ctx.lineWidth=1;
  ctx.beginPath();
  for (let i=0; i<n; i++) {
    const v = Math.max(20, Math.min(80, rsiDisplay[i]||50));
    i===0 ? ctx.moveTo(cxm(i),rsiY(v)) : ctx.lineTo(cxm(i),rsiY(v));
  }
  ctx.stroke();
  ctx.fillStyle = '#5a6470'; ctx.font='7px JetBrains Mono';
  ctx.fillText('RSI', W-pad.right+3, rsiTop+6);
  ctx.fillText('70',  W-pad.right+3, rsiY(70)+3);
  ctx.fillText('30',  W-pad.right+3, rsiY(30)+3);
  if (rsiDisplay.length > 0) {
    const lastRsi = rsiDisplay[rsiDisplay.length-1] || 50;
    ctx.fillStyle = lastRsi > 70 ? '#ff4444' : lastRsi < 30 ? '#00e676' : '#8892a0';
    ctx.fillText(lastRsi.toFixed(0), W-pad.right+3, rsiY(Math.max(20,Math.min(80,lastRsi)))+3);
  }
}

// ═══════════════════════════════════════════════════════════════
// FIX 4 — ORDER BLOCK DETECTION: correct window + candle selection
// FIX 5 — ORDER BLOCK MITIGATION: remove crossed OBs
//
// OLD logic problems:
//   A. Scanned pivot ±5 bars for any matching candle colour — wrong window.
//   B. Picked the FIRST matching candle found — wrong selection method.
//   C. Never removed mitigated OBs — stale OBs persisted indefinitely.
//
// CORRECT logic (matches LuxAlgo storeOrderBlock):
//   BULL OB — triggered on a bullish BOS/CHoCH (price crossed above swing high).
//     Window: from the swing LOW that preceded this BOS back to the BOS bar.
//     Selection: candle with the MINIMUM parsedLow in that window.
//     parsedLow = high-volatility bar (body ≥ 2×ATR) ? use candle.high : candle.low
//     This finds the deepest-reaching candle before the impulse — that is the OB.
//
//   BEAR OB — triggered on a bearish BOS/CHoCH (price crossed below swing low).
//     Window: from the swing HIGH that preceded this BOS back to the BOS bar.
//     Selection: candle with the MAXIMUM parsedHigh in that window.
//     parsedHigh = high-volatility bar ? use candle.low : candle.high
//
// FIX 5 — Mitigation:
//   Bull OB mitigated when: candle.low < ob.low  (price trades into the OB from above)
//   Bear OB mitigated when: candle.high > ob.high (price trades into the OB from below)
//   Matches LuxAlgo's HIGHLOW mitigation mode (default).
//   Mitigated OBs get { mitigated: true } and are filtered from renderOrderBlocks.
// ═══════════════════════════════════════════════════════════════

// FIX OB-A: accept an optional denseSwings parameter.
// swings      = 50-bar swing layer  → used for primary BOS-driven OB path
// denseSwings = 5-bar swing layer   → used ONLY in the fallback when no
//               structEvents exist, because 50-bar pivots are too sparse on
//               higher timeframes (weekly/daily) to find nearby OBs.
function findOrderBlocks(candles, swings, structEvents, denseSwings) {
  const n    = candles.length;
  const obs  = [];

  // ── ATR for volatility filter (200-bar like LuxAlgo) ─────────
  // Use calcATR from math.js (already loaded before chart.js).
  const atrArr = calcATR(candles, 200);
  const atr200 = atrArr[n - 1] || (candles[n-1].high - candles[n-1].low);

  // ── parsedHigh / parsedLow per candle ────────────────────────
  // High-volatility bar: (high - low) >= 2 × ATR200
  // On such bars LuxAlgo inverts: parsedHigh = low, parsedLow = high
  // This prevents a wide-ranging shock candle from being chosen as the OB.
  const parsedHigh = candles.map(c =>
    (c.high - c.low) >= 2 * atr200 ? c.low  : c.high);
  const parsedLow  = candles.map(c =>
    (c.high - c.low) >= 2 * atr200 ? c.high : c.low);

  // Primary path uses the coarse swing layer (50-bar) pivots.
  // Fallback path uses the dense layer (5-bar) when supplied.
  const { highs, lows } = swings;
  const denseHighs = (denseSwings && denseSwings.highs) || highs;
  const denseLows  = (denseSwings && denseSwings.lows)  || lows;

  // ── Gather BOS bar indices from structEvents ──────────────────
  // structEvents carry bosBarIdx (added in math.js Fix 2).
  // We only create OBs when a real structure break occurred,
  // keyed by direction so we know which swing to scan from.
  const bullBOSBars = []; // bar indices where bullish BOS/CHoCH fired
  const bearBOSBars = []; // bar indices where bearish BOS/CHoCH fired

  if (structEvents && structEvents.length > 0) {
    for (const ev of structEvents) {
      if (ev.dir === 'bull' && typeof ev.bosBarIdx === 'number')
        bullBOSBars.push({ bosIdx: ev.bosBarIdx, level: ev.level });
      if (ev.dir === 'bear' && typeof ev.bosBarIdx === 'number')
        bearBOSBars.push({ bosIdx: ev.bosBarIdx, level: ev.level });
    }
  }

  // ── BULL OBs — scan from nearest swing low to BOS bar ────────
  // For each bullish structure break, find the most recent swing
  // low that preceded it, then scan that window for the OB candle.
  for (const { bosIdx, level } of bullBOSBars) {
    // Find the swing low just before the BOS bar
    let pivotIdx = -1;
    for (let k = lows.length - 1; k >= 0; k--) {
      if (lows[k].idx < bosIdx) { pivotIdx = lows[k].idx; break; }
    }
    if (pivotIdx < 0) continue; // no prior swing low found
    if (bosIdx - pivotIdx < 1) continue; // window too small

    // Scan window [pivotIdx .. bosIdx-1] — find candle with min parsedLow
    let minPL = Infinity, obIdx = -1;
    for (let i = pivotIdx; i < bosIdx; i++) {
      if (parsedLow[i] < minPL) { minPL = parsedLow[i]; obIdx = i; }
    }
    if (obIdx < 0) continue;

    obs.push({
      type:      'bull',
      high:      candles[obIdx].high,
      low:       candles[obIdx].low,
      idx:       obIdx,
      mitigated: false,
    });
  }

  // ── BEAR OBs — scan from nearest swing high to BOS bar ───────
  for (const { bosIdx, level } of bearBOSBars) {
    // Find the swing high just before the BOS bar
    let pivotIdx = -1;
    for (let k = highs.length - 1; k >= 0; k--) {
      if (highs[k].idx < bosIdx) { pivotIdx = highs[k].idx; break; }
    }
    if (pivotIdx < 0) continue;
    if (bosIdx - pivotIdx < 1) continue;

    // Scan window [pivotIdx .. bosIdx-1] — find candle with max parsedHigh
    let maxPH = -Infinity, obIdx = -1;
    for (let i = pivotIdx; i < bosIdx; i++) {
      if (parsedHigh[i] > maxPH) { maxPH = parsedHigh[i]; obIdx = i; }
    }
    if (obIdx < 0) continue;

    obs.push({
      type:      'bear',
      high:      candles[obIdx].high,
      low:       candles[obIdx].low,
      idx:       obIdx,
      mitigated: false,
    });
  }

  // ── Fallback: if no structEvents produced OBs, use swing-proximity ─
  // Uses the dense (5-bar) swing layer so there are always enough pivots
  // even on higher timeframes (1D/1W) where 50-bar swings are too sparse.
  // Window widened to 20 bars (was 10) so weekly-candle OBs are reachable.
  if (obs.length === 0) {
    for (const sl of denseLows.slice(-4)) {
      const idx = sl.idx;
      if (idx < 3) continue;
      const winStart = Math.max(0, idx - 20);
      let minPL = Infinity, obIdx = -1;
      for (let i = winStart; i < idx; i++) {
        if (parsedLow[i] < minPL) { minPL = parsedLow[i]; obIdx = i; }
      }
      if (obIdx >= 0)
        obs.push({ type:'bull', high: candles[obIdx].high, low: candles[obIdx].low, idx: obIdx, mitigated: false });
    }
    for (const sh of denseHighs.slice(-4)) {
      const idx = sh.idx;
      if (idx < 3) continue;
      const winStart = Math.max(0, idx - 20);
      let maxPH = -Infinity, obIdx = -1;
      for (let i = winStart; i < idx; i++) {
        if (parsedHigh[i] > maxPH) { maxPH = parsedHigh[i]; obIdx = i; }
      }
      if (obIdx >= 0)
        obs.push({ type:'bear', high: candles[obIdx].high, low: candles[obIdx].low, idx: obIdx, mitigated: false });
    }
  }

  // ── FIX 5: MITIGATION — mark OBs that price has since traded through ──
  // Bull OB mitigated: any candle AFTER the OB has low < ob.low
  //   (price re-entered the block from above — block is consumed)
  // Bear OB mitigated: any candle AFTER the OB has high > ob.high
  //   (price re-entered the block from below — block is consumed)
  // Matches LuxAlgo HIGHLOW mitigation mode (default setting).
  for (const ob of obs) {
    for (let i = ob.idx + 1; i < n; i++) {
      if (ob.type === 'bull' && candles[i].low  < ob.low)  { ob.mitigated = true; break; }
      if (ob.type === 'bear' && candles[i].high > ob.high) { ob.mitigated = true; break; }
    }
  }

  // Deduplicate: remove OBs with the same idx (can arise from
  // multiple structEvents at overlapping windows).
  const seen = new Set();
  return obs.filter(ob => {
    const key = ob.type + ':' + ob.idx;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════
// LIQUIDITY ENGINE — INSTITUTIONAL SWEEP DETECTION
// ═══════════════════════════════════════════════════════════════
// FIX 6 — EQH/EQL detection: consecutive pivot pairs only + ATR tolerance
//
// OLD logic: all-pairs O(n²) comparison across every pivot combo.
//   This generated too many false equal-high pairs (e.g. a pivot
//   from 50 bars ago matching one from 2 bars ago is not EQH).
//
// CORRECT logic (matches LuxAlgo):
//   Compare only CONSECUTIVE pivot pairs: highs[i] vs highs[i+1].
//   Tolerance: threshold × ATR (default 0.1 in LuxAlgo).
//   ATR here uses a 200-bar period like LuxAlgo's atrMeasure.
//   Only adjacent pivots of the same type form an equal pair.
//   This produces tighter, more meaningful EQH/EQL levels.
// ═══════════════════════════════════════════════════════════════
function detectLiquidity(candles, highs, lows) {
  const n = candles.length;
  const currentPrice = candles[n-1].close;

  // FIX 6: ATR-based tolerance replaces flat price-percentage
  const atrArr = calcATR(candles, 200);
  const atr200 = atrArr[n - 1] || currentPrice * 0.003;
  const EQL_THRESHOLD = 0.1; // matches LuxAlgo equalHighsLowsThresholdInput default
  const tolerance = EQL_THRESHOLD * atr200;

  // FIX 6: consecutive pairs only — highs[i] vs highs[i+1]
  const equalHighPairs = [];
  const equalLowPairs  = [];

  for (let i = 0; i < highs.length - 1; i++) {
    const a = highs[i], b = highs[i + 1];
    if (Math.abs(a.price - b.price) < tolerance)
      equalHighPairs.push({
        price: (a.price + b.price) / 2,
        idxA:  a.idx,
        idxB:  b.idx,
      });
  }

  for (let i = 0; i < lows.length - 1; i++) {
    const a = lows[i], b = lows[i + 1];
    if (Math.abs(a.price - b.price) < tolerance)
      equalLowPairs.push({
        price: (a.price + b.price) / 2,
        idxA:  a.idx,
        idxB:  b.idx,
      });
  }

  const liquidityPresent = equalHighPairs.length > 0 || equalLowPairs.length > 0;

  // Sweep detection — unchanged in logic, now uses tighter EQH/EQL pairs
  const sweeps = [];
  for (const eqH of equalHighPairs) {
    for (let i = Math.max(eqH.idxB, n-30); i < n; i++) {
      const c = candles[i];
      if (c.high > eqH.price + tolerance && c.close < eqH.price) {
        sweeps.push({ type: 'high_sweep', price: eqH.price, idx: i, candle: c });
      }
    }
  }
  for (const eqL of equalLowPairs) {
    for (let i = Math.max(eqL.idxB, n-30); i < n; i++) {
      const c = candles[i];
      if (c.low < eqL.price - tolerance && c.close > eqL.price) {
        sweeps.push({ type: 'low_sweep', price: eqL.price, idx: i, candle: c });
      }
    }
  }
  const sweepDetected = sweeps.length > 0;

  // FIX 9 DL-A: use swing-layer struct (50-bar) for the validSetup check so that
  // sweepDetected is confirmed against major BOS/CHoCH, not noisy 5-bar internal swings.
  // The highs/lows passed in are the 5-bar layer (equal-high/low detection still needs
  // dense pivots), so we build the 50-bar layer here internally.
  const _dlSwings50 = findSwings(candles, 50);
  const _dlStruct50 = detectStructure(candles, _dlSwings50.highs, _dlSwings50.lows);
  const _dlStruct5  = detectStructure(candles, highs, lows);
  const struct = _dlStruct50.events.length > 0 ? _dlStruct50 : _dlStruct5;
  const validSetup = sweepDetected && (
    struct.recentBOS_up || struct.recentBOS_down ||
    struct.recentCHOCH_up || struct.recentCHOCH_down
  );

  let setupQuality = 0;
  if (liquidityPresent) setupQuality += 20;
  if (sweepDetected)    setupQuality += 40;
  if (validSetup)       setupQuality += 40;

  let reasonCode = 'NO_STRUCTURE';
  if (validSetup)                                  reasonCode = 'VALID_SETUP';
  else if (sweepDetected)                          reasonCode = 'SWEEP_NO_BOS';
  else if (liquidityPresent)                       reasonCode = 'INDUCEMENT_ONLY';
  else if (!struct.events || struct.events.length === 0) reasonCode = 'NO_STRUCTURE';
  else                                             reasonCode = 'STRUCTURE_NO_LIQUIDITY';

  return {
    equalHighPairs, equalLowPairs,
    sweeps, liquidityPresent, sweepDetected, validSetup,
    setupQuality, reasonCode,
    hasInducement: liquidityPresent,
  };
}

// ═══════════════════════════════════════════════════════════════
// ORDER BLOCK RENDERER
// FIX 5 cascade: filters mitigated OBs before rendering.
// Only active (non-mitigated) OBs are shown.
// ═══════════════════════════════════════════════════════════════
function renderOrderBlocks(obs, currentPrice) {
  const el = document.getElementById('ob-container');
  if (!el) return;

  // FIX 5: filter out mitigated blocks — never show consumed OBs
  const active = (obs || []).filter(ob => !ob.mitigated);

  if (active.length === 0) {
    el.innerHTML = '<div class="empty-state" style="height:50px;font-size:8px">NONE DETECTED</div>';
    return;
  }

  el.innerHTML = active.slice(-6).map(ob => {
    const dist = ((ob.high - currentPrice) / currentPrice * 100).toFixed(2);
    return `<div class="deriv-row">
      <span class="deriv-key">
        <span class="tag ${ob.type === 'bull' ? 'bull' : 'bear'}" style="margin-right:4px">${ob.type === 'bull' ? 'BULL OB' : 'BEAR OB'}</span>
        ${fmtPrice(ob.low)} – ${fmtPrice(ob.high)}
      </span>
      <span class="deriv-val ${parseFloat(dist) > 0 ? 'down' : 'up'}">${parseFloat(dist) > 0 ? '+' : ''}${dist}%</span>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// OI SPARKLINE RENDERER — unchanged
// ═══════════════════════════════════════════════════════════════
function renderOISparkline(items) {
  const wrap = document.getElementById('oi-spark');
  if (!wrap || !items || items.length < 2) return;
  wrap.innerHTML = '';
  const CONTAINER_H = 36;
  const vals = items.map(x => typeof x === 'object' ? (x.val || 0) : x);
  const maxV = Math.max(...vals);
  const minV = Math.min(...vals);
  const range = maxV - minV;
  const MIN_PX = 4;
  vals.forEach((v, i) => {
    const px = range > 0
      ? MIN_PX + ((v - minV) / range) * (CONTAINER_H - MIN_PX)
      : CONTAINER_H * 0.5;
    const bar = document.createElement('div');
    const dir = i > 0 ? (vals[i] >= vals[i-1] ? 'up' : 'down') : 'up';
    bar.className = 'oi-spark-bar ' + dir;
    bar.style.height = Math.round(px) + 'px';
    bar.title = fmtCompact(v);
    wrap.appendChild(bar);
  });
}
