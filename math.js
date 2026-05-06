// ═══════════════════════════════════════════════════════════════
// MATH — PURE CALCULATION FUNCTIONS (NO DOM, NO FETCH)
// ═══════════════════════════════════════════════════════════════

function calcATR(candles, period = 14) {
  const trs = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i-1];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  const atrs = [];
  let sum = trs.slice(0, period).reduce((a,b) => a+b, 0);
  atrs.push(sum / period);
  for (let i = period; i < trs.length; i++) {
    atrs.push((atrs[atrs.length-1] * (period-1) + trs[i]) / period);
  }
  while (atrs.length < candles.length) atrs.unshift(atrs[0]);
  return atrs;
}

function calcRSI(closes, period = 14) {
  const rsis = new Array(closes.length).fill(50);
  if (closes.length < period + 1) return rsis;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i-1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  rsis[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgG = (avgG * (period-1) + g) / period;
    avgL = (avgL * (period-1) + l) / period;
    rsis[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return rsis;
}

function calcER(closes, period = 20) {
  const n = closes.length;
  if (n < period) return 0.3;
  const direction = Math.abs(closes[n-1] - closes[n-1-period]);
  let volatility = 0;
  for (let i = n - period; i < n; i++) volatility += Math.abs(closes[i] - closes[i-1]);
  return volatility === 0 ? 0 : Math.min(1, direction / volatility);
}

function calcSuperTrend(candles, mult = 3.0, period = 14) {
  const n = candles.length;
  const atrs = calcATR(candles, period);
  const trend  = new Array(n).fill(1);
  const stLine = new Array(n).fill(0);
  let finalSupport = 0, finalResist = 0;

  for (let i = period; i < n; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const atr  = atrs[i];
    let support = hl2 - mult * atr;
    let resist  = hl2 + mult * atr;

    if (i > period) {
      if (candles[i-1].close >= finalSupport) support = Math.max(support, finalSupport);
      if (candles[i-1].close <= finalResist)  resist  = Math.min(resist,  finalResist);
    }
    finalSupport = support;
    finalResist  = resist;

    if (i === period) { trend[i] = 1; stLine[i] = finalSupport; continue; }

    if      (candles[i].close > finalResist)  { trend[i] =  1; stLine[i] = finalSupport; }
    else if (candles[i].close < finalSupport) { trend[i] = -1; stLine[i] = finalResist;  }
    else { trend[i] = trend[i-1]; stLine[i] = trend[i] === 1 ? finalSupport : finalResist; }
  }
  return { trend, stLine };
}

// ═══════════════════════════════════════════════════════════════
// FIX 1 — SWING DETECTION: strict > and < (not >= / <=)
// LuxAlgo uses high[size] > ta.highest(size) which is strict.
// Equal-price neighbours must NOT invalidate a pivot.
// Both sides checked symmetrically (conservative but correct).
// ═══════════════════════════════════════════════════════════════
function findSwings(candles, lookback = 5) {
  const n = candles.length;
  const highs = [], lows = [];
  for (let i = lookback; i < n - lookback; i++) {
    const high = candles[i].high;
    const low  = candles[i].low;
    let isHigh = true, isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      // FIX 1: was >= / <= — changed to strict > / <
      // Equal-price candles no longer disqualify a pivot,
      // matching LuxAlgo's behaviour for equal high/low pivots.
      if (candles[j].high > high) isHigh = false;
      if (candles[j].low  < low)  isLow  = false;
    }
    if (isHigh) highs.push({ idx: i, price: high, crossed: false });
    if (isLow)  lows.push({  idx: i, price: low,  crossed: false });
  }
  return { highs, lows };
}

// ═══════════════════════════════════════════════════════════════
// FIX 7 — FAIR VALUE GAPS: require middle candle close confirmation
// LuxAlgo condition: gap exists AND lastClose > last2High (bull)
// / lastClose < last2Low (bear). Filters insignificant gaps where
// the middle candle did not actually close through the gap edge.
// ═══════════════════════════════════════════════════════════════
function findFVGs(candles) {
  const fvgs = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i-1];
    const mid  = candles[i];      // the "impulse" candle — FIX 7 adds its close check
    const next = candles[i+1];

    // Bullish FVG: gap between candle[i-1].high and candle[i+1].low
    // FIX 7: mid.close must be > prev.high (middle candle closed above the gap bottom)
    if (next.low > prev.high && mid.close > prev.high) {
      fvgs.push({ type:'bull', top: next.low, bottom: prev.high, idx: i });
    }

    // Bearish FVG: gap between candle[i-1].low and candle[i+1].high
    // FIX 7: mid.close must be < prev.low (middle candle closed below the gap top)
    if (next.high < prev.low && mid.close < prev.low) {
      fvgs.push({ type:'bear', top: prev.low, bottom: next.high, idx: i });
    }
  }
  return fvgs.slice(-10).map(g => {
    let filled = false;
    for (let j = g.idx + 2; j < candles.length; j++) {
      if (g.type === 'bull' && candles[j].low  < g.bottom) { filled = true; break; }
      if (g.type === 'bear' && candles[j].high > g.top)    { filled = true; break; }
    }
    return { ...g, filled };
  });
}

