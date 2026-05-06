'use strict';
// ═══════════════════════════════════════════════════════════════
// BTC PAIR SCANNER
// Scans all coin/BTC spot pairs on Binance for SMC structure
// Genuine outperformance = coin rising in BTC terms, not just
// riding a BTC pump. Pure structure scanner — no derivatives
// (funding/OI/L/S don't exist for BTC pairs)
//
// Also provides: checkBTCConfirmation() — used by SMC scanner
// and MIT SCAN as an optional secondary layer
// ═══════════════════════════════════════════════════════════════

let _btcScanRunning = false;
let _btcScanAbort   = false;
let _btcSim         = null;

// ─────────────────────────────────────────────────────────────
// FETCH ALL BTC-QUOTED SPOT PAIRS
// ─────────────────────────────────────────────────────────────
async function fetchAllBTCPairs() {
  const r = await fetchWithTimeout(`${CFG.BINANCE_SPOT}/exchangeInfo`);
  if (!r.ok) throw new Error('Cannot reach Binance spot exchangeInfo');
  const d = await r.json();
  return d.symbols.filter(s =>
    s.quoteAsset === 'BTC' &&
    s.status === 'TRADING' &&
    s.isSpotTradingAllowed
  ).map(s => s.baseAsset);
}

// ─────────────────────────────────────────────────────────────
// FETCH BTC PAIR CANDLES
// Uses Binance Spot klines endpoint with <symbol>BTC pair
// ─────────────────────────────────────────────────────────────
async function fetchBTCPairCandles(symbol, tf, limit = 150) {
  const tfMap = {'5m':'5m','15m':'15m','1h':'1h','4h':'4h','1d':'1d','1w':'1w'};
  const interval = tfMap[tf] || '1h';
  const url = `${CFG.BINANCE_SPOT}/klines?symbol=${symbol}BTC&interval=${interval}&limit=${limit}`;
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw new Error('No BTC pair for ' + symbol);
  const d = await r.json();
  if (!Array.isArray(d) || d.length < 10) throw new Error('Insufficient data');
  return d.map(k => ({
    time:+k[0], open:+k[1], high:+k[2], low:+k[3], close:+k[4], vol:+k[5]
  }));
}

// ─────────────────────────────────────────────────────────────
// BTC CONFIRMATION CHECK
// Called by SMC scanner and MIT SCAN when toggle is ON
// Returns: { btcConfirmed, btcRoc, btcReason, convictionDelta }
// ─────────────────────────────────────────────────────────────
async function checkBTCConfirmation(symbol, tf, isBull) {
  try {
    const candles = await fetchBTCPairCandles(symbol, tf, 10);
    if (!candles || candles.length < 6)
      return { btcConfirmed: null, btcRoc: 0, btcReason: 'BTC pair data unavailable', convictionDelta: 0 };

    const n      = candles.length;
    const roc5   = (candles[n-1].close - candles[n-6].close) / candles[n-6].close * 100;
    const roc3   = (candles[n-1].close - candles[n-4].close) / candles[n-4].close * 100;

    // For LONG: coin must be rising in BTC terms
    // For SHORT: coin must be falling in BTC terms
    let btcConfirmed, btcReason, convictionDelta;

    if (isBull) {
      if (roc5 > 1.0) {
        btcConfirmed   = true;
        convictionDelta = roc5 > 3.0 ? 12 : 7;
        btcReason = `Rising +${roc5.toFixed(2)}% in BTC terms — genuine outperformance, not a BTC pump ride`;
      } else if (roc5 > 0) {
        btcConfirmed   = true;
        convictionDelta = 3;
        btcReason = `Slightly positive in BTC terms (+${roc5.toFixed(2)}%) — mild outperformance`;
      } else {
        btcConfirmed   = false;
        convictionDelta = roc5 < -2.0 ? -12 : -6;
        btcReason = `Losing ${Math.abs(roc5).toFixed(2)}% in BTC terms — just riding the BTC pump, not genuine strength`;
      }
    } else {
      // SHORT: we want coin to be falling in BTC terms
      if (roc5 < -1.0) {
        btcConfirmed   = true;
        convictionDelta = Math.abs(roc5) > 3.0 ? 12 : 7;
        btcReason = `Falling ${Math.abs(roc5).toFixed(2)}% in BTC terms — genuine relative weakness confirmed`;
      } else if (roc5 < 0) {
        btcConfirmed   = true;
        convictionDelta = 3;
        btcReason = `Slightly weak in BTC terms (${roc5.toFixed(2)}%) — mild underperformance vs BTC`;
      } else {
        btcConfirmed   = false;
        convictionDelta = roc5 > 2.0 ? -12 : -6;
        btcReason = `Rising in BTC terms (+${roc5.toFixed(2)}%) — coin showing strength, short setup weakened`;
      }
    }

    return { btcConfirmed, btcRoc: roc5, btcRoc3: roc3, btcReason, convictionDelta };
  } catch(e) {
    return { btcConfirmed: null, btcRoc: 0, btcReason: 'BTC pair not available for this coin', convictionDelta: 0 };
  }
}

