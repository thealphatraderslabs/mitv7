// ═══════════════════════════════════════════════════════════════
// SMC CONFLUENCE SCANNER
// ═══════════════════════════════════════════════════════════════
// Strategy: smart-filter pipeline
//   Phase 1 — fetch candles, run 5 structure checks (no API calls for derivs)
//   Phase 2 — only coins passing ≥3 structure checks fetch funding + L/S (2 calls)
//   Qualify  — coins with ≥ minChecks out of 7 appear in table
// ═══════════════════════════════════════════════════════════════

'use strict';

let _smcRunning = false;
let _smcAbort   = false;
let _smcResults = [];   // store for potential re-sort

// ── FETCH ALL BINANCE FAPI USDT PERP SYMBOLS ──────────────────
async function fetchAllBinanceSymbols() {
  const r = await fetchWithTimeout(`${CFG.BINANCE_FAPI}/exchangeInfo`);
  if (!r.ok) throw new Error('Could not fetch exchange info');
  const d = await r.json();
  return d.symbols
    .filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING' && s.contractType === 'PERPETUAL')
    .map(s => s.baseAsset);
}

// ── RUN SMC CHECKS FOR ONE COIN ───────────────────────────────
// Bias direction is determined by the exact same weighted vote used in
// generateTradeIdeas — NOT just SuperTrend alone. This ensures the
// scanner and the analysis page always agree on direction.
async function runSMCChecks(symbol, tf, minChecks) {
  // Phase 1: candles + structure (no deriv calls yet)
  let candles;
  try {
    candles = await fetchBinanceCandles(symbol, tf, 150);
  } catch(e) { return null; }

  if (!candles || candles.length < 30) return null;

  const n            = candles.length;
  const closes       = candles.map(c => c.close);
  const currentPrice = closes[n - 1];
  const stData       = calcSuperTrend(candles);
  const lastTrend    = stData.trend[n - 1];
  const swings       = findSwings(candles, 5);
  const { highs, lows } = swings;
  // FIX 9: swing-level structure (50-bar) for BOS/CHoCH check — major breaks only
  const swingSwings  = findSwings(candles, 50);
  const swingStruct  = detectStructure(candles, swingSwings.highs, swingSwings.lows);
  // Internal struct as fallback for display/narrative
  const struct       = swingStruct.events.length > 0 ? swingStruct : detectStructure(candles, highs, lows);

  const lastSH = highs.length > 0 ? highs[highs.length - 1].price : currentPrice * 1.03;
  const lastSL = lows.length  > 0 ? lows[lows.length - 1].price   : currentPrice * 0.97;
  const effectiveSH = Math.max(lastSH, currentPrice);
  const effectiveSL = Math.min(lastSL, currentPrice);
  const rng      = effectiveSH - effectiveSL || currentPrice * 0.05;
  const premium  = effectiveSH - rng * 0.25;
  const discount = effectiveSL + rng * 0.25;
  const inPremium  = currentPrice > premium;
  const inDiscount = currentPrice < discount;

  const rsiArr = calcRSI(closes, 14);
  const rsi    = rsiArr[rsiArr.length - 1] || 50;
  const tqi    = calcTQI(candles, 20, 20, 10);

  // ── STEP 1: replicate the exact bullSMC/bearSMC vote from generateTradeIdeas ──
  // (structure-only pass — derivs not fetched yet, use neutral defaults)
  let bullSMC = 0, bearSMC = 0;

  // SuperTrend vote (20pts)
  if (lastTrend === 1) bullSMC += 20; else bearSMC += 20;

  // Zone vote (20pts aligned, 10pts contra)
  if (inDiscount) {
    bullSMC += (lastTrend === -1) ? 10 : 20;
  } else if (inPremium) {
    bearSMC += (lastTrend === 1)  ? 10 : 20;
  } else {
    bullSMC += 8; bearSMC += 8;
  }

  // Structure vote (20pts)
  if (struct.events.length > 0) {
    if (struct.events[0].dir === 'bull') bullSMC += 20; else bearSMC += 20;
  }

  // RSI vote (10pts / 5pts)
  if (rsi < 40) bullSMC += 10; else if (rsi > 65) bearSMC += 10;
  else if (rsi < 52) bullSMC += 5; else bearSMC += 5;

  // TQI vote (10pts)
  if (tqi > 0.5 && lastTrend === 1)  bullSMC += 10;
  else if (tqi > 0.5 && lastTrend === -1) bearSMC += 10;

  // Determine primary direction from structure vote (derivs not in yet)
  const isBull = bullSMC >= bearSMC;

  // ── STEP 2: run the 5 structure SMC checks against the correct direction ──
  const chk_st   = isBull ? (lastTrend === 1)  : (lastTrend === -1);
  const chk_zone = isBull ? inDiscount          : inPremium;
  const chk_bos  = isBull
    ? (struct.recentBOS_up   || struct.recentCHOCH_up)
    : (struct.recentBOS_down || struct.recentCHOCH_down);
  const chk_rsi  = isBull ? (rsi < 55) : (rsi > 45);
  const chk_tqi  = tqi > 0.5;

  const structPasses = [chk_st, chk_zone, chk_bos, chk_rsi, chk_tqi].filter(Boolean).length;

  // Smart filter: if even adding both deriv checks can't reach minChecks, skip
  if (structPasses + 2 < minChecks) return null;

  // ── STEP 3: fetch derivs only for coins that can still qualify ──
  let funding = 0, lsRatio = 1;
  try {
    const [fundRes, lsRes] = await Promise.allSettled([
      fetchBinanceFunding(symbol),
      fetchBinanceLSRatio(symbol),
    ]);
    if (fundRes.status === 'fulfilled' && fundRes.value)
      funding = parseFloat(fundRes.value.fundingRate || 0) * 100;
    if (lsRes.status === 'fulfilled' && lsRes.value)
      lsRatio = parseFloat(lsRes.value.longShortRatio || 1);
  } catch(e) {}

  // ── STEP 4: re-run the bias vote with derivs included (matches generateTradeIdeas exactly) ──
  if (funding > 0.05) bearSMC += 10; else if (funding > 0.02) bearSMC += 5; else if (funding < -0.01) bullSMC += 10;
  if (lsRatio > 1.3) bearSMC += 10; else if (lsRatio > 1.1) bearSMC += 5; else if (lsRatio < 0.8) bullSMC += 10; else if (lsRatio < 0.9) bullSMC += 5;

  // Final direction after full vote (this is what analysis page uses)
  const isBullFinal = bullSMC >= bearSMC;

  // ── STEP 5: re-evaluate all 7 checks against the final direction ──
  const chk_st_f   = isBullFinal ? (lastTrend === 1)  : (lastTrend === -1);
  const chk_zone_f = isBullFinal ? inDiscount          : inPremium;
  const chk_bos_f  = isBullFinal
    ? (struct.recentBOS_up   || struct.recentCHOCH_up)
    : (struct.recentBOS_down || struct.recentCHOCH_down);
  const chk_rsi_f  = isBullFinal ? (rsi < 55) : (rsi > 45);
  const chk_tqi_f  = tqi > 0.5;
  const chk_fund_f = isBullFinal ? (funding < -0.01) : (funding > 0.02);
  const chk_ls_f   = isBullFinal ? (lsRatio < 0.8)   : (lsRatio > 1.2);

  const allChecks = [chk_st_f, chk_zone_f, chk_bos_f, chk_rsi_f, chk_tqi_f, chk_fund_f, chk_ls_f];
  const totalPass = allChecks.filter(Boolean).length;

  if (totalPass < minChecks) return null;

  return {
    symbol,
    price: currentPrice,
    bias: isBullFinal ? 'BULL' : 'BEAR',
    checks: {
      st:   chk_st_f,   zone: chk_zone_f, bos: chk_bos_f,
      rsi:  chk_rsi_f,  tqi:  chk_tqi_f,
      fund: chk_fund_f, ls:   chk_ls_f,
    },
    score: totalPass,
    rsi, tqi, funding, lsRatio,
    structEvents: struct.events,
  };
}