function calcTQI(candles, erLen = 20, structLen = 20, momLen = 10) {
  const n = candles.length;
  if (n < Math.max(erLen, structLen, momLen) + 5) return 0.5;
  const closes = candles.map(c => c.close);
  const er = calcER(closes, erLen);
  const recentHigh = Math.max(...candles.slice(-structLen).map(c => c.high));
  const recentLow  = Math.min(...candles.slice(-structLen).map(c => c.low));
  const rng = recentHigh - recentLow;
  const pricePos = rng > 0 ? (closes[n-1] - recentLow) / rng : 0.5;
  const tqiStruct = Math.abs(pricePos - 0.5) * 2;
  const windowChange = closes[n-1] - closes[n-1-momLen];
  let aligned = 0;
  for (let i = n-momLen; i < n; i++) {
    const d = closes[i] - closes[i-1];
    if ((windowChange > 0 && d > 0) || (windowChange < 0 && d < 0)) aligned++;
  }
  const tqiMom = aligned / momLen;
  return Math.min(1, Math.max(0, 0.35 * er + 0.25 * tqiStruct + 0.4 * tqiMom));
}

function buildSRLevels(candles, highs, lows, currentPrice) {
  const tolerance = currentPrice * 0.005;
  const rawLevels = [];
  highs.forEach(h => rawLevels.push({ price: h.price, type: 'R', touches: 1 }));
  lows.forEach(l  => rawLevels.push({ price: l.price, type: 'S', touches: 1 }));
  const merged = [];
  rawLevels.sort((a,b) => a.price - b.price);
  for (const l of rawLevels) {
    const existing = merged.find(m => Math.abs(m.price - l.price) < tolerance);
    if (existing) { existing.touches++; existing.price = (existing.price + l.price) / 2; }
    else merged.push({ ...l });
  }
  return merged.map(m => ({
    ...m,
    dist: ((m.price - currentPrice) / currentPrice) * 100,
    zone: m.price > currentPrice * 1.01 ? 'resistance' : m.price < currentPrice * 0.99 ? 'support' : 'current'
  })).sort((a,b) => Math.abs(a.dist) - Math.abs(b.dist));
}

// ═══════════════════════════════════════════════════════════════
// FIX 2 + FIX 3 — STRUCTURE DETECTION: trend-state based BOS/CHoCH
// with single-fire crossed flag per pivot.
//
// OLD logic: compared lastSH.price vs prevSH.price (HH/LH).
// That is wrong — LuxAlgo classifies purely by TREND STATE:
//   close crosses above swing high while trend == BEARISH → CHoCH
//   close crosses above swing high while trend == BULLISH → BOS
//   close crosses below swing low  while trend == BULLISH → CHoCH
//   close crosses below swing low  while trend == BEARISH → BOS
//
// FIX 3 — crossed flag: once a pivot level fires a structure event
// it is marked crossed=true and will NOT fire again, matching
// LuxAlgo's p_ivot.crossed := true behaviour exactly.
//
// PERSISTENT STATE: structTrendState holds the last known swing
// trend between calls (BULLISH=1, BEARISH=-1, UNKNOWN=0).
// It is keyed per candle-array identity via a WeakMap so different
// symbols/TFs don't bleed into each other.
// ═══════════════════════════════════════════════════════════════

// WeakMap keyed by candle array reference — gives each symbol/TF
// its own isolated trend state without global variable pollution.
const _structStateMap = new WeakMap();

function _getStructState(candles) {
  if (!_structStateMap.has(candles)) {
    // First call for this candle array — initialise neutral state.
    // swingTrend: 0=unknown, 1=bullish, -1=bearish
    // pivotHighs/pivotLows: mirrors of findSwings output extended
    //   with per-pivot crossed flags stored by price+idx key.
    _structStateMap.set(candles, {
      swingTrend:    0,
      crossedHighs:  new Map(),  // key: idx → crossed bool
      crossedLows:   new Map(),
    });
  }
  return _structStateMap.get(candles);
}