// ─────────────────────────────────────────────────────────────
// RUN SMC STRUCTURE CHECK ON ONE BTC PAIR
// No derivatives (funding/OI/L/S not available for spot pairs)
// Uses existing math.js functions
// ─────────────────────────────────────────────────────────────
async function runBTCPairCheck(symbol, tf) {
  let candles;
  try {
    candles = await fetchBTCPairCandles(symbol, tf, 150);
  } catch(e) { return null; }
  if (!candles || candles.length < 30) return null;

  const n     = candles.length;
  const price = candles[n-1].close;
  const swings = findSwings(candles, 5);
  const { highs, lows } = swings;
  // FIX 9: swing-level structure (50-bar) for major BOS/CHoCH
  const swingSwings = findSwings(candles, 50);
  const swingStruct = detectStructure(candles, swingSwings.highs, swingSwings.lows);
  const struct      = swingStruct.events.length > 0 ? swingStruct : detectStructure(candles, highs, lows);

  // Zone
  const lastSH   = highs.length > 0 ? highs[highs.length-1].price : price*1.05;
  const lastSL   = lows.length  > 0 ? lows[lows.length-1].price   : price*0.95;
  const rng      = Math.max(lastSH,price) - Math.min(lastSL,price) || price*0.05;
  const premium  = Math.max(lastSH,price) - rng*0.25;
  const discount = Math.min(lastSL,price) + rng*0.25;
  const inPremium  = price > premium;
  const inDiscount = price < discount;

  // FVG
  const fvgs      = typeof findFVGs==='function' ? findFVGs(candles) : [];
  const freshFVGs = fvgs.filter(g=>!g.filled).slice(-3);
  const fvgInDiscount = freshFVGs.some(g=>g.type==='bull'&&g.bottom<discount+rng*0.1);
  const fvgInPremium  = freshFVGs.some(g=>g.type==='bear'&&g.top>premium-rng*0.1);

  // RSI
  const rsiArr = calcRSI(candles.map(c=>c.close), 14);
  const rsi    = rsiArr[rsiArr.length-1] || 50;

  // TQI
  const tqi = calcTQI(candles, 20, 20, 10);

  // Volume acceleration (free — using already fetched candles)
  const volAccel = detectVolumeAcceleration(candles);
  const liqVoid  = detectLiquidityVoid(candles);

  // Bias vote
  const bullSig = (struct.recentBOS_up?2:0)+(struct.recentCHOCH_up?1:0)+(inDiscount?1:0)+(fvgInDiscount?2:0);
  const bearSig = (struct.recentBOS_down?2:0)+(struct.recentCHOCH_down?1:0)+(inPremium?1:0)+(fvgInPremium?2:0);
  const isBull  = bullSig >= bearSig;

  const hasDirBOS  = isBull?(struct.recentBOS_up||struct.recentCHOCH_up):(struct.recentBOS_down||struct.recentCHOCH_down);
  const hasDirZone = isBull?inDiscount:inPremium;
  const hasDirFVG  = isBull?fvgInDiscount:fvgInPremium;
  const chkRSI     = isBull?(rsi<55):(rsi>45);
  const chkTQI     = tqi>0.5;

  // Minimum: must have structure break in bias direction
  if (!hasDirBOS) return null;

  // Score — 5 structure checks (no derivs for BTC pairs)
  const checks = [hasDirBOS, hasDirZone, hasDirFVG, chkRSI, chkTQI];
  const score  = checks.filter(Boolean).length;
  if (score < 3) return null; // need at least 3/5 for BTC pair

  // Conviction (structure-only, 30-80 max since no derivs)
  let conviction = 35;
  if (hasDirBOS)  conviction += 15;
  if (hasDirZone) conviction += 12;
  if (hasDirFVG)  conviction += 12;
  if (chkRSI)     conviction += 8;
  if (chkTQI)     conviction += 8;
  if (volAccel.powerLevel==='IGNITION') conviction += 10;
  else if (volAccel.powerLevel==='FUELING') conviction += 5;
  if (liqVoid.hasVoid) conviction += 5;
  conviction = Math.min(82, conviction); // cap — no derivs means max ~82

  // ROC for bubble sizing context
  const roc5 = candles.length >= 6
    ? (candles[n-1].close - candles[n-6].close) / candles[n-6].close * 100 : 0;

  // Reasons
  const reasons = [];
  if (isBull  && struct.recentCHOCH_up)  reasons.push(`CHoCH bullish on BTC pair (${tf})`);
  if (isBull  && struct.recentBOS_up)    reasons.push(`BOS upside on BTC pair (${tf})`);
  if (!isBull && struct.recentCHOCH_down) reasons.push(`CHoCH bearish on BTC pair (${tf})`);
  if (!isBull && struct.recentBOS_down)   reasons.push(`BOS downside on BTC pair (${tf})`);
  if (hasDirZone) reasons.push(isBull?'Price in discount on BTC chart':'Price in premium on BTC chart');
  if (hasDirFVG)  reasons.push(isBull?'Fresh bullish FVG on BTC pair':'Fresh bearish FVG on BTC pair');
  if (volAccel.powerLevel==='IGNITION') reasons.push(`Volume IGNITION on BTC pair — ${volAccel.accelerationRatio.toFixed(1)}x acceleration`);
  else if (volAccel.powerLevel==='FUELING') reasons.push(`Volume FUELING on BTC pair — momentum building`);
  if (liqVoid.hasVoid) reasons.push('Expansion candle — liquidity void, no resistance');
  reasons.push(`BTC pair ROC: ${roc5>=0?'+':''}${roc5.toFixed(2)}% — coin ${roc5>=0?'gaining':'losing'} in BTC terms`);

  let setupType = 'BTC CONTINUATION';
  if (struct.recentCHOCH_up||struct.recentCHOCH_down) setupType = 'BTC REVERSAL';
  else if (hasDirFVG && hasDirZone) setupType = 'BTC GOLDEN ENTRY';

  return {
    symbol, price, isBull, conviction, score,
    hasDirBOS, hasDirZone, hasDirFVG, chkRSI, chkTQI,
    volPowerLevel: volAccel.powerLevel,
    hasVoid: liqVoid.hasVoid,
    roc5, reasons, setupType,
  };
}