// ── DOM HELPERS ───────────────────────────────────────────────
function smcSetStatus(msg) {
  document.getElementById('smcStatusMsg').textContent = msg;
}
function smcUpdateStats(total, scanned, qualified, ignored, progress) {
  if (total !== null) document.getElementById('smc-total-coins').textContent = total;
  document.getElementById('smc-scanned').textContent   = scanned;
  document.getElementById('smc-qualified').textContent = qualified;
  document.getElementById('smc-ignored').textContent   = ignored;
  document.getElementById('smc-progress-bar').style.width = progress + '%';
}

function smcCheckCell(pass) {
  return `<td><span class="smc-check ${pass ? 'pass' : 'fail'}">${pass ? '✓' : '·'}</span></td>`;
}

function smcRenderRow(result) {
  const s = result.score;
  const badgeClass = s === 7 ? 's7' : s === 6 ? 's6' : s === 5 ? 's5' : 's4';
  const { st, zone, bos, rsi, tqi, fund, ls } = result.checks;
  return `<tr data-symbol="${result.symbol}">
    <td>
      <div class="smc-coin-name">${result.symbol}</div>
      <div class="smc-coin-sub">USDT PERP</div>
    </td>
    <td><span class="smc-price">${fmtPrice(result.price)}</span></td>
    ${smcCheckCell(st)}
    ${smcCheckCell(zone)}
    ${smcCheckCell(bos)}
    ${smcCheckCell(rsi)}
    ${smcCheckCell(tqi)}
    ${smcCheckCell(fund)}
    ${smcCheckCell(ls)}
    <td class="smc-btc-cell" style="display:${document.getElementById('smcBtcConfirm')?.checked ? '' : 'none'}">
      ${result.btcConfirmed === true
        ? `<span class="smc-check pass" title="${result.btcReason||''}">₿</span>`
        : result.btcConfirmed === false
        ? `<span class="smc-check fail" title="${result.btcReason||''}">₿</span>`
        : `<span class="smc-check fail" style="opacity:0.3" title="BTC pair not checked">—</span>`}
    </td>
    <td><span class="smc-score-badge ${badgeClass}">${s}/7</span></td>
    <td><span class="smc-bias ${result.bias === 'BULL' ? 'bull' : 'bear'}">${result.bias === 'BULL' ? '▲ BULL' : '▼ BEAR'}</span></td>
    <td><button class="smc-analyse-btn" data-symbol="${result.symbol}">ANALYSE →</button></td>
  </tr>`;
}