function detectStructure(candles, highs, lows) {
  const n    = candles.length;
  const last = candles[n-1];

  const state = _getStructState(candles);

  const events         = [];
  let recentBOS_up     = false;
  let recentBOS_down   = false;
  let recentCHOCH_up   = false;
  let recentCHOCH_down = false;

  // How many bars back a structure level is still "recent"
  const RECENCY_BARS = 20;

  // ── BULLISH STRUCTURE: close crosses above a swing high ──────
  // Walk from newest swing high backward so we catch the most
  // recent unbroken level first (same priority as LuxAlgo).
  for (let k = highs.length - 1; k >= 0; k--) {
    const sh = highs[k];
    if ((n - 1 - sh.idx) > RECENCY_BARS) break; // too old, stop

    // FIX 3: already fired for this pivot → skip
    const crossedKey = sh.idx;
    if (state.crossedHighs.get(crossedKey)) continue;

    // FIX 3: crossover check — previous close must have been ≤ level
    // (mirrors ta.crossover: series[1] <= level and series[0] > level)
    const prevClose = n >= 2 ? candles[n-2].close : 0;
    if (last.close > sh.price && prevClose <= sh.price) {
      // FIX 2: classify by TREND STATE, not by HH/LH comparison
      const isCHoCH = state.swingTrend === -1; // bearish trend → first bull break = CHoCH
      const isBOS   = state.swingTrend ===  1; // bullish trend → continuation = BOS
      // unknown trend (0): treat as BOS since we have no prior context
      const tag = isCHoCH ? 'CHoCH' : 'BOS';

      if (isCHoCH) {
        recentCHOCH_up = true;
        events.push({ type:'CHoCH', dir:'bull', level: sh.price, label:'CHoCH ▲', bosBarIdx: n-1 });
      } else {
        recentBOS_up = true;
        events.push({ type:'BOS',   dir:'bull', level: sh.price, label:'BOS ▲',   bosBarIdx: n-1 });
      }

      // FIX 3: mark pivot consumed
      state.crossedHighs.set(crossedKey, true);
      // Update persistent trend state to BULLISH
      state.swingTrend = 1;
      break; // only fire the most recent uncrossed level per bar
    }
  }

  // ── BEARISH STRUCTURE: close crosses below a swing low ───────
  for (let k = lows.length - 1; k >= 0; k--) {
    const sl = lows[k];
    if ((n - 1 - sl.idx) > RECENCY_BARS) break;

    const crossedKey = sl.idx;
    if (state.crossedLows.get(crossedKey)) continue;

    const prevClose = n >= 2 ? candles[n-2].close : Infinity;
    if (last.close < sl.price && prevClose >= sl.price) {
      // FIX 2: classify by TREND STATE
      const isCHoCH = state.swingTrend === 1;  // bullish trend → first bear break = CHoCH
      const tag = isCHoCH ? 'CHoCH' : 'BOS';

      if (isCHoCH) {
        recentCHOCH_down = true;
        events.push({ type:'CHoCH', dir:'bear', level: sl.price, label:'CHoCH ▼', bosBarIdx: n-1 });
      } else {
        recentBOS_down = true;
        events.push({ type:'BOS',   dir:'bear', level: sl.price, label:'BOS ▼',   bosBarIdx: n-1 });
      }

      // FIX 3: mark pivot consumed
      state.crossedLows.set(crossedKey, true);
      // Update persistent trend state to BEARISH
      state.swingTrend = -1;
      break;
    }
  }

  // Expose current trend state for downstream use (Strong/Weak labels, chart)
  const currentSwingTrend = state.swingTrend; // 1=bull, -1=bear, 0=unknown

  return {
    events,
    recentBOS_up,
    recentBOS_down,
    recentCHOCH_up,
    recentCHOCH_down,
    swingTrend: currentSwingTrend, // NEW — used by chart.js for Strong/Weak labels (Fix 10)
  };
}