// ─────────────────────────────────────────────────────────────
// D3 BUBBLE RENDERER — shared with MIT SCAN pattern
// ─────────────────────────────────────────────────────────────
function renderBTCBubbles(signals, wrapId, svgId, tooltipId, onClickFn) {
  if (_btcSim) { _btcSim.stop(); _btcSim = null; }

  const wrap = document.getElementById(wrapId);
  const svg  = document.getElementById(svgId);
  wrap.style.display = 'block';
  d3.select(svg).selectAll('*').remove();

  const W = wrap.clientWidth  || 800;
  const H = wrap.clientHeight || 500;

  const minR = 36, maxR = Math.min(W,H)*0.12;
  function getRadius(c) {
    const t = Math.max(0, (c-35)/47);
    return minR + t*t*(maxR-minR);
  }
  // Gold-tinted green for bulls, red for bears (BTC scanner has gold accent)
  function getBubbleColor(d) {
    const t = Math.max(0, (d.conviction-35)/47);
    if (d.isBull) return `rgba(${Math.round(30+t*20)},${Math.round(130+t*80)},${Math.round(60+t*20)},0.85)`;
    else          return `rgba(${Math.round(155+t*100)},45,45,0.85)`;
  }
  function getStrokeColor(d) {
    const a = 0.25 + (d.conviction-35)/47*0.55;
    return d.isBull
      ? `rgba(255,213,79,${a.toFixed(2)})`   // gold stroke for BTC scanner
      : `rgba(255,68,68,${a.toFixed(2)})`;
  }

  const nodes = signals.map(d => ({
    ...d,
    r: getRadius(d.conviction),
    x: W/2 + (Math.random()-0.5)*80,
    y: H/2 + (Math.random()-0.5)*80,
  }));

  const svgEl = d3.select(svg).attr('width',W).attr('height',H);

  const node = svgEl.selectAll('g.bubble')
    .data(nodes).enter().append('g').attr('class','bubble')
    .style('cursor','pointer')
    .call(d3.drag()
      .on('start',(e,d)=>{ if(!e.active)_btcSim.alphaTarget(0.3).restart(); d.fx=d.x;d.fy=d.y; })
      .on('drag', (e,d)=>{ d.fx=e.x; d.fy=e.y; })
      .on('end',  (e,d)=>{ if(!e.active)_btcSim.alphaTarget(0); d.fx=null;d.fy=null; })
    );

  node.append('circle')
    .attr('r',d=>d.r)
    .attr('fill',d=>getBubbleColor(d))
    .attr('stroke',d=>getStrokeColor(d))
    .attr('stroke-width',1.5);

  // IGNITION ring
  node.filter(d=>d.volPowerLevel==='IGNITION')
    .append('circle').attr('class','ignition-ring')
    .attr('r',d=>d.r+4).attr('fill','none')
    .attr('stroke',d=>d.isBull?'rgba(255,213,79,0.6)':'rgba(255,68,68,0.6)')
    .attr('stroke-width',2).attr('stroke-dasharray','4 3');

  node.filter(d=>d.volPowerLevel==='FUELING')
    .append('circle').attr('r',d=>d.r+3).attr('fill','none')
    .attr('stroke',d=>d.isBull?'rgba(255,213,79,0.3)':'rgba(255,68,68,0.3)')
    .attr('stroke-width',1).attr('stroke-dasharray','2 4');

  node.append('text').attr('class','bubble-symbol')
    .attr('dy',d=>d.r>55?'-10':'0')
    .attr('font-size',d=>Math.max(10,Math.min(18,d.r*0.38)))
    .text(d=>d.symbol);

  node.filter(d=>d.r>48)
    .append('text').attr('class','bubble-conviction')
    .attr('dy','14')
    .attr('font-size',d=>Math.max(8,Math.min(12,d.r*0.22)))
    .text(d=>d.conviction+'%');

  // Tooltip
  const tooltip = document.getElementById(tooltipId);

  node
    .on('mouseenter', function(event,d) {
      d3.select(this).select('circle')
        .transition().duration(120).attr('r',d.r*1.08).attr('stroke-width',2.5);

      tooltip.querySelector('.mit-tt-symbol').textContent = d.symbol+'/BTC';
      const dirEl = tooltip.querySelector('.mit-tt-dir');
      dirEl.textContent = d.isBull?'▲ LONG':'▼ SHORT';
      dirEl.className   = 'mit-tt-dir '+(d.isBull?'bull':'bear');
      const convEl = tooltip.querySelector('.mit-tt-conviction');
      convEl.textContent = 'Conviction: '+d.conviction+'%';
      convEl.style.color = d.isBull?'#ffd54f':'#ff4444';

      let setupText = d.setupType||'';
      if (d.volPowerLevel==='IGNITION') setupText += '  ⚡ IGNITION';
      else if (d.volPowerLevel==='FUELING') setupText += '  🔥 FUELING';
      tooltip.querySelector('.mit-tt-setup').textContent = setupText;

      tooltip.querySelector('.mit-tt-reasons').innerHTML =
        (d.reasons||[]).slice(0,4).map(r=>`<div class="mit-tt-reason">${r}</div>`).join('');

      const rect = wrap.getBoundingClientRect();
      const ex=event.clientX-rect.left, ey=event.clientY-rect.top;
      const tw=280,th=200;
      tooltip.style.left=(ex+16+tw>W?ex-tw-10:ex+16)+'px';
      tooltip.style.top =(ey+th>H?ey-th:ey)+'px';
      tooltip.classList.add('visible');
    })
    .on('mousemove', function(event) {
      const rect=wrap.getBoundingClientRect();
      const ex=event.clientX-rect.left, ey=event.clientY-rect.top;
      const tw=280,th=200;
      tooltip.style.left=(ex+16+tw>W?ex-tw-10:ex+16)+'px';
      tooltip.style.top =(ey+th>H?ey-th:ey)+'px';
    })
    .on('mouseleave', function(event,d) {
      d3.select(this).select('circle')
        .transition().duration(120).attr('r',d.r).attr('stroke-width',1.5);
      tooltip.classList.remove('visible');
    })
    .on('click', (event,d) => onClickFn(d.symbol));

  // D3 force simulation
  _btcSim = d3.forceSimulation(nodes)
    .force('center',  d3.forceCenter(W/2,H/2).strength(0.04))
    .force('x',       d3.forceX(W/2).strength(0.03))
    .force('y',       d3.forceY(H/2).strength(0.03))
    .force('collide', d3.forceCollide(d=>d.r+3).strength(0.85).iterations(3))
    .force('charge',  d3.forceManyBody().strength(-8))
    .alphaDecay(0.025)
    .on('tick', () => {
      nodes.forEach(d => {
        d.x = Math.max(d.r+2, Math.min(W-d.r-2, d.x));
        d.y = Math.max(d.r+2, Math.min(H-d.r-2, d.y));
      });
      node.attr('transform', d=>`translate(${d.x},${d.y})`);
    });
}