function smcInsertRow(result) {
  const tbody = document.getElementById('smc-tbody');

  // Insert in score order (highest first)
  const rows = Array.from(tbody.querySelectorAll('tr[data-symbol]'));
  const newRowHTML = smcRenderRow(result);
  const tmp = document.createElement('tbody');
  tmp.innerHTML = newRowHTML;
  const newRow = tmp.firstElementChild;

  let inserted = false;
  for (const row of rows) {
    const rowScore = parseInt(row.querySelector('.smc-score-badge').textContent);
    if (result.score > rowScore) {
      tbody.insertBefore(newRow, row);
      inserted = true;
      break;
    }
  }
  if (!inserted) tbody.appendChild(newRow);

  // Bind analyse button
  newRow.querySelector('.smc-analyse-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    smcGoToAnalysis(result.symbol);
  });
  newRow.addEventListener('click', () => smcGoToAnalysis(result.symbol));
}

function smcGoToAnalysis(symbol) {
  switchToStage('stage-analysis', 'rail-analysis');
  document.getElementById('tickerInput').value = symbol;
  runAnalysis();
}

// ── MAIN SCAN RUNNER ─────────────────────────────────────────
async function runSMCScan() {
  if (_smcRunning) return;
  _smcRunning = true;
  _smcAbort   = false;
  _smcResults = [];

  const tf        = document.getElementById('smcTfSelect').value;
  const minChecks = parseInt(document.getElementById('smcMinChecks').value);
  const btcConfirmOn = document.getElementById('smcBtcConfirm').checked;

  // Show/hide BTC column header
  document.getElementById('smc-btc-th').style.display = btcConfirmOn ? '' : 'none';

  // UI reset
  document.getElementById('smcScanBtn').disabled = true;
  document.getElementById('smcStopBtn').style.display = 'inline-block';
  document.getElementById('smc-empty').style.display  = 'none';
  document.getElementById('smc-table').style.display  = 'table';
  document.getElementById('smc-tbody').innerHTML       = '';
  smcUpdateStats(null, 0, 0, 0, 0);
  smcSetStatus('Fetching exchange symbols...');

  try {
    // Step 1: get all symbols
    const symbols = await fetchAllBinanceSymbols();
    const total   = symbols.length;
    document.getElementById('smc-total-coins').textContent = total;
    smcSetStatus(`Scanning ${total} coins on ${tf.toUpperCase()} — min ${minChecks}/7 checks required`);

    let scanned = 0, qualified = 0, ignored = 0;

    // Step 2: scan in batches of 8 (avoid hammering the API)
    const BATCH = 8;
    for (let i = 0; i < symbols.length; i += BATCH) {
      if (_smcAbort) break;

      const batch = symbols.slice(i, i + BATCH);
      const batchResults = await Promise.allSettled(
        batch.map(async sym => {
          const result = await runSMCChecks(sym, tf, minChecks);
          if (!result) return null;
          // BTC confirmation layer — only if toggle is on
          if (btcConfirmOn && typeof checkBTCConfirmation === 'function') {
            const btcData = await checkBTCConfirmation(sym, tf, result.bias === 'BULL');
            result.btcConfirmed    = btcData.btcConfirmed;
            result.btcRoc          = btcData.btcRoc;
            result.btcReason       = btcData.btcReason;
            result.convictionDelta = btcData.convictionDelta;
          }
          return result;
        })
      );

      for (let j = 0; j < batchResults.length; j++) {
        if (_smcAbort) break;
        scanned++;
        const res = batchResults[j];
        if (res.status === 'fulfilled' && res.value) {
          qualified++;
          _smcResults.push(res.value);
          smcInsertRow(res.value);
        } else {
          ignored++;
        }
        const progress = Math.round((scanned / total) * 100);
        smcUpdateStats(total, scanned, qualified, ignored, progress);
      }

      // Small yield between batches
      await new Promise(r => setTimeout(r, 60));
    }

    if (_smcAbort) {
      smcSetStatus(`Scan stopped — ${scanned}/${total} scanned · ${qualified} qualified`);
    } else {
      smcSetStatus(`Scan complete — ${total} coins · ${qualified} qualified · ${ignored} ignored`);
      smcUpdateStats(total, scanned, qualified, ignored, 100);
    }

    if (qualified === 0) {
      document.getElementById('smc-tbody').innerHTML = `
        <tr><td colspan="12" style="text-align:center;padding:32px;color:var(--muted);font-size:9px;letter-spacing:0.1em">
          NO COINS REACHED ${minChecks}/7 CHECKS ON ${tf.toUpperCase()} — TRY LOWERING THE MIN CHECKS OR SWITCHING TIMEFRAME
        </td></tr>`;
    }

  } catch(e) {
    smcSetStatus('ERROR: ' + e.message);
    console.error('[SMC Scanner]', e);
  } finally {
    _smcRunning = false;
    document.getElementById('smcScanBtn').disabled      = false;
    document.getElementById('smcStopBtn').style.display = 'none';
  }
}