// ── STRUCT STATE RESET — call when switching symbol/TF ────────
// Clears the WeakMap entry so a fresh candle array starts clean.
// Called automatically by the fact we use candle-array identity
// as key — a new fetchBinanceCandles() call returns a new array
// reference so state resets naturally without explicit clearing.
// Exposed here for completeness / manual use.
function resetStructureState(candles) {
  if (_structStateMap.has(candles)) _structStateMap.delete(candles);
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT-AWARE DECISION ENGINE — MANDATORY 7-STEP PIPELINE
// ═══════════════════════════════════════════════════════════════

// ── STEP 1: BUILD CONTEXT ──────────────────────────────────────
function buildContext(candles, derivs) {
  const closes  = candles.map(c => c.close);
  const n       = candles.length;
  const price   = closes[n - 1];

  const atrArr  = calcATR(candles, 14);
  const atr     = atrArr[atrArr.length - 1] || price * 0.01;
  const er      = calcER(closes, 20);
  const tqi     = calcTQI(candles, 20, 20, 10);
  const stData  = calcSuperTrend(candles, 3.0, 14);
  const stTrend = stData.trend[n - 1] || 1;

  // FIX 1 cascades here automatically — findSwings now uses strict >/<
  // FIX 9: TWO SWING LAYERS — internal (5-bar) + swing (50-bar)
  // LuxAlgo runs getCurrentStructure(swingsLengthInput=50) for swing structure
  // and getCurrentStructure(5, internal=true) for internal structure separately.
  // Internal (5-bar): catches short-term BOS/CHoCH — used for entry timing, FVG matching
  // Swing (50-bar):   catches major structure breaks — used for bias, setup validation,
  //                   OB detection, scanner qualification
  const internalSwings = findSwings(candles, 5);   // internal — short-term pivots
  const swingSwings    = findSwings(candles, 50);  // swing — major pivots

  // Backward-compat alias: expose 5-bar swings as primary for chart/SR (denser pivots)
  const swings = internalSwings;

  // FIX 7 cascades here — findFVGs now filters insignificant gaps
  const fvgs    = findFVGs(candles);
  const { highs, lows } = internalSwings;
  // Swing-level highs/lows for S/R and premium/discount range
  const swingHighs = swingSwings.highs;
  const swingLows  = swingSwings.lows;
  const srLevels   = buildSRLevels(candles, highs, lows, price);

  // Premium/discount range uses SWING extremes (major highs/lows), not internal noise
  const swingLastSH = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1].price : price * 1.05;
  const swingLastSL = swingLows.length  > 0 ? swingLows[swingLows.length   - 1].price : price * 0.95;
  // Internal extremes for OB window tracking (kept for chart display)
  const lastSH = highs.length > 0 ? highs[highs.length - 1].price : swingLastSH;
  const lastSL = lows.length  > 0 ? lows[lows.length   - 1].price : swingLastSL;

  const swingRange = swingLastSH - swingLastSL;
  const swingPos   = swingRange > 0 ? (price - swingLastSL) / swingRange : 0.5;

  // FIX 9: detect structure on BOTH layers
  // Swing struct drives bias, BOS/CHoCH classification, setup validation
  // Internal struct drives entry timing display, FVG cross-check
  const swingStruct   = detectStructure(candles, swingHighs, swingLows);
  const internalStruct = detectStructure(candles, highs, lows);

  // Primary struct = swing layer (major breaks matter most)
  // If swing layer has no event, fall back to internal for signal continuity
  const struct = swingStruct.events.length > 0 ? swingStruct : internalStruct;
  const { recentBOS_up, recentBOS_down, recentCHOCH_up, recentCHOCH_down, events: structEvents } = struct;

  let bias = 'neutral';
  if (recentBOS_down)       bias = 'bearish';
  else if (recentBOS_up)    bias = 'bullish';
  else if (recentCHOCH_up)  bias = 'bullish_transition';
  else if (recentCHOCH_down)bias = 'bearish_transition';
  else if (stTrend ===  1)  bias = 'bullish';
  else if (stTrend === -1)  bias = 'bearish';

  // FIX 9: use SWING-layer pivots for trend sequence (HH/HL/LL/LH)
  // Internal 5-bar pivots are too noisy for trend classification
  let hhCount = 0, hlCount = 0, llCount = 0, lhCount = 0;
  for (let i = 1; i < Math.min(swingHighs.length, 4); i++) {
    if (swingHighs[i].price > swingHighs[i-1].price) hhCount++; else lhCount++;
  }
  for (let i = 1; i < Math.min(swingLows.length, 4); i++) {
    if (swingLows[i].price > swingLows[i-1].price) hlCount++; else llCount++;
  }
  const trendingUp   = hhCount >= 2 && hlCount >= 2;
  const trendingDown = llCount >= 2 && lhCount >= 2;
  const trendStrength = tqi > 0.65 ? 'strong' : tqi > 0.35 ? 'moderate' : 'weak';

  const atrFull = atrArr;
  const atrR10  = atrFull.slice(-10).filter(Boolean);
  const atrO30  = atrFull.slice(-30, -10).filter(Boolean);
  const avgR10  = atrR10.reduce((a,b) => a+b, 0) / Math.max(atrR10.length, 1);
  const avgO30  = atrO30.reduce((a,b) => a+b, 0) / Math.max(atrO30.length, 1);
  const comprRatio = avgO30 > 0 ? avgR10 / avgO30 : 1;
  const isCompressing = comprRatio < 0.80 || er < 0.30;
  const isExpanding = comprRatio > 1.25 || er > 0.55;

  const inPremium  = swingPos > 0.70;
  const inDiscount = swingPos < 0.30;

  let compressionScore = 0;
  if (comprRatio < 0.60)      compressionScore += 50;
  else if (comprRatio < 0.75) compressionScore += 35;
  else if (comprRatio < 0.85) compressionScore += 20;
  else if (comprRatio < 0.95) compressionScore += 8;
  if (er < 0.20)      compressionScore += 30;
  else if (er < 0.30) compressionScore += 20;
  else if (er < 0.40) compressionScore += 10;
  const rec10 = candles.slice(-10), pri20 = candles.slice(-30, -10);
  const r10Rng = Math.max(...rec10.map(c=>c.high)) - Math.min(...rec10.map(c=>c.low));
  const p20Rng = Math.max(...pri20.map(c=>c.high)) - Math.min(...pri20.map(c=>c.low));
  if (p20Rng > 0 && r10Rng / p20Rng < 0.5) compressionScore += 20;
  compressionScore = Math.min(100, compressionScore);

  const funding  = derivs ? (derivs.funding  || 0) : 0;
  const lsRatio  = derivs ? (derivs.lsRatio  || 1) : 1;

  const liqData = detectLiquidity(candles, highs, lows);
  const { equalHighPairs, equalLowPairs, sweepDetected, validSetup: liqValidSetup, reasonCode } = liqData;

  const nearFVG = fvgs.filter(g => !g.filled &&
    Math.abs((g.top + g.bottom) / 2 - price) / price < 0.03);
  const nearLevels = srLevels.filter(l => Math.abs(l.dist) < 2.0);

  const last5  = closes.slice(-5);
  const mean5  = last5.reduce((a,b) => a+b, 0) / 5;
  const isBull = bias === 'bullish' || bias === 'bullish_transition';
  const isBear = bias === 'bearish' || bias === 'bearish_transition';
  const pullingBack = isBull
    ? (last5[0] > mean5 && last5[4] < mean5)
    : (last5[0] < mean5 && last5[4] > mean5);
  const hasFreshPullback = pullingBack;

  let marketState   = 'RANGE';
  let transitionType = 'neutral';
  const atrExpanding = avgR10 > avgO30 * 1.2;
  const hasBOSCtx    = recentBOS_up || recentBOS_down || recentCHOCH_up || recentCHOCH_down;

  if (atrExpanding && (trendingUp || trendingDown)) {
    marketState    = 'EXPANSION';
    transitionType = trendingUp ? 'bullish_continuation' : 'bearish_continuation';
  } else if (trendingUp || trendingDown) {
    if (er > 0.4 || tqi > 0.55) {
      marketState    = 'TREND';
      transitionType = trendingUp ? 'bullish_continuation' : 'bearish_continuation';
    }
  }
  if (marketState === 'RANGE' || (hasBOSCtx && marketState !== 'EXPANSION')) {
    if      (recentBOS_down)   { marketState = 'TRANSITION'; transitionType = 'bearish_continuation'; }
    else if (recentBOS_up)     { marketState = 'TRANSITION'; transitionType = 'bullish_continuation'; }
    else if (recentCHOCH_up)   { marketState = 'TRANSITION'; transitionType = 'bullish_reversal';    }
    else if (recentCHOCH_down) { marketState = 'TRANSITION'; transitionType = 'bearish_reversal';    }
    else if ((trendingUp && llCount > 0) || (trendingDown && hhCount > 0)) {
      marketState    = 'TRANSITION';
      transitionType = trendingUp ? 'bearish_continuation' : 'bullish_continuation';
    }
  }

  return {
    price, closes, n, atr, er, tqi, stTrend, stData,
    highs, lows, swings, fvgs, srLevels, struct, structEvents,
    // FIX 9: expose both swing layers for consumers
    internalSwings, swingSwings,
    swingHighs, swingLows,
    swingStruct, internalStruct,
    bias, isBull, isBear,
    lastSH, lastSL, swingRange, swingPos,
    trendingUp, trendingDown, trendStrength,
    hhCount, hlCount, llCount, lhCount,
    isCompressing, isExpanding, comprRatio, compressionScore,
    inPremium, inDiscount,
    nearFVG, nearLevels,
    hasFreshPullback,
    funding, lsRatio,
    liqData, equalHighPairs, equalLowPairs,
    sweepDetected, liqValidSetup, reasonCode,
    recentBOS_up, recentBOS_down, recentCHOCH_up, recentCHOCH_down,
    marketState, transitionType,
  };
}