// ─────────────────────────────────────────────────────────────
// MAIN BTC SCAN RUNNER
// ─────────────────────────────────────────────────────────────
async function runBTCScan() {
  if (_btcScanRunning) return;
  _btcScanRunning = true;
  _btcScanAbort   = false;

  const tf = document.getElementById('btcTfSelect').value;

  // UI reset
  document.getElementById('btcScanBtn').disabled = true;
  document.getElementById('btcStopBtn').style.display = 'inline-block';
  document.getElementById('btc-empty').style.display  = 'none';
  document.getElementById('btc-no-results').style.display = 'none';
  document.getElementById('btc-bubble-wrap').style.display = 'none';
  if (_btcSim) { _btcSim.stop(); _btcSim = null; }
  d3.select('#btc-bubble-svg').selectAll('*').remove();
  document.getElementById('btc-tooltip').classList.remove('visible');

  const setStatus = msg => { document.getElementById('btcStatusMsg').textContent = msg; };
  const setStat   = (id, val) => { document.getElementById(id).textContent = val; };
  const setProgress = pct => { document.getElementById('btc-progress-bar').style.width = pct+'%'; };

  setStat('btc-total','—'); setStat('btc-scanned','0');
  setStat('btc-qualified','0'); setStat('btc-ignored','0');
  setProgress(0);

  try {
    setStatus('Fetching all BTC pair symbols from Binance Spot...');
    const allSymbols = await fetchAllBTCPairs();
    setStat('btc-total', allSymbols.length);
    setStatus(`Scanning ${allSymbols.length} BTC pairs on ${tf.toUpperCase()} for SMC structure...`);

    const results = [];
    let scanned = 0, qualified = 0, ignored = 0;

    const BATCH = 8;
    for (let i = 0; i < allSymbols.length; i += BATCH) {
      if (_btcScanAbort) break;
      const batch = allSymbols.slice(i, i + BATCH);

      await Promise.allSettled(batch.map(async sym => {
        const result = await runBTCPairCheck(sym, tf);
        scanned++;
        if (result) {
          qualified++;
          results.push(result);
        } else {
          ignored++;
        }
        setStat('btc-scanned',   scanned);
        setStat('btc-qualified', qualified);
        setStat('btc-ignored',   ignored);
        setProgress(Math.round((scanned / allSymbols.length) * 100));
      }));

      await new Promise(r => setTimeout(r, 60));
    }

    setProgress(100);

    if (qualified === 0) {
      setStatus(`Scan complete — no qualified BTC pairs on ${tf.toUpperCase()}`);
      document.getElementById('btc-no-results').style.display = 'flex';
      return;
    }

    // Sort by conviction descending
    results.sort((a,b) => b.conviction - a.conviction);

    renderBTCBubbles(
      results,
      'btc-bubble-wrap',
      'btc-bubble-svg',
      'btc-tooltip',
      sym => {
        if (_btcSim) _btcSim.stop();
        switchToStage('stage-analysis', 'rail-analysis');
        document.getElementById('tickerInput').value = sym;
        runAnalysis();
      }
    );

    setStatus(
      `${tf.toUpperCase()} BTC scan complete — ${allSymbols.length} pairs → ` +
      `${qualified} qualified · sorted by conviction`
    );

  } catch(e) {
    setStatus('ERROR: ' + e.message);
    console.error('[BTC SCAN]', e);
  } finally {
    _btcScanRunning = false;
    document.getElementById('btcScanBtn').disabled = false;
    document.getElementById('btcStopBtn').style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════════
// SMC SCANNER — BTC CONFIRMATION INTEGRATION
// Patches into scanner.js's runSMCChecks result
// ═══════════════════════════════════════════════════════════════
async function smcRunWithBTCConfirm(symbol, tf, minChecks) {
  // First run the normal SMC check
  const result = await runSMCChecks(symbol, tf, minChecks);
  if (!result) return null;

  // BTC confirmation is toggled on
  const btcData = await checkBTCConfirmation(symbol, tf, result.bias === 'BULL');
  result.btcConfirmed  = btcData.btcConfirmed;
  result.btcRoc        = btcData.btcRoc;
  result.btcReason     = btcData.btcReason;
  result.convictionDelta = btcData.convictionDelta;
  return result;
}

// ═══════════════════════════════════════════════════════════════
// EVENT WIRING
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

  // ── Desktop rail uses central switchToStage from ui.js ──
  document.getElementById('rail-btc-scan').addEventListener('click', () => {
    switchToStage('stage-btc-scan', 'rail-btc-scan');
  });

  // ── Scan controls ──
  document.getElementById('btcScanBtn').addEventListener('click', runBTCScan);
  document.getElementById('btcStopBtn').addEventListener('click', () => {
    _btcScanAbort = true;
    document.getElementById('btcStatusMsg').textContent = 'Stopping...';
  });

  // ── SMC scanner BTC toggle — show/hide BTC column in table ──
  document.getElementById('smcBtcConfirm').addEventListener('change', function() {
    const show = this.checked;
    document.getElementById('smc-btc-th').style.display = show ? '' : 'none';
    // Also update all existing rows if table has data
    document.querySelectorAll('.smc-btc-cell').forEach(el => {
      el.style.display = show ? '' : 'none';
    });
  });

  // ── Resize handler for BTC bubble canvas ──
  window.addEventListener('resize', () => {
    const wrap = document.getElementById('btc-bubble-wrap');
    if (wrap.style.display !== 'none' && _btcSim) {
      const W = wrap.clientWidth, H = wrap.clientHeight;
      d3.select('#btc-bubble-svg').attr('width',W).attr('height',H);
      _btcSim.force('center', d3.forceCenter(W/2,H/2))
             .force('x', d3.forceX(W/2).strength(0.03))
             .force('y', d3.forceY(H/2).strength(0.03))
             .alpha(0.3).restart();
    }
  });

});