// ── ALL EVENT WIRING — deferred until DOM is ready ────────────
document.addEventListener('DOMContentLoaded', () => {

  // ── NAV / STAGE SWITCHING ──
  // ── NAV uses central switchToStage from ui.js ──
  document.getElementById('rail-smc-scanner').addEventListener('click', () => {
    switchToStage('stage-smc-scanner', 'rail-smc-scanner');
  });

  // ── SCAN CONTROLS ──
  document.getElementById('smcScanBtn').addEventListener('click', runSMCScan);
  document.getElementById('smcStopBtn').addEventListener('click', () => {
    _smcAbort = true;
    smcSetStatus('Stopping...');
  });

// ═══════════════════════════════════════════════════════════════
// SMC SCANNER HELP MODAL
// ═══════════════════════════════════════════════════════════════
const SMC_HELP_CONTENT = {

  what: `
    <div class="hm-section-title">What is the SMC Confluence Scanner?</div>
    <div class="hm-def">
      <div class="hm-def-key">Purpose</div>
      <div class="hm-def-val">This scanner automatically checks <b>every USDT perpetual futures coin on Binance</b> and finds the ones where multiple Smart Money signals are aligned at the same time. Instead of manually checking hundreds of charts, the scanner does it for you in minutes.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">How it works</div>
      <div class="hm-def-val">For each coin, the scanner runs <b>7 SMC checks</b> — the exact same checks shown in the SMC Confluence Checklist on the Analysis page. If a coin passes at least your chosen minimum (default 4 out of 7), it appears in the results table. Everything else is ignored.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">Direction (Bias)</div>
      <div class="hm-def-val">The scanner determines each coin's direction using a <b>weighted voting system</b> — SuperTrend, price zone, structure, RSI, TQI, funding rate, and L/S ratio all vote. The winning side (BULL or BEAR) is the direction the checks are then evaluated against. This matches exactly what the Analysis page does.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">Smart Filtering</div>
      <div class="hm-def-val">To keep the scan fast, the scanner first runs the 5 structure checks (no extra API calls). Only coins that could possibly reach your minimum threshold then fetch the 2 derivatives checks (funding rate and L/S ratio). Coins with no chance of qualifying are skipped early.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">Results</div>
      <div class="hm-def-val">Qualified coins appear in the table sorted by score — <b>7/7 at the top, 4/7 at the bottom</b>. Each row shows the coin's price, which checks passed, the total score, and the bias direction. Clicking any row or the ANALYSE → button takes you straight to the full analysis for that coin.</div>
    </div>
    <div class="hm-note">💡 The scanner and Analysis page use identical logic. A coin showing BULL 5/7 in the scanner will show the same 5 aligned checks when you click ANALYSE →.</div>
  `,

  howto: `
    <div class="hm-section-title">Step-by-step: Running a scan</div>
    <div class="hm-def">
      <div class="hm-def-key">Step 1 — Pick a Timeframe</div>
      <div class="hm-def-val">Use the <b>TF</b> dropdown to select the timeframe you want to trade. <b>4H or 1D</b> are recommended for swing trades and give cleaner signals. 1H works for intraday. 5m and 15m will return more results but with more noise.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">Step 2 — Set Min Checks</div>
      <div class="hm-def-val">Use <b>MIN CHECKS</b> to control how strict the filter is. <b>4/7</b> = more results, some are borderline setups. <b>5/7</b> = good balance of quality and quantity. <b>6/7 or 7/7</b> = only the highest confluence setups, fewer results but highest quality.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">Step 3 — Hit SCAN MARKET</div>
      <div class="hm-def-val">The scanner fetches all trading coins from Binance, then processes them in batches. You can watch the <b>SCANNED</b> and <b>QUALIFIED</b> counters update live as results come in. The green progress bar shows how far through the scan you are.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">Step 4 — Review the Table</div>
      <div class="hm-def-val">Results appear as they qualify — no need to wait for the full scan to finish. Coins are sorted by score. Focus on the <b>highest scores first</b> and check that the ✓ marks align with what you're looking for (bull or bear setup).</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">Step 5 — Open Full Analysis</div>
      <div class="hm-def-val">Click any row or the <b>ANALYSE →</b> button to jump straight to the full Analysis page for that coin. The chart, trade scenarios, and SMC checklist will all load automatically — and will match what the scanner found.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">Stop a Scan</div>
      <div class="hm-def-val">Hit the <b>■ STOP</b> button at any time. Results collected so far are kept in the table. You don't lose anything — you can review what's already there.</div>
    </div>
    <div class="hm-section-title">Tips</div>
    <div class="hm-def">
      <div class="hm-def-key">Best timeframe</div>
      <div class="hm-def-val">Start with <b>4H at 5/7</b>. This gives high-quality swing setups without too many results to review.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">Run it again</div>
      <div class="hm-def-val">Market conditions change. Re-run the scan after major price moves or at key session opens (London / New York) for fresh signals.</div>
    </div>
    <div class="hm-note">💡 Don't trade every result. The scanner finds candidates — use the full Analysis page to confirm entry, stop loss, and risk-reward before taking any position.</div>
  `,

  checks: `
    <div class="hm-section-title">The 7 SMC Confluence Checks</div>
    <div class="hm-def">
      <div class="hm-def-key">ST — SuperTrend</div>
      <div class="hm-def-val"><b>✓ ALIGNED</b> means the SuperTrend indicator agrees with the coin's bias direction. For a BULL setup: SuperTrend must be green (price above the trend line). For a BEAR setup: SuperTrend must be red (price below the trend line). This is the primary trend filter — if it's against you, the trade is fighting the trend.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">ZONE — Price Zone</div>
      <div class="hm-def-val"><b>✓ ALIGNED</b> means price is in the right zone for the trade direction. For a BULL setup: price must be in the <b>Discount Zone</b> (bottom 25% of the swing range) — this is where you want to buy cheap. For a BEAR setup: price must be in the <b>Premium Zone</b> (top 25% of the swing range) — this is where you want to sell expensive. Buying at a discount and selling at a premium is a core SMC principle.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">BOS — Break of Structure / CHoCH</div>
      <div class="hm-def-val"><b>✓ ALIGNED</b> means there has been a recent structural break in the bias direction. A <b>BOS (Break of Structure)</b> means the trend continued — a prior high (bullish) or low (bearish) was broken with a candle close. A <b>CHoCH (Change of Character)</b> means the first sign of a trend flip. Either confirms that price is actually moving in your direction rather than just being in a zone.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">RSI — RSI Aligned</div>
      <div class="hm-def-val"><b>✓ ALIGNED</b> means RSI (14) is in a favourable range. For BULL setups: RSI must be <b>below 55</b> — not overbought, room to move up. For BEAR setups: RSI must be <b>above 45</b> — not oversold, room to move down. An RSI already stretched in your direction means there's less fuel left for the move.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">TQI — Trend Quality Index</div>
      <div class="hm-def-val"><b>✓ ALIGNED</b> means TQI is above 0.5. TQI measures how clean and consistent the trend is — combining efficiency ratio (how directly price is moving), price position within the range, and momentum alignment. <b>Above 0.5 = the trend has enough quality to trade.</b> Below 0.5 = choppy, unclear direction — signals are unreliable.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">FUND — Funding Rate Edge</div>
      <div class="hm-def-val"><b>✓ ALIGNED</b> means the funding rate gives an edge in the trade direction. For BULL setups: funding rate must be <b>negative</b> (shorts are paying longs — bearish crowd is trapped, potential squeeze up). For BEAR setups: funding rate must be <b>positive above 0.02%</b> (longs are paying — bullish crowd is over-leveraged, potential flush down). A favourable funding rate means the derivatives market is positioned against your trade direction — which is where reversals come from.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">L/S — Long/Short Position</div>
      <div class="hm-def-val"><b>✓ ALIGNED</b> means the crowd is positioned on the wrong side, creating fuel for your trade. For BULL setups: L/S ratio must be <b>below 0.8</b> (too many shorts — a short squeeze could drive price up). For BEAR setups: L/S ratio must be <b>above 1.2</b> (too many longs — long liquidations could drive price down). Extreme crowd positioning at key levels often signals an incoming move in the opposite direction.</div>
    </div>
    <div class="hm-note">💡 No single check is enough on its own. The more checks aligned, the stronger the confluence. A 6/7 or 7/7 coin has multiple independent signals all pointing the same way — that's rare and worth attention.</div>
  `,

  results: `
    <div class="hm-section-title">Reading the results table</div>
    <div class="hm-def">
      <div class="hm-def-key">COIN / PRICE</div>
      <div class="hm-def-val">The base asset symbol and its current price at the time of scanning. All coins are USDT perpetual futures on Binance. Price is the last close from the selected timeframe's most recent candle.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">Check columns (ST · ZONE · BOS · RSI · TQI · FUND · L/S)</div>
      <div class="hm-def-val"><b>✓ (green)</b> = that check is ALIGNED for the coin's bias direction. <b>· (grey dot)</b> = that check is NEUTRAL — not aligned. Each check is evaluated relative to the coin's determined bias (BULL or BEAR), so a ✓ means something different for a bull coin vs a bear coin. See the "The 7 Checks" tab for exactly what each one means.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">SCORE</div>
      <div class="hm-def-val">How many of the 7 checks are aligned. <b style="color:var(--green)">7/7 or 6/7</b> = exceptional confluence, rare and high quality. <em style="color:var(--gold)">5/7</em> = strong setup, worth analysing. <em>4/7</em> = minimum threshold, treat with more caution and verify on the Analysis page before acting.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">BIAS</div>
      <div class="hm-def-val"><b>▲ BULL</b> (green) means the weighted signal vote determined this coin is in a bullish setup — the checks are evaluated for a potential long trade. <b>▼ BEAR</b> (red) means bearish — the checks are for a potential short trade. This is not a trade recommendation — it's the direction that has the most confluence signals aligned.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">ANALYSE →</div>
      <div class="hm-def-val">Clicking this button (or anywhere on the row) opens the full Analysis page for that coin, pre-loaded with the same timeframe. The chart, derivatives data, order blocks, trade scenarios, and SMC checklist will all load — and the checklist will show the same aligned checks as the scanner.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">Sort order</div>
      <div class="hm-def-val">Results are always sorted by score — highest confluence first. Within the same score, coins appear in the order they were scanned. Re-running the scan resets the table.</div>
    </div>
    <div class="hm-section-title">Stats bar</div>
    <div class="hm-def">
      <div class="hm-def-key">Exchange Coins</div>
      <div class="hm-def-val">Total number of active USDT perpetual futures found on Binance at the time of scanning. This changes as Binance lists or delists contracts.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">Scanned</div>
      <div class="hm-def-val">How many coins have been processed so far. Updates live during the scan.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">Qualified</div>
      <div class="hm-def-val">Coins that passed your minimum check threshold and appear in the table.</div>
    </div>
    <div class="hm-def">
      <div class="hm-def-key">Ignored</div>
      <div class="hm-def-val">Coins that did not reach the minimum checks — either failed the structure filter early or had fewer aligned checks than your minimum after full evaluation.</div>
    </div>
    <div class="hm-note">💡 A coin appearing here does NOT mean enter immediately. It means conditions are aligned. Always check the full Analysis page, verify the trade scenario, and confirm entry, stop loss, and risk-reward before taking any position.</div>
  `
};

function renderSMCHelp(tab) {
  document.getElementById('smc-hm-body').innerHTML = SMC_HELP_CONTENT[tab] || '';
  document.querySelectorAll('#smc-hm-tabs .hm-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.smctab === tab)
  );
}

  // ── SMC HELP MODAL EVENTS ──
  document.getElementById('smcHelpBtn').addEventListener('click', () => {
    document.getElementById('smc-help-overlay').classList.add('open');
    document.getElementById('smcHelpBtn').classList.add('active');
    renderSMCHelp('what');
  });

  document.getElementById('smc-hm-close').addEventListener('click', () => {
    document.getElementById('smc-help-overlay').classList.remove('open');
    document.getElementById('smcHelpBtn').classList.remove('active');
  });

  document.getElementById('smc-help-overlay').addEventListener('click', function(e) {
    if (e.target === this) {
      this.classList.remove('open');
      document.getElementById('smcHelpBtn').classList.remove('active');
    }
  });

  document.querySelectorAll('#smc-hm-tabs .hm-tab').forEach(tab => {
    tab.addEventListener('click', () => renderSMCHelp(tab.dataset.smctab));
  });

}); // end DOMContentLoaded