// ── STEP 2: DETECT STRUCTURE TYPE ─────────────────────────────
function detectStructureType(ctx) {
  const { isExpanding, isCompressing, trendingUp, trendingDown, er, tqi,
    recentBOS_up, recentBOS_down, recentCHOCH_up, recentCHOCH_down } = ctx;

  const hasBOS  = recentBOS_up || recentBOS_down;
  const hasCHoCH= recentCHOCH_up || recentCHOCH_down;

  if (trendingUp && (er > 0.35 || tqi > 0.45 || isExpanding)) {
    return { type: 'trend_up', valid: true,
      detail: isExpanding ? 'Expansion — ATR expanding into bullish trend' : 'Bullish HH/HL sequence' };
  }
  if (trendingDown && (er > 0.35 || tqi > 0.45 || isExpanding)) {
    return { type: 'trend_down', valid: true,
      detail: isExpanding ? 'Expansion — ATR expanding into bearish trend' : 'Bearish LL/LH sequence' };
  }

  if (hasBOS || hasCHoCH) {
    return { type: 'transition', valid: true,
      detail: hasBOS ? 'BOS present — structure shifting' : 'CHoCH — potential reversal forming' };
  }

  if (isCompressing && !trendingUp && !trendingDown) {
    return { type: 'range', valid: true,
      detail: 'Compression — price coiling, breakout pending' };
  }

  if (er < 0.18 && tqi < 0.30) {
    return { type: 'choppy', valid: false,
      detail: 'Dead market — ER and TQI both critically low, no tradeable edge' };
  }

  return { type: 'unknown', valid: false, detail: 'No clear structure — mixed signals' };
}

// ── STEP 3: DETECT SETUP ──────────────────────────────────────
function detectSetup(ctx, structureType) {
  if (!structureType.valid) return { type: 'none', direction: 'none', valid: false, detail: 'No structure' };

  const { isCompressing, isExpanding, recentCHOCH_up, recentCHOCH_down,
    recentBOS_up, recentBOS_down, compressionScore, isBull, isBear } = ctx;

  const st = structureType.type;
  const direction = st === 'trend_up' ? 'long' : st === 'trend_down' ? 'short' : 'neutral';

  if ((st === 'trend_up' || st === 'trend_down') && isCompressing) {
    return { type: 'continuation', direction, valid: true,
      detail: 'Trend with compression — continuation setup forming' };
  }

  if ((st === 'trend_up' || st === 'trend_down') && compressionScore > 35) {
    return { type: 'continuation', direction, valid: true,
      detail: 'Trend continuation — moderate compression present' };
  }

  if (st === 'trend_up' || st === 'trend_down') {
    return { type: 'none', direction: 'none', valid: false,
      detail: 'Trend without compression — no clean entry confluence' };
  }

  if (st === 'range' && isExpanding) {
    const brkDir = isBull ? 'long' : isBear ? 'short' : 'neutral';
    return { type: 'breakout', direction: brkDir, valid: true,
      detail: 'Range with expanding ATR — breakout setup' };
  }

  if (st === 'range' && compressionScore > 55) {
    const brkDir = isBull ? 'long' : isBear ? 'short' : 'neutral';
    return { type: 'breakout', direction: brkDir, valid: true,
      detail: 'High compression in range — imminent breakout potential' };
  }

  if (st === 'transition' && (recentCHOCH_up || recentCHOCH_down)) {
    const revDir = recentCHOCH_up ? 'long' : 'short';
    return { type: 'reversal', direction: revDir, valid: true,
      detail: 'CHoCH confirmed — reversal setup active' };
  }

  if (st === 'transition' && (recentBOS_up || recentBOS_down)) {
    const bosDir = recentBOS_up ? 'long' : 'short';
    return { type: 'continuation', direction: bosDir, valid: true,
      detail: 'BOS in transition — direction shift, continuation bias' };
  }

  return { type: 'none', direction: 'none', valid: false, detail: 'No clean setup pattern — insufficient confluence' };
}

