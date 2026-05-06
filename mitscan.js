'use strict';
// ═══════════════════════════════════════════════════════════════
// MIT SCAN — Market Intelligence Terminal Scan
// 4-Phase institutional funnel: Surge → Structure → Confluence → Signal
// Phase 4 output: D3 force simulation bubble canvas
// ALL phases use strictly the user-selected timeframe
// ═══════════════════════════════════════════════════════════════

let _mitRunning  = false;
let _mitAbort    = false;
let _mitSim      = null;

function mitGetTF() { return document.getElementById('mitTfSelect').value; }

// ═══════════════════════════════════════════════════════════════
// IGNITION HELPERS — all work on candle arrays already fetched
// Zero extra API calls
// ═══════════════════════════════════════════════════════════════

// 3-candle sequential volume growth: Vol[n] > Vol[n-1] > Vol[n-2]
// Returns { isAccelerating, accelerationRatio, powerLevel }
function detectVolumeAcceleration(candles) {
  if (!candles || candles.length < 4) return { isAccelerating:false, accelerationRatio:0, powerLevel:'NONE' };
  const n  = candles.length;
  const v3 = candles[n-1].vol; // current (may be active/partial)
  const v2 = candles[n-2].vol; // last closed
  const v1 = candles[n-3].vol; // pre-previous closed
  const isAccelerating = v3 > v2 && v2 > v1 && v1 > 0;
  const accelerationRatio = isAccelerating && v1 > 0 ? v3 / v1 : 0;
  let powerLevel = 'NONE';
  if (isAccelerating) {
    if (accelerationRatio >= 2.5)     powerLevel = 'IGNITION';
    else if (accelerationRatio >= 1.5) powerLevel = 'FUELING';
    else                               powerLevel = 'BUILDING';
  }
  return { isAccelerating, accelerationRatio, powerLevel };
}

// Expansion candle: body is 2.5x+ the avg body of last 5 candles
// Indicates sellers cleared, price moving through a liquidity void
function detectLiquidityVoid(candles) {
  if (!candles || candles.length < 7) return { hasVoid:false, expansionRatio:0 };
  const n        = candles.length;
  const last     = candles[n-1];
  const bodySize = Math.abs(last.close - last.open);
  const avgBody  = candles.slice(-6,-1).reduce((a,c) => a + Math.abs(c.close - c.open), 0) / 5;
  const expansionRatio = avgBody > 0 ? bodySize / avgBody : 0;
  return { hasVoid: expansionRatio >= 2.5, expansionRatio };
}

// RS Alpha: coin ROC vs BTC ROC across last 3 candles
// Positive = coin outperforming BTC = institutional interest
// btcCandles passed in (already fetched once per Phase 3 run)
function calculateRSAlpha(candles, btcCandles) {
  if (!candles || candles.length < 4 || !btcCandles || btcCandles.length < 4)
    return { rsAlpha:0, rsAccelerating:false };
  const n   = candles.length;
  const nb  = btcCandles.length;
  // ROC over each of last 3 candles vs their prior
  const coinRocs = [
    (candles[n-3].close - candles[n-4]?.close) / (candles[n-4]?.close||1) * 100,
    (candles[n-2].close - candles[n-3].close)  / candles[n-3].close * 100,
    (candles[n-1].close - candles[n-2].close)  / candles[n-2].close * 100,
  ];
  const btcRocs = [
    (btcCandles[nb-3].close - btcCandles[nb-4]?.close) / (btcCandles[nb-4]?.close||1) * 100,
    (btcCandles[nb-2].close - btcCandles[nb-3].close)  / btcCandles[nb-3].close * 100,
    (btcCandles[nb-1].close - btcCandles[nb-2].close)  / btcCandles[nb-2].close * 100,
  ];
  const alphas = coinRocs.map((r,i) => r - btcRocs[i]);
  const rsAlpha = alphas[2]; // latest candle alpha
  // Accelerating RS: each alpha bigger than last
  const rsAccelerating = alphas[2] > alphas[1] && alphas[1] > alphas[0];
  return { rsAlpha, rsAccelerating, alphas };
}