// ── STEP 4: VALIDATE SETUP ────────────────────────────────────
function validateSetup(ctx, structureType, setup) {
  if (!structureType.valid)
    return { valid: false, reason: 'INVALID_STRUCTURE' };
  if (!setup.valid)
    return { valid: false, reason: 'NO_CLEAN_SETUP' };

  const { bias, isBull, isBear, stTrend, recentBOS_up, recentBOS_down,
    inPremium, inDiscount, er, compressionScore, swingPos,
    isExpanding, hasFreshPullback, trendStrength, trendingUp, trendingDown } = ctx;

  if (structureType.type === 'trend_down' && setup.direction === 'long')
    return { valid: false, reason: 'CONTRA_TREND_LONG_IN_DOWNTREND' };
  if (structureType.type === 'trend_up' && setup.direction === 'short')
    return { valid: false, reason: 'CONTRA_TREND_SHORT_IN_UPTREND' };

  if (isBull && recentBOS_down)
    return { valid: false, reason: 'BULL_BIAS_BEAR_BOS' };
  if (isBull && stTrend === -1 && trendingDown)
    return { valid: false, reason: 'BULL_BIAS_BEAR_TREND' };
  if (isBear && recentBOS_up)
    return { valid: false, reason: 'BEAR_BIAS_BULL_BOS' };
  if (isBear && stTrend === 1 && trendingUp)
    return { valid: false, reason: 'BEAR_BIAS_BULL_TREND' };

  if (trendStrength === 'weak' && setup.type === 'continuation')
    return { valid: false, reason: 'WEAK_TREND_NO_CONTINUATION' };

  if (er < 0.10)
    return { valid: false, reason: 'NO_VOLATILITY' };
  if (er < 0.15 && compressionScore < 10)
    return { valid: false, reason: 'DEAD_MARKET' };

  if (isBull && inPremium && !hasFreshPullback && setup.type !== 'reversal' && setup.type !== 'breakout')
    return { valid: false, reason: 'BULL_IN_PREMIUM_NO_PULLBACK' };
  if (isBear && inDiscount && !hasFreshPullback && setup.type !== 'reversal' && setup.type !== 'breakout')
    return { valid: false, reason: 'BEAR_IN_DISCOUNT_NO_PULLBACK' };

  if (isExpanding && isBull && stTrend === -1 && swingPos > 0.70)
    return { valid: false, reason: 'LATE_BULL_IN_BEAR_EXPANSION' };
  if (isExpanding && isBear && stTrend === 1 && swingPos < 0.30)
    return { valid: false, reason: 'LATE_BEAR_IN_BULL_EXPANSION' };

  return { valid: true, reason: 'SETUP_VALID' };
}

// ── STEP 5: CALCULATE ENTRY QUALITY ───────────────────────────
function calculateEntryQuality(ctx) {
  const { swingPos, isBull, isBear, hasFreshPullback } = ctx;
  const pos = Math.max(0, Math.min(1, swingPos));

  let quality, zone;

  if (isBull) {
    if (pos < 0.40)      { quality = 'EARLY'; zone = 'discount'; }
    else if (pos > 0.75) { quality = 'LATE';  zone = 'premium'; }
    else                 { quality = 'MID';   zone = 'equilibrium'; }
  } else if (isBear) {
    if (pos > 0.60)      { quality = 'EARLY'; zone = 'premium'; }
    else if (pos < 0.25) { quality = 'LATE';  zone = 'discount'; }
    else                 { quality = 'MID';   zone = 'equilibrium'; }
  } else {
    if (pos < 0.25 || pos > 0.75) { quality = 'EARLY';   zone = 'extreme';    }
    else if (pos > 0.35 && pos < 0.65) { quality = 'NEUTRAL'; zone = 'dead-centre'; }
    else                               { quality = 'MID';     zone = 'near-extreme'; }
  }

  let multiplier;
  if      (quality === 'EARLY')   multiplier = hasFreshPullback ? 1.15 * 1.05 : 1.15;
  else if (quality === 'LATE')    multiplier = 0.50;
  else if (quality === 'NEUTRAL') multiplier = 0.75;
  else                            multiplier = 1.0;

  return { quality, zone, pos, multiplier };
}