function mitSetPhase(n) {
  for (let i = 1; i <= 4; i++) {
    const pill  = document.getElementById('mphase-' + i);
    const block = document.getElementById('mitpb-' + i);
    if (i < n) {
      pill.classList.remove('active'); pill.classList.add('done');
      block.classList.remove('active'); block.classList.add('done');
    } else if (i === n) {
      pill.classList.add('active'); pill.classList.remove('done');
      block.classList.add('active'); block.classList.remove('done');
    } else {
      pill.classList.remove('active','done');
      block.classList.remove('active','done');
    }
  }
}
function mitSetPhaseStat(phase, val, cls) {
  const el = document.getElementById('mitpb-' + phase + '-val');
  el.textContent = val;
  el.className = 'mpb-val' + (cls ? ' ' + cls : '');
}
function mitSetProgress(pct) { document.getElementById('mit-progress-fill').style.width = pct + '%'; }
function mitSetStatus(msg)   { document.getElementById('mitStatusMsg').textContent = msg; }

// ═══════════════════════════════════════════════════════════════
// PHASE 1 — SURGE FILTER
// ═══════════════════════════════════════════════════════════════
async function phase1_surge(allSymbols, tf) {
  const survivors = [];

  let allTickers = [], spotTickers = [];
  try {
    const [rp, rs] = await Promise.allSettled([
      fetchWithTimeout(`${CFG.BINANCE_FAPI}/ticker/24hr`),
      fetchWithTimeout(`${CFG.BINANCE_SPOT}/ticker/24hr`),
    ]);
    if (rp.status === 'fulfilled' && rp.value.ok) allTickers  = await rp.value.json();
    if (rs.status === 'fulfilled' && rs.value.ok) spotTickers = await rs.value.json();
  } catch(e) {}

  const tickerMap = {};
  allTickers.forEach(t => { tickerMap[t.symbol] = t; });
  const spotMap = {};
  spotTickers.forEach(t => { spotMap[t.symbol] = parseFloat(t.lastPrice || 0); });

  const candidates = [];
  for (const sym of allSymbols) {
    if (_mitAbort) break;
    const t = tickerMap[sym + 'USDT'];
    if (!t) continue;
    const price    = parseFloat(t.lastPrice || 0);
    const priceChg = Math.abs(parseFloat(t.priceChangePercent || 0));
    const vol24h   = parseFloat(t.quoteVolume || 0);
    if (price <= 0 || vol24h < 100000) continue;
    const spreadPct  = spotMap[sym + 'USDT'] > 0
      ? Math.abs((price - spotMap[sym + 'USDT']) / spotMap[sym + 'USDT']) * 100 : 0;
    const rocPass    = priceChg >= 1.5;
    const spreadPass = spreadPct > 0.1; // tightened: 0.1%+ = aggressive leveraged longs chasing
    if (rocPass || spreadPass)
      candidates.push({ symbol:sym, price, priceChg, vol24h, spreadPct, rocPass, spreadPass });
  }

  const rvolLookback = { '5m':20,'15m':20,'1h':20,'4h':15,'1d':14,'1w':10 }[tf] || 20;
  const topCandidates = candidates.sort((a,b) => b.vol24h - a.vol24h).slice(0, 80);

  const BATCH = 10;
  for (let i = 0; i < topCandidates.length; i += BATCH) {
    if (_mitAbort) break;
    const batch = topCandidates.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async c => {
      try {
        const r = await fetchWithTimeout(
          `${CFG.BINANCE_FAPI}/klines?symbol=${c.symbol}USDT&interval=${tf}&limit=${rvolLookback + 1}`
        );
        if (!r.ok) return;
        const klines = await r.json();
        if (!Array.isArray(klines) || klines.length < 5) return;

        const vols    = klines.slice(0,-1).map(k => parseFloat(k[5]));
        const avgVol  = vols.reduce((a,b)=>a+b,0) / vols.length;
        const lastVol = parseFloat(klines[klines.length-1][5]);
        c.rvol     = avgVol > 0 ? lastVol / avgVol : 0;
        c.rvolPass = c.rvol >= 1.8;

        const closes    = klines.map(k => parseFloat(k[4]));
        const recentRoc = closes.length >= 6
          ? Math.abs((closes[closes.length-1]-closes[closes.length-6])/closes[closes.length-6]*100) : 0;
        c.recentRoc = recentRoc;
        c.rocPass   = c.rocPass || recentRoc >= 2.0;

        // Volume acceleration — free, using klines already fetched
        const candlesFromKlines = klines.map(k => ({
          open:parseFloat(k[1]),high:parseFloat(k[2]),
          low:parseFloat(k[3]),close:parseFloat(k[4]),vol:parseFloat(k[5])
        }));
        const volAccel = detectVolumeAcceleration(candlesFromKlines);
        c.volAccel    = volAccel;
        c.powerLevel  = volAccel.powerLevel;

        // Liquidity void — expansion candle check
        const liqVoid = detectLiquidityVoid(candlesFromKlines);
        c.hasLiqVoid  = liqVoid.hasVoid;
        c.expansionRatio = liqVoid.expansionRatio;

        const passes = (c.rvolPass?1:0)+(c.rocPass?1:0)+(c.spreadPass?1:0);
        if (passes >= 1) { c.surgeScore = passes; survivors.push(c); }
      } catch(e) {}
    }));
    mitSetProgress(Math.round(((i+BATCH)/topCandidates.length)*25));
    await new Promise(r => setTimeout(r,50));
  }
  return survivors.sort((a,b) => (b.surgeScore-a.surgeScore)||(b.vol24h-a.vol24h));
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2 — SMC STRUCTURE AUDIT
// ═══════════════════════════════════════════════════════════════
async function phase2_structure(survivors, tf) {
  const qualified = [];
  const BATCH = 6; let done = 0;

  for (let i = 0; i < survivors.length; i += BATCH) {
    if (_mitAbort) break;
    const batch = survivors.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async c => {
      try {
        const candles = await fetchBinanceCandles(c.symbol, tf, 150);
        if (!candles || candles.length < 30) return;

        const n = candles.length, price = candles[n-1].close;
        const swings = findSwings(candles, 5);
        const { highs, lows } = swings;
        // FIX 9: swing-level structure for major BOS/CHoCH detection
        const swingSwings = findSwings(candles, 50);
        const swingStruct = detectStructure(candles, swingSwings.highs, swingSwings.lows);
        const struct      = swingStruct.events.length > 0 ? swingStruct : detectStructure(candles, highs, lows);
        const liq    = detectLiquidity(candles, highs, lows);

        const lastSH   = highs.length > 0 ? highs[highs.length-1].price : price*1.05;
        const lastSL   = lows.length  > 0 ? lows[lows.length-1].price   : price*0.95;
        const rng      = Math.max(lastSH,price) - Math.min(lastSL,price) || price*0.05;
        const premium  = Math.max(lastSH,price) - rng*0.25;
        const discount = Math.min(lastSL,price) + rng*0.25;
        const inPremium  = price > premium;
        const inDiscount = price < discount;

        const fvgs      = typeof findFVGs==='function' ? findFVGs(candles) : [];
        const freshFVGs = fvgs.filter(g=>!g.filled).slice(-3);
        const fvgInDiscount = freshFVGs.some(g=>g.type==='bull'&&g.bottom<discount+rng*0.1);
        const fvgInPremium  = freshFVGs.some(g=>g.type==='bear'&&g.top>premium-rng*0.1);

        const bullSig = (struct.recentBOS_up?2:0)+(struct.recentCHOCH_up?1:0)+(inDiscount?1:0)+(fvgInDiscount?2:0);
        const bearSig = (struct.recentBOS_down?2:0)+(struct.recentCHOCH_down?1:0)+(inPremium?1:0)+(fvgInPremium?2:0);
        const isBull  = bullSig >= bearSig;

        const hasDirBOS  = isBull?(struct.recentBOS_up||struct.recentCHOCH_up):(struct.recentBOS_down||struct.recentCHOCH_down);
        const hasDirZone = isBull?inDiscount:inPremium;
        const hasDirFVG  = isBull?fvgInDiscount:fvgInPremium;
        const hasSweep   = liq.sweepDetected;
        const hasLiq     = liq.liquidityPresent;

        if (!hasDirBOS) return;

        // Anti-dump filter: if vol accelerating INTO a POI (not away from it), it's exhaustion
        const volAccel2 = detectVolumeAcceleration(candles);
        const liqVoid2  = detectLiquidityVoid(candles);
        // Exhaustion: vol accelerating but price moving INTO supply/demand zone against bias
        const isExhaustion = volAccel2.isAccelerating &&
          ((isBull  && inPremium)  ||   // bull but price at premium = buying exhaustion
           (!isBull && inDiscount));     // bear but price at discount = selling exhaustion
        if (isExhaustion) return; // hard reject — this is a wall, not a launch

        const reasons = [];
        if (isBull  && struct.recentCHOCH_up)   reasons.push(`CHoCH confirmed bullish on ${tf}`);
        if (isBull  && struct.recentBOS_up)      reasons.push(`BOS break upside on ${tf}`);
        if (!isBull && struct.recentCHOCH_down)  reasons.push(`CHoCH confirmed bearish on ${tf}`);
        if (!isBull && struct.recentBOS_down)     reasons.push(`BOS break downside on ${tf}`);
        if (hasDirZone) reasons.push(isBull?'Price in Discount Zone — optimal buy area':'Price in Premium Zone — optimal sell area');
        if (hasDirFVG)  reasons.push(isBull?'Fresh bullish FVG in discount — golden entry':'Fresh bearish FVG in premium — ideal short');
        if (hasSweep)   reasons.push('Liquidity sweep detected — institutional footprint');
        if (hasLiq)     reasons.push(`Equal ${isBull?'lows':'highs'} — retail stop pool located`);

        let setupType = 'CONTINUATION';
        if (struct.recentCHOCH_up||struct.recentCHOCH_down) setupType='REVERSAL';
        else if (hasSweep&&hasDirBOS)  setupType='LIQ SWEEP';
        else if (hasDirFVG&&hasDirZone) setupType='GOLDEN ENTRY';

        qualified.push({ ...c, isBull, price, reasons, setupType,
          hasDirBOS, hasDirZone, hasDirFVG, hasSweep, hasLiq,
          volAccel2, liqVoid2,
          structScore:[hasDirBOS,hasDirZone,hasDirFVG,hasSweep,hasLiq].filter(Boolean).length });
      } catch(e) {}
    }));
    done += batch.length;
    mitSetProgress(25 + Math.round((done/survivors.length)*35));
    await new Promise(r => setTimeout(r,60));
  }
  return qualified;
}