// ── STEP 6: CALCULATE SCORE ───────────────────────────────────
function calculateScore(ctx, structureType, setup, entryQuality, validation) {
  if (!validation.valid) return 0;

  const { isBull, isBear, stTrend, tqi, er,
    nearLevels, nearFVG, structEvents, compressionScore,
    sweepDetected, liqValidSetup, equalHighPairs, equalLowPairs,
    fvgs, funding, lsRatio, isExpanding } = ctx;

  let structScore = 0;
  structScore += Math.min(nearLevels.length * 12, 36);
  const pct = Math.max(0, Math.min(1, ctx.swingPos));
  const atEdge = (isBull && pct < 0.35) || (isBear && pct > 0.65) ||
    (!isBull && !isBear && (pct < 0.25 || pct > 0.75));
  if (atEdge) structScore += 25;
  else if (pct < 0.40 || pct > 0.60) structScore += 10;
  if (structEvents.length > 0) structScore += 20;
  if (nearFVG.length > 0) structScore += 15;
  structScore = Math.min(100, structScore);

  let trendScore = 0;
  trendScore += Math.round(tqi * 60);
  if (er > 0.50)      trendScore += 25;
  else if (er > 0.35) trendScore += 12;
  const stLine = ctx.stData.stLine[ctx.n - 1];
  if (stTrend ===  1 && ctx.price > stLine) trendScore += 15;
  else if (stTrend === -1 && ctx.price < stLine) trendScore += 15;
  trendScore = Math.min(100, trendScore);

  let liqScore = 0;
  const eqHighs = equalHighPairs.length;
  const eqLows  = equalLowPairs.length;
  if (isBull) { liqScore += Math.min(eqHighs*15,30); liqScore += Math.min(eqLows*8,16); }
  else if (isBear) { liqScore += Math.min(eqLows*15,30); liqScore += Math.min(eqHighs*8,16); }
  else { liqScore += Math.min((eqHighs+eqLows)*10,30); }
  if (sweepDetected)   liqScore += 30;
  if (liqValidSetup)   liqScore += 24;
  liqScore += Math.min(fvgs.filter(g=>!g.filled).length * 8, 16);
  liqScore = Math.min(100, liqScore);

  let base = 0.45 * structScore + 0.25 * compressionScore + 0.25 * trendScore + 0.05 * liqScore;

  const setupIsBull = stTrend === 1;
  if ((isBull && !setupIsBull) || (isBear && setupIsBull)) base *= 0.60;
  else if ((isBull && setupIsBull) || (isBear && !setupIsBull)) base *= 1.10;

  if (setup.type === 'continuation') base *= 1.05;
  if (setup.type === 'breakout')     base *= 1.08;
  if (setup.type === 'reversal')     base *= 0.95;

  if (isExpanding) base *= 0.75;
  base *= entryQuality.multiplier;

  let derivImpact = 0;
  const hasRealStructConfirmation = structEvents.length > 0 || liqValidSetup;
  if (hasRealStructConfirmation) {
    let derivAligned = 0, derivOpposing = 0;
    if (isBull) {
      if (funding < -0.01) derivAligned++;  else if (funding > 0.05) derivOpposing++;
      if (lsRatio < 0.85)  derivAligned++;  else if (lsRatio > 1.30) derivOpposing++;
    } else if (isBear) {
      if (funding > 0.03)  derivAligned++;  else if (funding < -0.02) derivOpposing++;
      if (lsRatio > 1.30)  derivAligned++;  else if (lsRatio < 0.85)  derivOpposing++;
    }
    if (Math.abs(funding) > 0.10) derivAligned++;
    const dt = derivAligned + derivOpposing || 1;
    const dn = (derivAligned - derivOpposing) / dt;
    derivImpact = dn > 0.3 ? base * 0.08 : dn < -0.3 ? -base * 0.08 : 0;
  }

  const finalScore = Math.min(100, Math.max(0, Math.round(base + derivImpact)));
  return {
    score: finalScore,
    structScore:      Math.round(structScore),
    trendScore:       Math.round(trendScore),
    compressionScore: Math.round(compressionScore),
    liqScore:         Math.round(liqScore),
  };
}