// ═══════════════════════════════════════════════════════════════
// PHASE 3 — CONFLUENCE TRIANGULATION
// ═══════════════════════════════════════════════════════════════
async function phase3_confluence(structQualified, tf) {
  const final = [];

  let btcRoc = 0;
  let btcCandles = null;
  try {
    btcCandles = await fetchBinanceCandles('BTC', tf, 12);
    if (btcCandles && btcCandles.length >= 6)
      btcRoc = (btcCandles[btcCandles.length-1].close - btcCandles[btcCandles.length-6].close)
               / btcCandles[btcCandles.length-6].close * 100;
  } catch(e) {}
  const btcBearish = btcRoc < -1.5;

  const BATCH = 5; let done = 0;
  for (let i = 0; i < structQualified.length; i += BATCH) {
    if (_mitAbort) break;
    const batch = structQualified.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async c => {
      try {
        const [oiRes, lsRes, oiHistRes] = await Promise.allSettled([
          fetchBinanceOI(c.symbol),
          fetchBinanceLSRatio(c.symbol),
          fetchOIHistory(c.symbol),
        ]);
        const oi     = oiRes.status==='fulfilled'     ? oiRes.value     : null;
        const ls     = lsRes.status==='fulfilled'     ? lsRes.value     : null;
        const oiHist = oiHistRes.status==='fulfilled' ? oiHistRes.value : null;

        let oiDirection='unknown', oiReason='';
        if (oi && oiHist && oiHist.length >= 2) {
          const oiNow  = parseFloat(oi.openInterest||0);
          const oiPrev = parseFloat(oiHist[oiHist.length-2]?.sumOpenInterest||oiNow);
          const oiChg  = oiPrev>0?(oiNow-oiPrev)/oiPrev*100:0;
          const up     = c.priceChg>0;
          if      (up  && oiChg> 0.5){oiDirection='strong_long'; oiReason='Price up + OI rising — genuine longs, strong move';}
          else if (up  && oiChg<-0.5){oiDirection='short_cover'; oiReason='Price up + OI falling — short covering, possible trap';}
          else if (!up && oiChg> 0.5){oiDirection='strong_short';oiReason='Price down + OI rising — genuine shorts, strong move';}
          else if (!up && oiChg<-0.5){oiDirection='long_cover';  oiReason='Price down + OI falling — long liquidation, weak move';}
          else oiReason='OI stable — no strong directional signal';
        }

        let lsRatio=1, lsReason='';
        if (ls) {
          lsRatio = parseFloat(ls.longShortRatio||1);
          const lPct=(lsRatio/(1+lsRatio)*100).toFixed(0);
          const sPct=(100-parseFloat(lPct)).toFixed(0);
          if      (lsRatio>1.5)  lsReason=`${lPct}% retail long — crowded, watch for sweep down`;
          else if (lsRatio<0.67) lsReason=`${sPct}% retail short — overcrowded, squeeze possible`;
          else                   lsReason=`L/S balanced at ${lsRatio.toFixed(2)}`;
        }

        let btcReason='', btcPass=true;
        if (c.isBull && btcBearish) {
          if ((c.recentRoc||0)>0||c.priceChg>0){
            btcReason=`Relative strength vs BTC (BTC ${btcRoc.toFixed(1)}%) — institutional accumulation`;
          } else {
            btcPass=false;
            btcReason=`Dumping with BTC — no relative strength, setup weakened`;
          }
        } else if (!c.isBull&&!btcBearish) {
          btcReason=`BTC holding while coin weakens — relative weakness confirmed`;
        } else {
          btcReason=`BTC aligned ${btcRoc>=0?'+':''}${btcRoc.toFixed(1)}% — trade direction supported`;
        }

        const oiSupports = c.isBull
          ? ['strong_long','short_cover','unknown'].includes(oiDirection)
          : ['strong_short','long_cover','unknown'].includes(oiDirection);

        // ── RS Alpha: coin outperformance vs BTC across 3 candles ──
        // Uses candle data already in the coin object (recentRoc) + btcCandles fetched once
        const rsData = calculateRSAlpha(
          // rebuild minimal candle-like array from what we have
          // We don't have per-coin candles here — use the volAccel2 candles stored from Phase 2
          // For RS we use the simple scalar already computed
          null, btcCandles
        );
        // Simple RS: coin 5-candle ROC minus BTC 5-candle ROC
        const coinRoc5 = c.recentRoc || 0;
        const btcRoc5  = btcCandles && btcCandles.length >= 6
          ? Math.abs((btcCandles[btcCandles.length-1].close - btcCandles[btcCandles.length-6].close)
            / btcCandles[btcCandles.length-6].close * 100) : 0;
        const rsAlpha     = c.isBull ? (coinRoc5 - btcRoc5) : (btcRoc5 - coinRoc5);
        const hasRSLead   = rsAlpha > 0.5;   // coin clearly outperforming BTC
        const hasStrongRS = rsAlpha > 2.0;   // coin massively outperforming

        // ── Volume acceleration from Phase 1 & Phase 2 ──
        // Phase 1 volAccel (selected TF, from klines)
        const p1Accel  = c.volAccel  || { powerLevel:'NONE', accelerationRatio:0 };
        // Phase 2 volAccel (from structure candles — same TF, more candles = more accurate)
        const p2Accel  = c.volAccel2 || { powerLevel:'NONE', accelerationRatio:0 };
        // Use the stronger of the two
        const bestAccelRatio = Math.max(p1Accel.accelerationRatio||0, p2Accel.accelerationRatio||0);
        const bestPowerLevel = bestAccelRatio >= 2.5 ? 'IGNITION'
          : bestAccelRatio >= 1.5 ? 'FUELING'
          : p1Accel.isAccelerating || p2Accel.isAccelerating ? 'BUILDING' : 'NONE';

        // Liquidity void — expansion candle (from Phase 1 or Phase 2)
        const hasVoid = c.hasLiqVoid || (c.liqVoid2 && c.liqVoid2.hasVoid);

        let conviction=40;
        if (c.rvolPass)   conviction+=8;
        if (c.rocPass)    conviction+=5;
        if (c.spreadPass) conviction+=4;
        if (c.hasDirBOS)  conviction+=10;
        if (c.hasDirZone) conviction+=7;
        if (c.hasDirFVG)  conviction+=8;
        if (c.hasSweep)   conviction+=6;
        if (c.hasLiq)     conviction+=4;

        // OI
        if (oiSupports) {
          conviction+=(oiDirection==='strong_long'||oiDirection==='strong_short')?10:4;
        } else { conviction-=8; }
        if (lsRatio>1.5  &&!c.isBull) conviction+=6;
        if (lsRatio<0.67 && c.isBull) conviction+=6;
        if (btcPass) conviction+=5; else conviction-=10;

        // RS Alpha scoring
        if (hasStrongRS) conviction+=12;
        else if (hasRSLead) conviction+=6;

        // Volume acceleration scoring
        if (bestPowerLevel==='IGNITION') conviction+=15;
        else if (bestPowerLevel==='FUELING') conviction+=8;
        else if (bestPowerLevel==='BUILDING') conviction+=3;

        // Liquidity void (expansion candle = sellers/buyers cleared)
        if (hasVoid) conviction+=7;

        conviction=Math.max(30,Math.min(98,Math.round(conviction)));
        if (conviction<55) return;

        // BTC confirmation layer — only when toggle is on
        let btcReason2 = '', btcDelta = 0;
        const mitBtcOn = document.getElementById('mitBtcConfirm')?.checked;
        if (mitBtcOn && typeof checkBTCConfirmation === 'function') {
          const btcData = await checkBTCConfirmation(c.symbol, tf, c.isBull);
          btcDelta = btcData.convictionDelta || 0;
          btcReason2 = btcData.btcReason || '';
          conviction = Math.max(30, Math.min(98, conviction + btcDelta));
          if (conviction < 55) return; // BTC confirm dropped it below threshold
        }

        // Build RS + ignition reasons
        if (hasStrongRS)
          c.reasons.push(`RS Alpha +${rsAlpha.toFixed(1)}% vs BTC — strong institutional outperformance`);
        else if (hasRSLead)
          c.reasons.push(`RS Alpha +${rsAlpha.toFixed(1)}% vs BTC — coin outperforming market`);
        if (bestPowerLevel==='IGNITION')
          c.reasons.push(`Volume IGNITION — 3-candle acceleration ratio ${bestAccelRatio.toFixed(1)}x, sellers cleared`);
        else if (bestPowerLevel==='FUELING')
          c.reasons.push(`Volume FUELING — acceleration ratio ${bestAccelRatio.toFixed(1)}x, momentum building`);
        if (hasVoid)
          c.reasons.push('Expansion candle detected — liquidity void above, no supply resistance');

        final.push({ ...c, conviction, oiDirection, lsRatio, btcRoc,
          rsAlpha, hasRSLead, hasStrongRS,
          bestPowerLevel, bestAccelRatio, hasVoid,
          allReasons:[...(c.reasons||[]),...[oiReason,lsReason,btcReason,btcReason2].filter(Boolean)] });
      } catch(e) {}
    }));
    done+=batch.length;
    mitSetProgress(60+Math.round((done/structQualified.length)*35));
    await new Promise(r=>setTimeout(r,60));
  }
  return final.sort((a,b)=>b.conviction-a.conviction);
}