// ── STEP 7: BUILD OUTPUT ──────────────────────────────────────
function buildOutput(ctx, structureType, setup, entryQuality, validation, score, scoreResult) {
  const _structScore      = scoreResult ? scoreResult.structScore      : 0;
  const _trendScore       = scoreResult ? scoreResult.trendScore       : 0;
  const _compressionScore = scoreResult ? scoreResult.compressionScore : 0;
  const _liqScore         = scoreResult ? scoreResult.liqScore         : 0;
  const { bias, isBull, isBear, swingPos, structEvents, compressionScore,
    nearFVG, equalHighPairs, equalLowPairs, sweepDetected, liqValidSetup,
    er, tqi, funding, lsRatio, price, isExpanding, isCompressing,
    nearLevels, fvgs, stTrend, hasFreshPullback, reasonCode } = ctx;

  const distPct = Math.round(swingPos * 100);

  let tier, tierColor;
  if (score >= 80)      { tier = 'HIGH_PRIORITY'; tierColor = 'var(--green)'; }
  else if (score >= 65) { tier = 'WATCHLIST';     tierColor = 'var(--gold)'; }
  else                  { tier = 'IGNORE';         tierColor = 'var(--muted)'; }

  let classification = 'WATCH LIST', classType = 'neutral';
  if (setup.type === 'breakout')     { classification = 'BREAKOUT BUILDUP';  classType = 'breakout'; }
  if (setup.type === 'continuation') { classification = 'TREND CONTINUATION'; classType = 'trend'; }
  if (setup.type === 'reversal')     { classification = 'REVERSAL SETUP';    classType = 'squeeze'; }
  const derivExtreme = Math.abs(funding) > 0.08 || lsRatio > 1.5 || lsRatio < 0.65;
  if (derivExtreme) {
    const dba = isBull && (lsRatio < 0.7 || funding < -0.05);
    const dbb = isBear && (lsRatio > 1.5 || funding > 0.08);
    if (dba || dbb) { classification = 'SQUEEZE SETUP'; classType = 'squeeze'; }
  }

  const prevStructTxt = structEvents.length > 0
    ? structEvents[0].label + ' at ' + fmtPrice(structEvents[0].level)
    : (ctx.recentCHOCH_up ? 'CHoCH up' : ctx.recentCHOCH_down ? 'CHoCH down' : 'no recent structure break');

  const qualityTxt = entryQuality.quality === 'EARLY'
    ? (hasFreshPullback ? `early-stage discount with active pullback (${distPct}% of swing)` : `early-stage entry in ${entryQuality.zone} (${distPct}% of swing)`)
    : `mid-range position at ${distPct}% of swing`;

  const conditionTxt = isCompressing ? 'compressing near ' + (isBull ? 'support' : isBear ? 'resistance' : 'key level')
    : isExpanding ? 'expanding with momentum'
    : 'consolidating';

  let expectedTxt;
  if (setup.type === 'continuation') {
    expectedTxt = isBull
      ? (compressionScore > 50 ? 'Compression into trend suggests high-probability continuation long.' : 'Bias remains bullish — continuation long favoured on pullback.')
      : (compressionScore > 50 ? 'Compression into bearish trend — continuation short setup.' : 'Bearish bias maintained — continuation short on relief rally.');
  } else if (setup.type === 'breakout') {
    expectedTxt = 'Range coiling — directional breakout expected. Volatility expansion imminent.';
  } else if (setup.type === 'reversal') {
    expectedTxt = ctx.recentCHOCH_up
      ? 'CHoCH to upside — prior bearish structure may flip. Wait for higher high confirmation.'
      : 'CHoCH to downside — prior bullish structure challenged. Lower low confirmation needed.';
  } else {
    expectedTxt = 'No clear directional edge — wait for structure confirmation.';
  }

  const fundTxt = Math.abs(funding) > 0.01
    ? ` Funding ${funding > 0 ? '+' : ''}${funding.toFixed(3)}% (${funding > 0 ? 'longs overextended' : 'shorts overextended'}).`
    : '';
  const explanation = `After ${prevStructTxt}, price is ${conditionTxt} with ${qualityTxt}. ${expectedTxt}${fundTxt}`.trim().replace(/\s+/g, ' ');

  const tags = [];
  tags.push({ label: isBull ? 'BULL BIAS' : isBear ? 'BEAR BIAS' : 'NEUTRAL', type: isBull ? 'bias-bull' : isBear ? 'bias-bear' : 'neutral' });
  tags.push({ label: entryQuality.quality === 'EARLY' ? (hasFreshPullback ? 'EARLY + PB' : 'EARLY ENTRY') : 'MID RANGE', type: entryQuality.quality === 'EARLY' ? 'trend' : 'neutral' });
  tags.push({ label: setup.type.toUpperCase(), type: setup.type === 'breakout' ? 'breakout' : setup.type === 'continuation' ? 'trend' : 'squeeze' });
  if (compressionScore > 55) tags.push({ label: 'HIGH COMPRESSION', type: 'compression' });
  if (nearFVG.length > 0) tags.push({ label: nearFVG.length + ' FVG', type: 'liquidity' });
  if (sweepDetected) tags.push({ label: 'LIQ SWEEP', type: 'liquidity' });
  if (equalHighPairs.length > 0) tags.push({ label: 'EQ HIGHS', type: 'liquidity' });
  if (equalLowPairs.length > 0)  tags.push({ label: 'EQ LOWS',  type: 'liquidity' });
  if (structEvents.length > 0) tags.push({ label: structEvents[0].label, type: 'structure' });
  if (nearLevels.length >= 2) tags.push({ label: 'KEY LEVEL', type: 'structure' });
  if (funding < -0.05) tags.push({ label: 'SHORTS PAYING', type: 'squeeze' });
  if (funding > 0.05)  tags.push({ label: 'LONGS PAYING',  type: 'squeeze' });
  if (lsRatio > 1.4) tags.push({ label: 'LONGS CROWDED', type: 'squeeze' });
  if (lsRatio < 0.7) tags.push({ label: 'SHORTS CROWDED', type: 'squeeze' });
  if (tqi > 0.65) tags.push({ label: 'HIGH TQI', type: 'trend' });
  if (er > 0.50)  tags.push({ label: 'HIGH ER',  type: 'trend' });

  const { marketState, transitionType } = ctx;

  return {
    score, tier, tierColor,
    classification, classType,
    bias, marketState, transitionType,
    entryQuality: entryQuality.quality,
    swingDistance: swingPos,
    tags: tags.slice(0, 7),
    explanation,
    er, tqi, compressionScore,
    structScore: _structScore,
    liquidityScore: _liqScore,
    trendScore: _trendScore,
    compressionScoreBreakdown: _compressionScore,
    funding, lsRatio, stTrend,
    eqHighs: equalHighPairs.length,
    eqLows: equalLowPairs.length,
    reasonCode, validSetup: liqValidSetup,
    sweepDetected,
    liquidityPresent: ctx.liqData.liquidityPresent,
    decisionValid: true,
    decisionReason: 'SETUP_VALID',
    decisionPenalty: 1.0,
    structureType: structureType.type,
    setupType: setup.type,
    setupDetail: setup.detail,
  };
}

// ── CENTRAL ANALYSIS FUNCTION ─────────────────────────────────
function analyzeCoin(candles, derivs) {
  analyzeCoin._lastRejectReason = null;

  const ctx = buildContext(candles, derivs);
  const structure = detectStructureType(ctx);
  const setup = detectSetup(ctx, structure);
  const decision = validateSetup(ctx, structure, setup);
  if (!decision.valid) {
    analyzeCoin._lastRejectReason = decision.reason;
    return null;
  }

  const entryQuality = calculateEntryQuality(ctx);
  const scoreResult = calculateScore(ctx, structure, setup, entryQuality, decision);
  const score = scoreResult.score;

  if (score < 65) {
    analyzeCoin._lastRejectReason = 'SCORE_BELOW_THRESHOLD';
    return null;
  }

  return buildOutput(ctx, structure, setup, entryQuality, decision, score, scoreResult);
}
analyzeCoin._lastRejectReason = null;