// ═══════════════════════════════════════════════════════════════
// PHASE 4 — D3 FORCE BUBBLE CANVAS
// ═══════════════════════════════════════════════════════════════
function renderBubbles(signals) {
  if (_mitSim) { _mitSim.stop(); _mitSim=null; }

  const wrap = document.getElementById('mit-bubble-wrap');
  const svg  = document.getElementById('mit-bubble-svg');
  wrap.style.display = 'block';
  d3.select(svg).selectAll('*').remove();

  const W = wrap.clientWidth  || 800;
  const H = wrap.clientHeight || 500;

  const minR = 38, maxR = Math.min(W,H)*0.13;
  function getRadius(conviction) {
    const t = (conviction-55)/43;
    return minR + t*t*(maxR-minR);
  }
  function getBubbleColor(d) {
    const t = (d.conviction-55)/43;
    if (d.isBull) return `rgba(0,${Math.round(140+t*90)},80,0.85)`;
    else          return `rgba(${Math.round(155+t*100)},45,45,0.85)`;
  }
  function getStrokeColor(d) {
    const a = 0.3+(d.conviction-55)/43*0.55;
    return d.isBull ? `rgba(0,230,118,${a.toFixed(2)})` : `rgba(255,68,68,${a.toFixed(2)})`;
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
      .on('start',(event,d)=>{ if(!event.active)_mitSim.alphaTarget(0.3).restart(); d.fx=d.x;d.fy=d.y; })
      .on('drag', (event,d)=>{ d.fx=event.x; d.fy=event.y; })
      .on('end',  (event,d)=>{ if(!event.active)_mitSim.alphaTarget(0); d.fx=null;d.fy=null; })
    );

  node.append('circle')
    .attr('r', d=>d.r)
    .attr('fill',   d=>getBubbleColor(d))
    .attr('stroke', d=>getStrokeColor(d))
    .attr('stroke-width',1.5);

  // IGNITION pulse ring — animated outer ring for highest conviction launches
  node.filter(d => d.bestPowerLevel === 'IGNITION')
    .append('circle')
    .attr('class','ignition-ring')
    .attr('r', d=>d.r+4)
    .attr('fill','none')
    .attr('stroke', d=>d.isBull?'rgba(0,230,118,0.6)':'rgba(255,68,68,0.6)')
    .attr('stroke-width',2)
    .attr('stroke-dasharray','4 3');

  // FUELING outer ring — static, subtler
  node.filter(d => d.bestPowerLevel === 'FUELING')
    .append('circle')
    .attr('r', d=>d.r+3)
    .attr('fill','none')
    .attr('stroke', d=>d.isBull?'rgba(0,230,118,0.3)':'rgba(255,68,68,0.3)')
    .attr('stroke-width',1)
    .attr('stroke-dasharray','2 4');

  node.append('text').attr('class','bubble-symbol')
    .attr('dy', d=>d.r>55?'-10':'0')
    .attr('font-size', d=>Math.max(10,Math.min(18,d.r*0.38)))
    .text(d=>d.symbol);

  node.filter(d=>d.r>48)
    .append('text').attr('class','bubble-conviction')
    .attr('dy','14')
    .attr('font-size', d=>Math.max(8,Math.min(12,d.r*0.22)))
    .text(d=>d.conviction+'%');

  // Tooltip
  const tooltip = document.getElementById('mit-tooltip');

  node
    .on('mouseenter', function(event,d) {
      d3.select(this).select('circle')
        .transition().duration(120).attr('r',d.r*1.08).attr('stroke-width',2.5);

      tooltip.querySelector('.mit-tt-symbol').textContent = d.symbol;
      const dirEl = tooltip.querySelector('.mit-tt-dir');
      dirEl.textContent = d.isBull?'▲ LONG':'▼ SHORT';
      dirEl.className   = 'mit-tt-dir '+(d.isBull?'bull':'bear');
      const convEl = tooltip.querySelector('.mit-tt-conviction');
      convEl.textContent = 'Conviction: '+d.conviction+'%';
      convEl.style.color = d.isBull?'#00e676':'#ff4444';

      // Power level badge
      const setupEl = tooltip.querySelector('.mit-tt-setup');
      let setupText = d.setupType||'';
      if (d.bestPowerLevel==='IGNITION') setupText += '  ⚡ IGNITION';
      else if (d.bestPowerLevel==='FUELING') setupText += '  🔥 FUELING';
      if (d.hasStrongRS) setupText += '  ★ RS LEAD';
      setupEl.textContent = setupText;
      tooltip.querySelector('.mit-tt-reasons').innerHTML =
        (d.allReasons||[]).slice(0,4).map(r=>`<div class="mit-tt-reason">${r}</div>`).join('');

      const rect=wrap.getBoundingClientRect();
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
    .on('click', (event,d) => mitGoToAnalysis(d.symbol));

  // D3 force simulation
  _mitSim = d3.forceSimulation(nodes)
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

// ═══════════════════════════════════════════════════════════════
// MAIN RUNNER
// ═══════════════════════════════════════════════════════════════
async function runMITScan() {
  if (_mitRunning) return;
  _mitRunning=true; _mitAbort=false;

  const tf = mitGetTF();

  document.getElementById('mitScanBtn').disabled=true;
  document.getElementById('mitStopBtn').style.display='inline-block';
  document.getElementById('mit-empty').style.display='none';
  document.getElementById('mit-no-results').style.display='none';
  document.getElementById('mit-bubble-wrap').style.display='none';
  if (_mitSim){_mitSim.stop();_mitSim=null;}
  d3.select('#mit-bubble-svg').selectAll('*').remove();
  document.getElementById('mit-tooltip').classList.remove('visible');
  mitSetProgress(0);
  mitSetPhase(1);
  mitSetPhaseStat(1,'—'); mitSetPhaseStat(2,'—'); mitSetPhaseStat(3,'—'); mitSetPhaseStat(4,'—');

  try {
    // PHASE 1
    mitSetStatus('Phase 1 — Fetching exchange symbols...');
    let allSymbols=[];
    try { allSymbols=await fetchAllBinanceSymbols(); }
    catch(e){ mitSetStatus('ERROR: Cannot reach Binance'); return; }

    mitSetPhaseStat(1, allSymbols.length+' COINS');
    mitSetStatus(`Phase 1 — Scanning ${allSymbols.length} coins for surge activity on ${tf.toUpperCase()}...`);

    const surgeList = await phase1_surge(allSymbols, tf);
    if (_mitAbort){mitSetStatus('Stopped at Phase 1'); return;}

    mitSetPhaseStat(1, surgeList.length+' SURGING', surgeList.length>0?'gold':'');
    mitSetProgress(25);
    if (surgeList.length===0){
      mitSetStatus('No coins showing unusual activity on '+tf.toUpperCase());
      document.getElementById('mit-no-results').style.display='flex'; return;
    }

    // PHASE 2
    mitSetPhase(2);
    mitSetStatus(`Phase 2 — SMC structure audit on ${surgeList.length} surging coins (${tf.toUpperCase()})...`);

    const structList = await phase2_structure(surgeList, tf);
    if (_mitAbort){mitSetStatus('Stopped at Phase 2'); return;}

    mitSetPhaseStat(2, structList.length+' STRUCTURED', structList.length>0?'gold':'');
    mitSetProgress(60);
    if (structList.length===0){
      mitSetStatus('Surge detected — no clean SMC structure on '+tf.toUpperCase()+'. Wait for structure to form.');
      document.getElementById('mit-no-results').style.display='flex'; return;
    }

    // PHASE 3
    mitSetPhase(3);
    mitSetStatus(`Phase 3 — Confluence triangulation on ${structList.length} structured coins...`);

    const finalList = await phase3_confluence(structList, tf);
    if (_mitAbort){mitSetStatus('Stopped at Phase 3'); return;}

    mitSetPhaseStat(3, finalList.length+' CONFIRMED', finalList.length>0?'green':'');
    mitSetProgress(95);

    // PHASE 4
    mitSetPhase(4);
    mitSetPhaseStat(4, finalList.length+' SIGNALS', finalList.length>0?'green':'');
    mitSetProgress(100);

    if (finalList.length===0){
      mitSetStatus('Confluence too weak — no high conviction setups. Try a different timeframe.');
      document.getElementById('mit-no-results').style.display='flex'; return;
    }

    renderBubbles(finalList);
    mitSetStatus(
      `${tf.toUpperCase()} scan complete — `+
      `${allSymbols.length} total → ${surgeList.length} surging → `+
      `${structList.length} structured → ${finalList.length} high conviction signals`
    );

  } catch(e){
    mitSetStatus('ERROR: '+e.message);
    console.error('[MIT SCAN]',e);
  } finally {
    _mitRunning=false;
    document.getElementById('mitScanBtn').disabled=false;
    document.getElementById('mitStopBtn').style.display='none';
  }
}

function mitGoToAnalysis(symbol) {
  if (_mitSim) _mitSim.stop();
  switchToStage('stage-analysis', 'rail-analysis');
  document.getElementById('tickerInput').value=symbol;
  runAnalysis();
}

// ═══════════════════════════════════════════════════════════════
// EVENT WIRING
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

  // ── NAV uses central switchToStage from ui.js ──
  document.getElementById('rail-mit-scan').addEventListener('click', () => {
    switchToStage('stage-mit-scan', 'rail-mit-scan');
  });

  document.getElementById('mitScanBtn').addEventListener('click', runMITScan);
  document.getElementById('mitStopBtn').addEventListener('click', () => {
    _mitAbort=true; mitSetStatus('Stopping...');
  });

  window.addEventListener('resize', () => {
    const wrap=document.getElementById('mit-bubble-wrap');
    if (wrap.style.display!=='none' && _mitSim) {
      const W=wrap.clientWidth, H=wrap.clientHeight;
      d3.select('#mit-bubble-svg').attr('width',W).attr('height',H);
      _mitSim.force('center',d3.forceCenter(W/2,H/2))
             .force('x',d3.forceX(W/2).strength(0.03))
             .force('y',d3.forceY(H/2).strength(0.03))
             .alpha(0.3).restart();
    }
  });

});
