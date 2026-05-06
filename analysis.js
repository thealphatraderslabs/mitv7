// ═══════════════════════════════════════════════════════════════
// FORMATTERS
// ═══════════════════════════════════════════════════════════════
function fmtPrice(p) {
  if (!p || isNaN(p)) return '—';
  if (p >= 10000) return p.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});
  if (p >= 1)     return p.toFixed(4);
  if (p >= 0.01)  return p.toFixed(5);
  return p.toFixed(7);
}
function fmtPct(p) {
  if (!p || isNaN(p)) return '—';
  return (p >= 0 ? '+' : '') + p.toFixed(2) + '%';
}
function fmtCompact(n) {
  if (!n || isNaN(n)) return '—';
  if (n >= 1e12) return (n/1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n/1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return (n/1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}

// ═══════════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════════
function setStatus(msg, state = 'idle') {
  document.getElementById('statusMsg').textContent = msg;
  document.getElementById('global-status-text').textContent = msg.length > 30 ? state.toUpperCase() : msg;
  const dot = document.getElementById('global-status-dot');
  dot.className = 'status-dot';
  if (state === 'loading') dot.classList.add('scanning');
  else if (state === 'ok')  dot.classList.add('online');
  else if (state === 'err') dot.classList.add('error');
}

// ═══════════════════════════════════════════════════════════════
// UI UPDATERS
// ═══════════════════════════════════════════════════════════════
function updatePriceHeader(ticker, ticker24h, candles, stData, er, tqi, rsi) {
  const n = candles.length;
  const lastClose = candles[n-1].close;
  const stTrend = stData.trend[n-1];
  const vol = parseFloat(ticker24h?.quoteVolume || 0);

  document.getElementById('h-ticker').textContent = ticker + 'USDT';
  document.getElementById('h-price').textContent = fmtPrice(lastClose);

  const chg = parseFloat(ticker24h?.priceChangePercent || 0);
  const chgEl = document.getElementById('h-change');
  chgEl.textContent = fmtPct(chg) + ' (24H)';
  chgEl.className = 'ph-change ' + (chg >= 0 ? 'up' : 'down');

  document.getElementById('h-high').textContent = fmtPrice(parseFloat(ticker24h?.highPrice||lastClose));
  document.getElementById('h-high').className = 'ph-stat-val up';
  document.getElementById('h-low').textContent = fmtPrice(parseFloat(ticker24h?.lowPrice||lastClose));
  document.getElementById('h-low').className = 'ph-stat-val down';
  document.getElementById('h-vol').textContent = fmtCompact(vol);

  const stEl = document.getElementById('h-st');
  stEl.textContent = stTrend===1 ? 'BULLISH ▲' : 'BEARISH ▼';
  stEl.className = 'ph-stat-val ' + (stTrend===1?'up':'down');

  const erEl = document.getElementById('h-er');
  erEl.textContent = er.toFixed(3) + (er>0.5?' TRENDING':er>0.25?' MIXED':' CHOPPY');
  erEl.className = 'ph-stat-val ' + (er>0.5?'up':er>0.25?'warn':'down');

  const tqiEl = document.getElementById('h-tqi');
  tqiEl.textContent = tqi.toFixed(3) + (tqi>0.65?' HIGH':tqi>0.35?' MED':' LOW');
  tqiEl.className = 'ph-stat-val ' + (tqi>0.65?'up':tqi>0.35?'warn':'down');

  const rsiEl = document.getElementById('h-rsi');
  if (rsi !== null) {
    rsiEl.textContent = rsi.toFixed(1) + (rsi>70?' OB':rsi<30?' OS':'');
    rsiEl.className = 'ph-stat-val ' + (rsi>65?'down':rsi<35?'up':'');
  }

  let bullSMC=0, bearSMC=0;
  if (stTrend===1) bullSMC+=20; else bearSMC+=20;
  if (rsi) { if (rsi<40) bullSMC+=10; else if (rsi>65) bearSMC+=10; else if (rsi<52) bullSMC+=5; else bearSMC+=5; }
  if (tqi>0.5 && stTrend===1) bullSMC+=10; else if (tqi>0.5 && stTrend===-1) bearSMC+=10;
  if (er>0.4 && stTrend===1) bullSMC+=10; else if (er>0.4 && stTrend===-1) bearSMC+=10;
  const totalBias = bullSMC+bearSMC || 1;
  const bullBiasP = Math.round(bullSMC/totalBias*100);
  const biasEl = document.getElementById('h-bias');
  const biasConf = document.getElementById('h-bias-conf');
  const _hConfScore = Math.min(100, Math.round(Math.max(bullBiasP, 100-bullBiasP) * 0.8 + (er > 0.4 ? 10 : 0) + (tqi > 0.5 ? 10 : 0)));
  const _hConfLabel = UI.confidenceLabel(_hConfScore);
  const _hConfColorVal = UI.confidenceColor(_hConfScore);
  if (bullBiasP >= 62) {
    biasEl.textContent='BULLISH'; biasEl.className='ph-bias-val bullish';
    biasConf.textContent=`Confidence: ${_hConfScore}% (${_hConfLabel})`;
    biasConf.style.color = _hConfColorVal;
  } else if (bullBiasP <= 38) {
    biasEl.textContent='BEARISH'; biasEl.className='ph-bias-val bearish';
    biasConf.textContent=`Confidence: ${_hConfScore}% (${_hConfLabel})`;
    biasConf.style.color = _hConfColorVal;
  } else {
    biasEl.textContent='NEUTRAL'; biasEl.className='ph-bias-val neutral';
    biasConf.textContent=`Low Confidence — ${bullBiasP}/${100-bullBiasP}`;
    biasConf.style.color = 'var(--muted)';
  }
}

function updateDerivatives(ticker, funding, oi, ls, lsTop, bybit, gecko) {
  const fr = parseFloat(funding?.fundingRate||0)*100;
  const frEl = document.getElementById('d-funding');
  frEl.textContent = fr.toFixed(4)+'%';
  frEl.className = 'deriv-val '+(fr>0.03?'down':fr<-0.01?'up':'warn');

  if (funding?.nextFundingTime) {
    const next = new Date(parseInt(funding.nextFundingTime));
    const diff = Math.max(0, next-Date.now());
    const hrs=Math.floor(diff/3600000), mins=Math.floor((diff%3600000)/60000);
    document.getElementById('d-funding-t').textContent=`${hrs}h ${mins}m`;
  }
  if (oi) {
    const oiPrice = parseFloat(oi.openInterestValue||oi.openInterest||0);
    document.getElementById('d-oi').textContent = fmtCompact(oiPrice)+' USDT';
    const lsR = ls ? parseFloat(ls.longShortRatio || 1) : 1;
    const oiBar = Math.min(100, Math.max(0, (lsR / (lsR + 1)) * 100));
    document.getElementById('d-oi-bar').style.width = oiBar+'%';
  }
  if (ls) {
    const lsRatio = parseFloat(ls.longShortRatio||1);
    const longPct = parseFloat(ls.longAccount||0)*100;
    const lsEl = document.getElementById('d-ls');
    lsEl.textContent = lsRatio.toFixed(3);
    lsEl.className = 'deriv-val '+(lsRatio>1.2||lsRatio<0.8?'warn':'');
    document.getElementById('d-ls-bar').style.width = longPct+'%';
    document.getElementById('d-ls-long-pct').textContent = 'LONG '+longPct.toFixed(1)+'%';
    document.getElementById('d-ls-short-pct').textContent = 'SHORT '+(100-longPct).toFixed(1)+'%';
  }
  if (lsTop) {
    const top = parseFloat(lsTop.longShortRatio||1);
    const tEl = document.getElementById('d-ls-top');
    tEl.textContent=top.toFixed(3);
    tEl.className='deriv-val '+(top>1.2||top<0.8?'warn':'');
  }
  if (oi) {
    const liqLevels=[
      {label:'+2%',val:0.7,type:'short'},
      {label:'+1%',val:0.55,type:'short'},
      {label:'-1%',val:0.6,type:'long'},
      {label:'-2%',val:0.75,type:'long'},
      {label:'-5%',val:0.4,type:'long'}
    ];
    document.getElementById('liq-container').innerHTML =
      `<div style="font-size:8px;color:var(--muted);letter-spacing:0.08em;margin-bottom:4px;text-align:right">⚠ ILLUSTRATIVE — NOT LIVE DATA</div>` +
      liqLevels.map(l=>`
        <div class="liq-row">
          <span class="liq-tag">${l.label}</span>
          <div class="liq-bar-track"><div class="liq-bar-fill ${l.type}" style="width:${l.val*100}%"></div></div>
          <span class="liq-val">${l.type==='long'?'<span style="color:var(--red)">LONG</span>':'<span style="color:var(--green)">SHORT</span>'}</span>
        </div>`).join('');
  }
  if (bybit) {
    document.getElementById('d-bybit-price').textContent = fmtPrice(parseFloat(bybit.lastPrice||0));
    document.getElementById('d-bybit-vol').textContent = fmtCompact(parseFloat(bybit.volume24h||0));
  }
  if (gecko) {
    const d = gecko.market_data;
    document.getElementById('d-rank').textContent='#'+(gecko.market_cap_rank||'—');
    document.getElementById('d-fdv').textContent=fmtCompact(d?.fully_diluted_valuation?.usd);
    document.getElementById('h-mcap').textContent=fmtCompact(d?.market_cap?.usd);
    const sent = gecko.sentiment_votes_up_percentage;
    const sentEl = document.getElementById('d-sentiment');
    if (sent) { sentEl.textContent=sent.toFixed(1)+'% BULLISH'; sentEl.className='deriv-val '+(sent>60?'up':sent<40?'down':'warn'); }
    const ath = d?.ath_change_percentage?.usd;
    if (ath) { const athEl=document.getElementById('d-ath'); athEl.textContent=fmtPct(ath)+' FROM ATH'; athEl.className='deriv-val '+(ath>-10?'up':'warn'); }
  }
}

function updateStructure(candles, stData, swings, fvgs, tf) {
  const n = candles.length;
  const lastTrend = stData.trend[n-1];
  const stLine = stData.stLine[n-1];
  const lastClose = candles[n-1].close;
  document.getElementById('struct-tf-label').textContent = tf.toUpperCase()+' TIMEFRAME';

  const tEl = document.getElementById('s-trend');
  tEl.textContent = lastTrend===1 ? '▲ BULLISH' : '▼ BEARISH';
  tEl.style.color = lastTrend===1 ? 'var(--green)' : 'var(--red)';
  document.getElementById('s-trend-sub').textContent='ST LINE: '+fmtPrice(stLine);

  const { highs, lows } = swings;
  const lastSH = highs.length>0 ? highs[highs.length-1] : null;
  const lastSL = lows.length>0  ? lows[lows.length-1]   : null;
  if (lastSH) {
    document.getElementById('s-sh').textContent=fmtPrice(lastSH.price);
    document.getElementById('s-sh').style.color='var(--red)';
    const dist=((lastSH.price-lastClose)/lastClose*100).toFixed(2);
    document.getElementById('s-sh-sub').textContent='+'+dist+'% FROM PRICE';
  }
  if (lastSL) {
    document.getElementById('s-sl').textContent=fmtPrice(lastSL.price);
    document.getElementById('s-sl').style.color='var(--green)';
    const dist=((lastClose-lastSL.price)/lastClose*100).toFixed(2);
    document.getElementById('s-sl-sub').textContent='-'+dist+'% FROM PRICE';
  }
  // FIX 9: run both structure layers for display
  const internalStruct = detectStructure(candles, highs, lows);
  const swingSwings50  = findSwings(candles, 50);
  const swingStruct    = detectStructure(candles, swingSwings50.highs, swingSwings50.lows);

  // Prefer swing struct event for display; fall back to internal
  const displayStruct = swingStruct.events.length > 0 ? swingStruct : internalStruct;
  const isSwingLevel  = swingStruct.events.length > 0;

  if (displayStruct.events.length > 0) {
    const ev = displayStruct.events[0];
    const sEl = document.getElementById('s-struct');
    // FIX 9: tag label shows SWING or INT layer prefix so user knows which layer fired
    const layerPrefix = isSwingLevel ? '' : '<span style="font-size:7px;color:var(--muted);margin-right:3px">INT</span>';
    sEl.innerHTML = layerPrefix + `<span class="tag ${ev.dir==='bull'?'bos':'choch'}">${ev.label}</span>`;
    document.getElementById('s-struct-sub').textContent = 'LEVEL: ' + fmtPrice(ev.level);
  }
  if (lastSH && lastSL) {
    const rng=lastSH.price-lastSL.price;
    const prem=lastSH.price-rng*0.25, disc=lastSL.price+rng*0.25;
    document.getElementById('s-prem').textContent=fmtPrice(prem);
    document.getElementById('s-prem').style.color=lastClose>prem?'var(--gold)':'var(--sub)';
    document.getElementById('s-disc').textContent=fmtPrice(disc);
    document.getElementById('s-disc').style.color=lastClose<disc?'var(--gold)':'var(--sub)';
  }
  const recentFvgs = fvgs.slice(-6);
  document.getElementById('fvg-count').textContent=recentFvgs.length+' DETECTED';
  if (recentFvgs.length===0) {
    document.getElementById('fvg-list').innerHTML='<div class="empty-state" style="height:36px;font-size:8px">NO FVG DETECTED</div>';
  } else {
    document.getElementById('fvg-list').innerHTML=recentFvgs.map(g=>`
      <div class="fvg-item">
        <span class="fvg-tag" style="color:${g.type==='bull'?'var(--green)':'var(--red)'}">${g.type==='bull'?'BFVG':'SFVG'}</span>
        <span class="fvg-range">${fmtPrice(g.bottom)} → ${fmtPrice(g.top)}</span>
        <span class="fvg-status" style="color:${g.filled?'var(--muted)':'var(--gold)'}">${g.filled?'FILLED':'OPEN'}</span>
      </div>`).join('');
  }
}

function updateMultiTF(multiTFCandles, currentTF) {
  const rows=[];
  const tfs=['15m','1h','4h','1d','1w'];
  const labels={'15m':'15M','1h':'1H','4h':'4H','1d':'1D','1w':'1W'};
  for (const tf of tfs) {
    const candles=multiTFCandles[tf];
    if (!candles||candles.length<20) { rows.push(`<tr><td>${labels[tf]}</td><td colspan="4"><span style="color:var(--muted)">NO DATA</span></td></tr>`); continue; }
    const st=calcSuperTrend(candles);
    const nc=candles.length;
    const trend=st.trend[nc-1];
    const sw=findSwings(candles, 5);
    // FIX 9: swing-level struct (50-bar) for MTF table — shows major BOS/CHoCH per TF
    const swSw=findSwings(candles, 50);
    const swingStruct=detectStructure(candles, swSw.highs, swSw.lows);
    const struct=swingStruct.events.length>0 ? swingStruct : detectStructure(candles,sw.highs,sw.lows);
    const lastClose=candles[nc-1].close;
    // Key level uses swing-layer extremes for accuracy
    const lastSH=swSw.highs.length>0?swSw.highs[swSw.highs.length-1].price:sw.highs.length>0?sw.highs[sw.highs.length-1].price:null;
    const lastSL=swSw.lows.length>0?swSw.lows[swSw.lows.length-1].price:sw.lows.length>0?sw.lows[sw.lows.length-1].price:null;
    const keyLevel=trend===1?lastSH:lastSL;
    const dist=keyLevel?((keyLevel-lastClose)/lastClose*100).toFixed(2):'—';
    const distStr=keyLevel?(parseFloat(dist)>0?'+'+dist:dist)+'%':'—';
    const isCurrent=tf===currentTF;
    const trendTag=`<span class="tag ${trend===1?'bull':'bear'}">${trend===1?'BULL':'BEAR'}</span>`;
    let structTag='<span class="tag neutral">—</span>';
    if (struct.events.length>0) structTag=`<span class="tag ${struct.events[0].dir==='bull'?'bos':'choch'}">${struct.events[0].label}</span>`;
    rows.push(`<tr style="${isCurrent?'background:var(--green-glow)':''}">
      <td style="${isCurrent?'color:var(--green);font-weight:600':''}">${labels[tf]}${isCurrent?' ◀':''}</td>
      <td>${trendTag}</td><td>${structTag}</td>
      <td>${keyLevel?fmtPrice(keyLevel):'—'}</td>
      <td style="color:${parseFloat(dist)>0?'var(--red)':'var(--green)'}">${distStr}</td>
    </tr>`);
  }
  document.getElementById('mtf-tbody').innerHTML=rows.join('');
}

function updateSRLevels(srLevels) {
  const top=srLevels.slice(0,10);
  if (!top.length) return;
  document.getElementById('sr-levels').innerHTML=top.map(l=>`
    <div class="level-cell">
      <div class="level-cell-label">${l.type==='R'?'RESISTANCE':'SUPPORT'} ×${l.touches}</div>
      <div class="level-cell-price" style="color:${l.zone==='resistance'?'var(--red)':l.zone==='support'?'var(--green)':'var(--gold)'}">${fmtPrice(l.price)}</div>
      <div class="level-cell-note">${l.dist>0?'+':''}${l.dist.toFixed(2)}% FROM PRICE</div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════════
// TRADE IDEAS GENERATOR
// ═══════════════════════════════════════════════════════════════
function generateTradeIdeas(candles, stData, swings, fvgs, srLevels, rsi, er, tqi, currentPrice, derivData) {
  const n = candles.length;
  const lastTrend = stData.trend[n-1] || 1;
  const atrs = calcATR(candles, 14);
  const atr = atrs[atrs.length-1] || currentPrice * 0.015;
  const { highs: intHighs, lows: intLows } = swings;
  // FIX 9: use swing-layer (50-bar) extremes for zone + range calculations
  // Internal 5-bar pivots produce noisy lastSH/lastSL → wrong premium/discount
  const swingSwingsGTI = findSwings(candles, 50);
  const swHighs = swingSwingsGTI.highs.length > 0 ? swingSwingsGTI.highs : intHighs;
  const swLows  = swingSwingsGTI.lows.length  > 0 ? swingSwingsGTI.lows  : intLows;
  const lastSH = swHighs[swHighs.length-1].price;
  const lastSL = swLows[swLows.length-1].price;
  const effectiveSH = Math.max(lastSH, currentPrice);
  const effectiveSL = Math.min(lastSL, currentPrice);
  const rng    = effectiveSH-effectiveSL || currentPrice*0.05;
  const premium  = effectiveSH-rng*0.25;
  const discount = effectiveSL+rng*0.25;
  const equil    = (effectiveSH+effectiveSL)/2;
  const inPremium  = currentPrice > premium;
  const inDiscount = currentPrice < discount;
  const nearR = srLevels.find(l=>l.zone==='resistance');
  const nearS = srLevels.find(l=>l.zone==='support');
  const rTarget = nearR ? nearR.price : currentPrice*1.03;
  const sTarget = nearS ? nearS.price : currentPrice*0.97;
  const lsRatio = derivData.lsRatio||1;
  const funding  = derivData.funding||0;

  let bullSMC=0, bearSMC=0;
  if (lastTrend===1) bullSMC+=20; else bearSMC+=20;
  if (inDiscount) {
    const pts = (lastTrend === -1) ? 10 : 20;
    bullSMC += pts;
  } else if (inPremium) {
    const pts = (lastTrend === 1) ? 10 : 20;
    bearSMC += pts;
  } else {
    bullSMC += 8; bearSMC += 8;
  }
  // FIX 9: swing-level struct for BOS/CHoCH vote — major breaks drive bias
  const swingStructGTI  = detectStructure(candles, swHighs, swLows);
  const internalStructGTI = detectStructure(candles, intHighs, intLows);
  const struct = swingStructGTI.events.length > 0 ? swingStructGTI : internalStructGTI;
  // Swing range uses swing-layer extremes
  const swingRange = lastSH - lastSL || currentPrice * 0.05;
  const swingPos   = swingRange > 0 ? (currentPrice - lastSL) / swingRange : 0.5;

  if (struct.events.length>0) { if (struct.events[0].dir==='bull') bullSMC+=20; else bearSMC+=20; }
  if (rsi) { if (rsi<40) bullSMC+=10; else if (rsi>65) bearSMC+=10; else if (rsi<52) bullSMC+=5; else bearSMC+=5; }
  if (tqi>0.5&&lastTrend===1) bullSMC+=10; else if (tqi>0.5&&lastTrend===-1) bearSMC+=10;
  if (funding>0.05) bearSMC+=10; else if (funding>0.02) bearSMC+=5; else if (funding<-0.01) bullSMC+=10;
  if (lsRatio>1.3) bearSMC+=10; else if (lsRatio>1.1) bearSMC+=5; else if (lsRatio<0.8) bullSMC+=10; else if (lsRatio<0.9) bullSMC+=5;

  const totalScore = bullSMC+bearSMC || 1;
  const bullPct = Math.round(bullSMC/totalScore*100);
  const primaryDir = bullSMC>=bearSMC ? 'LONG' : 'SHORT';
  const tradesBias = primaryDir === 'LONG' ? 'bullish' : 'bearish';
  const isBullTrade = tradesBias === 'bullish' || tradesBias === 'bullish_transition';
  const isBearTrade = tradesBias === 'bearish' || tradesBias === 'bearish_transition';
  const last5closes = candles.slice(-5).map(c => c.close);
  const mean5 = last5closes.reduce((a,b)=>a+b,0) / 5;
  const tradeHasPullback = isBullTrade
    ? (last5closes[0] > mean5 && last5closes[4] < mean5)
    : (last5closes[0] < mean5 && last5closes[4] > mean5);
  const _tradeCtx = {
    swingPos, isBull: isBullTrade, isBear: isBearTrade,
    hasFreshPullback: tradeHasPullback, bias: tradesBias
  };
  const _tradeEQ = calculateEntryQuality(_tradeCtx);

  const _biasCheck = DECISION.checkBiasConflict(tradesBias, struct);
  const tradeRejected = !_biasCheck.valid;
  const _tradeDecision = { valid: _biasCheck.valid, reason: _biasCheck.reason, penalty: _biasCheck.penalty };

  const _structWeight  = 0.40;
  const _locationWeight= 0.25;
  const _momentumWeight= 0.30;
  const _derivWeight   = 0.05;
  const _structConf  = struct.events.length > 0 ? (struct.events[0].dir === (primaryDir==='LONG'?'bull':'bear') ? 1.0 : 0.3) : 0.5;
  const _locationConf= primaryDir==='LONG' ? (inDiscount?1.0:inPremium?0.1:0.5) : (inPremium?1.0:inDiscount?0.1:0.5);
  const _momentumConf= primaryDir==='LONG'
    ? (lastTrend===1 ? (tqi>0.5?1.0:0.65) : 0.2)
    : (lastTrend===-1? (tqi>0.5?1.0:0.65): 0.2);
  const _hasStructConf = struct.events.length > 0;
  const _derivConf = _hasStructConf
    ? (primaryDir==='LONG'
        ? (funding<-0.01?1.0:funding>0.05?0.1:0.5) * (lsRatio<0.85?1.0:lsRatio>1.3?0.2:0.6)
        : (funding>0.03?1.0:funding<-0.02?0.1:0.5) * (lsRatio>1.3?1.0:lsRatio<0.85?0.2:0.6))
    : 0.5;
  const _rawScore = Math.round(
    (_structConf*_structWeight + _locationConf*_locationWeight + _momentumConf*_momentumWeight + _derivConf*_derivWeight) * 100
  );
  const weightedScore = tradeRejected ? 0 : _rawScore;
  const confidenceLabel = weightedScore > 75 ? 'High' : weightedScore >= 55 ? 'Medium' : 'Low';
  const confPips = tradeRejected ? 0 : Math.min(8, Math.round(Math.max(bullPct,100-bullPct)/12.5));

  // Long entry
  const bullFVGs = fvgs ? fvgs.filter(g => !g.filled && g.type === 'bull' && (g.top+g.bottom)/2 < currentPrice) : [];
  const nearestBullFVG = bullFVGs.length > 0 ? bullFVGs[bullFVGs.length-1] : null;
  let longEntry, longEntryReason;
  if (nearestBullFVG) {
    longEntry = (nearestBullFVG.top + nearestBullFVG.bottom) / 2;
    longEntryReason = 'FVG MID';
  } else if (inDiscount || currentPrice <= discount + atr * 0.3) {
    longEntry = discount;
    longEntryReason = 'DISCOUNT BOUNDARY';
  } else {
    longEntry = Math.max(discount, currentPrice - atr * 0.75);
    longEntryReason = 'ATR PULLBACK ZONE';
  }
  if (longEntry > currentPrice) {
    longEntry = currentPrice - atr * 0.5;
    longEntryReason = 'ATR PULLBACK ZONE';
  }
  const longSL     = Math.min(effectiveSL - atr * 0.5, longEntry - atr);
  const longTP1raw  = equil;
  const longTP1     = Math.max(longTP1raw, longEntry + atr * 0.5);
  const rawLongTP2 = rTarget > longTP1 ? rTarget : effectiveSH;
  const longTP2    = rawLongTP2 > longTP1 + atr * 0.5
    ? rawLongTP2
    : longTP1 + atr * 1.0;
  const longRisk   = longEntry - longSL;
  const longRR     = longRisk > 0 ? ((longTP2 - longEntry) / longRisk).toFixed(2) : 'N/A';

  // Short entry
  const bearFVGs = fvgs ? fvgs.filter(g => !g.filled && g.type === 'bear' && (g.top+g.bottom)/2 > currentPrice) : [];
  const nearestBearFVG = bearFVGs.length > 0 ? bearFVGs[0] : null;
  let shortEntry, shortEntryReason;
  if (nearestBearFVG) {
    shortEntry = (nearestBearFVG.top + nearestBearFVG.bottom) / 2;
    shortEntryReason = 'FVG MID';
  } else if (inPremium || currentPrice >= premium - atr * 0.3) {
    shortEntry = premium;
    shortEntryReason = 'PREMIUM BOUNDARY';
  } else {
    shortEntry = Math.min(premium, currentPrice + atr * 0.75);
    shortEntryReason = 'ATR RALLY ZONE';
  }
  if (shortEntry < currentPrice) {
    shortEntry = currentPrice + atr * 0.5;
    shortEntryReason = 'ATR RALLY ZONE';
  }
  const shortSL    = Math.max(effectiveSH + atr * 0.5, shortEntry + atr);
  const shortTP1   = Math.min(equil, shortEntry - atr * 0.5);
  const rawShortTP2 = sTarget < shortTP1 ? sTarget : effectiveSL;
  const shortTP2    = rawShortTP2 < shortTP1 - atr * 0.5
    ? rawShortTP2
    : shortTP1 - atr * 1.0;
  const shortRisk  = shortSL - shortEntry;
  const shortRR    = shortRisk > 0 ? ((shortEntry - shortTP2) / shortRisk).toFixed(2) : 'N/A';

  // Validity
  const longValid =
    currentPrice > longSL   &&
    currentPrice < longTP2;
  const shortValid =
    currentPrice < shortSL  &&
    currentPrice > shortTP2 &&
    !(shortEntry > currentPrice && currentPrice < shortTP1);

  const tqiTxt   = tqi>0.65?'HIGH TQI — strong directional flow':tqi>0.35?'MODERATE TQI — mixed momentum':'LOW TQI — choppy, no clear trend';
  const zoneTxt  = inPremium?'PREMIUM zone':inDiscount?'DISCOUNT zone':'EQUILIBRIUM area';
  const _noBOS = !struct.events || struct.events.length === 0;
  const _noRecentBreak = !struct.recentBOS_up && !struct.recentBOS_down && !struct.recentCHOCH_up && !struct.recentCHOCH_down;
  const marketCompression = _noBOS && _noRecentBreak;
  const structTxt = struct.events && struct.events.length > 0
    ? struct.events[0].label + ' at ' + fmtPrice(struct.events[0].level)
    : marketCompression
      ? 'compression / indecision — no BOS or CHoCH detected'
      : 'no fresh structure break';
  const fundTxt  = Math.abs(funding)<0.01?'neutral funding':funding>0?'funding +'+funding.toFixed(4)+'% (longs paying — bearish pressure)':'funding '+funding.toFixed(4)+'% (shorts paying — bullish pressure)';
  const lsTxt    = lsRatio>1.2?'L/S crowded long — squeeze risk':lsRatio<0.85?'L/S crowded short — relief rally risk':'L/S balanced';
  const counterTxt = primaryDir==='LONG'?'SHORT':'LONG';
  const compressionTxt = marketCompression ? ' CAUTION: No structure break detected — possible chop. Wait for BOS/CHoCH before entry.' : '';

  const primaryLevels = primaryDir==='LONG'
    ? {entry:longEntry,sl:longSL,tp1:longTP1,tp2:longTP2,rr:longRR}
    : {entry:shortEntry,sl:shortSL,tp1:shortTP1,tp2:shortTP2,rr:shortRR};
  const primaryNarr = primaryDir==='LONG'
    ? `Confidence: ${weightedScore}% (${confidenceLabel}) — weighted: Structure(40%) · Location(25%) · Momentum(30%) · Derivatives(5%). Price in ${zoneTxt} — holding in discount after internal shift. ${structTxt}. ${tqiTxt}. RSI ${rsi?rsi.toFixed(1):'—'} — ${rsi<40?'demand holding, high-probability zone.':rsi<55?'room to push higher if demand holds.':'extended — better entry on pullback.'}${compressionTxt} ${fundTxt}. ${lsTxt}. Entry at ${fmtPrice(longEntry)} (${longEntryReason}), SL below swing low ${fmtPrice(longSL)}.`
    : `Confidence: ${weightedScore}% (${confidenceLabel}) — weighted: Structure(40%) · Location(25%) · Momentum(30%) · Derivatives(5%). Price in ${zoneTxt} — rejection likely if distribution holds. ${structTxt}. ${tqiTxt}. RSI ${rsi?rsi.toFixed(1):'—'} — ${rsi>65?'extended, distribution likely.':'needs rejection confirmation at resistance.'}${compressionTxt} ${fundTxt}. ${lsTxt}. Entry at ${fmtPrice(shortEntry)} (${shortEntryReason}), SL above swing high ${fmtPrice(shortSL)}.`;
  const counterLevels = counterTxt==='LONG'
    ? {entry:longEntry,sl:longSL,tp1:longTP1,tp2:longTP2,rr:longRR}
    : {entry:shortEntry,sl:shortSL,tp1:shortTP1,tp2:shortTP2,rr:shortRR};
  const counterNarr = counterTxt==='SHORT'
    ? `Counter-trend SHORT (confidence ${100-weightedScore}% — Low). Valid only on ${inPremium?'rejection candle from premium zone':'CHoCH confirmation on lower TF'}. Entry ${fmtPrice(shortEntry)} (${shortEntryReason}), SL ${fmtPrice(shortSL)}, TP1 ${fmtPrice(shortTP1)}.`
    : `Counter-trend LONG (confidence ${weightedScore}% — Low). Valid only on ${inDiscount?'strong demand reaction at discount zone':'BOS confirmation on lower TF'}. Entry ${fmtPrice(longEntry)} (${longEntryReason}), SL ${fmtPrice(longSL)}, TP1 ${fmtPrice(longTP1)}.`;

  const longEntryDist  = longEntry - currentPrice;
  const _shortDist     = shortEntry - currentPrice;
  const longEntryStatus =
    Math.abs(longEntryDist) <= atr * 0.5 ? 'active'
    : currentPrice > longEntry            ? 'in-trade'
    :                                       'waiting';
  const shortEntryStatus =
    Math.abs(_shortDist) <= atr * 0.5    ? 'active'
    : currentPrice < shortEntry           ? 'in-trade'
    :                                       'waiting';
  const longEntryDistPct  = longEntry > 0  ? ((Math.abs(longEntryDist)  / longEntry)  * 100).toFixed(2) : '0.00';
  const shortEntryDistPct = shortEntry > 0 ? ((_shortDist > 0 ? _shortDist : Math.abs(_shortDist)) / shortEntry * 100).toFixed(2) : '0.00';

  const longStaleReason =
    currentPrice < longSL
      ? `Price dropped below stop-loss (${fmtPrice(longSL)}) — long invalidated.`
      : currentPrice >= longTP2
        ? `TP2 (${fmtPrice(longTP2)}) already hit — full target reached. Wait for new swing.`
        : 'Long scenario no longer actionable.';
  const shortStaleReason =
    currentPrice > shortSL
      ? `Price rallied above stop-loss (${fmtPrice(shortSL)}) — short invalidated.`
      : currentPrice <= shortTP2
        ? `TP2 (${fmtPrice(shortTP2)}) already hit — full target reached. Wait for new swing.`
        : (shortEntry > currentPrice && currentPrice < shortTP1)
          ? `Price (${fmtPrice(currentPrice)}) already below TP1 (${fmtPrice(shortTP1)}) without entry triggering — short opportunity passed.`
          : 'Short scenario no longer actionable.';

  return {
    primaryDir, confPips, bullPct, weightedScore, confidenceLabel,
    primaryLevels, primaryNarr, counterTxt, counterLevels, counterNarr,
    atr, longEntryReason, shortEntryReason, currentPrice,
    tradeRejected, tradeDecisionReason: _tradeDecision.reason,
    longValid, shortValid, longStaleReason, shortStaleReason,
    longEntryStatus, shortEntryStatus, longEntryDistPct, shortEntryDistPct,
    lastTrend, inDiscount, inPremium, struct, rsi, tqi, lsRatio, funding,
  };
}

// ═══════════════════════════════════════════════════════════════
// UPDATE TRADE IDEAS (DOM RENDERER)
// ═══════════════════════════════════════════════════════════════
function updateTradeIdeas(data) {
  const { primaryDir, confPips, bullPct, weightedScore, confidenceLabel,
    primaryLevels:pl, primaryNarr, counterTxt, counterLevels:cl, counterNarr,
    tradeRejected, tradeDecisionReason,
    longValid, shortValid, longStaleReason, shortStaleReason,
    longEntryStatus, shortEntryStatus, longEntryDistPct, shortEntryDistPct,
    lastTrend, inDiscount, inPremium, struct, rsi, tqi, lsRatio, funding } = data;
  const isLong = primaryDir === 'LONG';
  const bearPct = 100-bullPct;
  const confColor = UI.confidenceColor(weightedScore);

  function staleCard(dir, levels, reason) {
    const isL = dir === 'LONG';
    return `
      <div class="trade-card" style="border-color:rgba(255,165,0,0.3);background:rgba(255,165,0,0.04)">
        <div class="trade-dir" style="color:var(--gold)">
          ${isL?'▲':'▼'} ${dir} — SCENARIO PLAYED OUT
        </div>
        <div style="font-size:9px;color:var(--sub);line-height:1.7;letter-spacing:0.04em;padding:6px 0">
          <span style="color:var(--gold);font-weight:600">⚠ Stale setup detected.</span>
          The ${dir} scenario generated from the previous swing (Entry ${fmtPrice(levels.entry)} /
          TP1 ${fmtPrice(levels.tp1)} / TP2 ${fmtPrice(levels.tp2)}) has already been reached
          or bypassed by price action. This trade is no longer actionable.<br><br>
          <span style="color:var(--muted)">Reason: ${reason}<br>
          Wait for price to form a new swing structure and re-run analysis.</span>
        </div>
      </div>`;
  }

  if (tradeRejected) {
    document.getElementById('scenarios-wrap').innerHTML = `
      <div style="padding:16px;background:rgba(255,59,48,0.07);border:1px solid rgba(255,59,48,0.25);margin:0 0 10px">
        <div style="font-family:var(--font-head);font-weight:700;font-size:11px;color:var(--red);letter-spacing:0.14em;margin-bottom:6px">
          ⛔ SETUP REJECTED — NO TRADE
        </div>
        <div style="font-size:9px;color:var(--sub);line-height:1.7;letter-spacing:0.04em">
          <strong style="color:var(--text)">Reason:</strong> ${(tradeDecisionReason||'INVALID_SETUP').replace(/_/g,' ')}<br>
          The decision engine has rejected this setup. No entry, SL, or TP will be shown.<br>
          A rejected setup means the current conditions do not meet minimum confluence requirements.<br><br>
          <span style="color:var(--muted)">What to do:</span> Wait for a BOS or CHoCH confirmation, or a valid pullback into discount/premium zone before re-evaluating.
        </div>
      </div>
      <div style="padding:10px 0;font-size:8px;color:var(--muted);letter-spacing:0.06em;border-top:1px solid var(--border)">
        SMC BIAS SCORE &nbsp;·&nbsp;
        <span style="color:var(--green)">BULL ${bullPct}%</span> vs
        <span style="color:var(--red)">BEAR ${bearPct}%</span> &nbsp;·&nbsp;
        <span style="color:var(--muted)">Raw bias shown for reference only — does not constitute a valid setup</span>
      </div>`;
    return;
  }

  const pips = Array.from({length:8},(_,i)=>`<div class="conf-pip${i<confPips?' filled':''}"></div>`).join('');
  const biasMeter = `
    <div class="bias-meter">
      <div class="bias-meter-labels">
        <span style="color:var(--green)">BULL ${bullPct}%</span>
        <span style="color:var(--muted);font-size:8px">SMC BIAS SCORE</span>
        <span style="color:var(--red)">BEAR ${bearPct}%</span>
      </div>
      <div class="bias-meter-track">
        <div class="bias-meter-fill" style="width:${bullPct}%"></div>
        <div class="bias-meter-mid"></div>
      </div>
      <div class="bias-meter-sub">
        Bias: <span style="color:${isLong?'var(--green)':'var(--red)'}">${isLong?'Bullish':'Bearish'}</span>
        &nbsp;·&nbsp;
        Confidence: <span style="color:${confColor}">${weightedScore}% (${confidenceLabel})</span>
        &nbsp;·&nbsp;Structure 40% · Location 25% · Momentum 30% · Derivatives 5%
      </div>
    </div>`;

  function entryStatusBanner(status, distPct, dir) {
    const isL = dir === 'LONG';
    if (status === 'in-trade') {
      return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;margin-bottom:5px;background:rgba(0,230,118,0.08);border:1px solid rgba(0,230,118,0.25);border-left:3px solid var(--green)">
        <span style="font-family:var(--font-head);font-size:9px;font-weight:700;color:var(--green);letter-spacing:0.12em">● TRADE RUNNING</span>
        <span style="font-size:8px;color:var(--sub);margin-left:auto">ENTRY HIT · RIDING TOWARD TP2 ${isL?'▲':'▼'}</span>
      </div>`;
    }
    if (status === 'active') {
      return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;margin-bottom:5px;background:rgba(255,213,79,0.08);border:1px solid rgba(255,213,79,0.3);border-left:3px solid var(--gold)">
        <span style="font-family:var(--font-head);font-size:9px;font-weight:700;color:var(--gold);letter-spacing:0.12em">◉ PRICE AT ENTRY — ACT NOW</span>
        <span style="font-size:8px;color:var(--sub);margin-left:auto">WITHIN ${distPct}% · ${isL?'LOOK FOR BUY SIGNAL':'LOOK FOR SELL SIGNAL'}</span>
      </div>`;
    }
    return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;margin-bottom:5px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);border-left:3px solid var(--muted)">
      <span style="font-family:var(--font-head);font-size:9px;font-weight:700;color:var(--muted);letter-spacing:0.12em">○ NOT YET — WAIT FOR PRICE TO REACH ENTRY</span>
      <span style="font-size:8px;color:var(--muted);margin-left:auto">${distPct}% AWAY · ${isL?'NEEDS PULLBACK':'NEEDS RALLY'}</span>
    </div>`;
  }

  const primaryValid = isLong ? longValid : shortValid;
  const primaryStaleReason = isLong ? longStaleReason : shortStaleReason;
  const primaryCard = primaryValid ? `
    <div class="trade-card ${isLong?'long':'short'}">
      <div class="trade-dir ${isLong?'long':'short'}">
        ${isLong?'▲':'▼'} PRIMARY: ${primaryDir}
        <span class="conviction-badge ${weightedScore>75?'high':weightedScore>=55?'mid':'low'}">${weightedScore>75?'HIGH CONVICTION':weightedScore>=55?'MED CONVICTION':'LOW CONVICTION'}</span>
        <span style="display:flex;align-items:center;gap:4px;margin-left:auto;font-size:8px;color:var(--muted)">CONF <div class="conf-bar">${pips}</div> ${confPips}/8</span>
      </div>
      ${entryStatusBanner(isLong?longEntryStatus:shortEntryStatus, isLong?longEntryDistPct:shortEntryDistPct, primaryDir)}
      <div class="trade-levels">
        <div class="trade-level"><div class="tl-label">ENTRY ZONE <span style="font-size:7px;color:var(--blue)">${isLong?(data.longEntryReason||''):(data.shortEntryReason||'')}</span></div><div class="tl-val entry">${fmtPrice(pl.entry)}</div></div>
        <div class="trade-level"><div class="tl-label">STOP LOSS</div><div class="tl-val sl">${fmtPrice(pl.sl)}</div></div>
        <div class="trade-level"><div class="tl-label">TP 1</div><div class="tl-val tp">${fmtPrice(pl.tp1)}</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-bottom:6px">
        <div class="trade-level"><div class="tl-label">TP 2 (EXTENDED)</div><div class="tl-val tp">${fmtPrice(pl.tp2)}</div></div>
        <div class="trade-level"><div class="tl-label">RISK · REWARD</div><div style="font-size:11px;font-weight:600;color:var(--gold)">${pl.rr}R <span style="font-size:8px;color:var(--muted)">RISK ${fmtPrice(Math.abs(pl.entry-pl.sl))}</span></div></div>
      </div>
      <div class="trade-narrative">${primaryNarr}</div>
    </div>`
    : staleCard(primaryDir, pl, primaryStaleReason);

  const isCounterLong = counterTxt==='LONG';
  const counterValid = isCounterLong ? longValid : shortValid;
  const counterStaleReason = isCounterLong ? longStaleReason : shortStaleReason;
  const counterCard = counterValid ? `
    <div class="trade-card counter">
      <div class="trade-dir counter">
        ${isCounterLong?'▲':'▼'} COUNTER: ${counterTxt}
        <span class="conviction-badge low">LOW CONVICTION</span>
      </div>
      ${entryStatusBanner(isCounterLong?longEntryStatus:shortEntryStatus, isCounterLong?longEntryDistPct:shortEntryDistPct, counterTxt)}
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin-bottom:5px">
        <div class="trade-level"><div class="tl-label">ENTRY</div><div class="tl-val" style="color:var(--sub);font-size:9px">${fmtPrice(cl.entry)}</div></div>
        <div class="trade-level"><div class="tl-label">SL</div><div class="tl-val sl" style="font-size:9px">${fmtPrice(cl.sl)}</div></div>
        <div class="trade-level"><div class="tl-label">TP1</div><div class="tl-val tp" style="font-size:9px">${fmtPrice(cl.tp1)}</div></div>
        <div class="trade-level"><div class="tl-label">TP2</div><div class="tl-val tp" style="font-size:9px">${fmtPrice(cl.tp2)}</div></div>
      </div>
      <div class="trade-narrative" style="font-size:8px">${counterNarr}</div>
    </div>`
    : staleCard(counterTxt, cl, counterStaleReason);

  const atrRow=`<div class="rr-row"><div class="rr-item">ATR(14) <span>${fmtPrice(data.atr)}</span></div><div class="rr-item">1× ATR <span>${fmtPrice(data.atr)}</span></div><div class="rr-item">2× ATR <span>${fmtPrice(data.atr*2)}</span></div></div>`;

  const checks=[
    { label:'SuperTrend', pass: isLong ? (lastTrend === 1) : (lastTrend === -1) },
    { label:'Price Zone',  pass: isLong ? inDiscount : inPremium },
    { label:'BOS/CHoCH',   pass: isLong ? (struct.recentBOS_up || struct.recentCHOCH_up) : (struct.recentBOS_down || struct.recentCHOCH_down) },
    { label:'RSI Aligned', pass: isLong ? (rsi !== null && rsi < 55) : (rsi !== null && rsi > 45) },
    { label:'TQI > 0.5',   pass: tqi > 0.5 },
    { label:'Funding Edge',pass: isLong ? (funding < -0.01) : (funding > 0.02) },
    { label:'L/S Position',pass: isLong ? (lsRatio < 0.8) : (lsRatio > 1.2) },
  ];
  const smcChecklist=`
    <div style="padding:6px 0">
      <div class="panel-hd"><span class="panel-hd-label">SMC CONFLUENCE CHECKLIST</span></div>
      ${checks.map(c=>`<div class="smc-check-row">
        <span class="smc-check-icon" style="color:${c.pass?'var(--green)':'var(--muted)'}">${c.pass?'✓':'·'}</span>
        <span class="smc-check-label" style="color:${c.pass?'var(--text)':'var(--muted)'}">${c.label}</span>
        <span class="smc-check-status" style="color:${c.pass?'var(--green)':'var(--muted)'}">${c.pass?'ALIGNED':'NEUTRAL'}</span>
      </div>`).join('')}
    </div>`;

  document.getElementById('scenarios-wrap').innerHTML = biasMeter + primaryCard + counterCard + atrRow + smcChecklist;
}

// ═══════════════════════════════════════════════════════════════
// MAIN ANALYSIS RUNNER
// ═══════════════════════════════════════════════════════════════
async function runAnalysis() {
  const rawTicker = document.getElementById('tickerInput').value.trim().toUpperCase();
  if (!rawTicker) { setStatus('ENTER A TICKER FIRST','err'); return; }
  const ticker = rawTicker
    .replace(/[/\-_]/g, '')
    .replace(/(USDT|BUSD|USD|PERP|\.P)$/i, '')
    .replace(/^USDT/i, '');
  if (!ticker) { setStatus('INVALID TICKER — ENTER BASE SYMBOL LIKE BTC','err'); return; }
  document.getElementById('tickerInput').value = ticker;
  const tf = document.getElementById('tfSelect').value;
  _lastTicker = ticker; _lastTF = tf;

  document.getElementById('analysisBtn').disabled = true;
  setStatus('FETCHING '+ticker+' DATA...','loading');
  document.getElementById('loading-overlay').classList.add('active');
  document.getElementById('loading-sub-text').textContent='LOADING '+ticker+'USDT ON '+tf.toUpperCase()+'...';

  try {
    const [candles, ticker24h, funding, oi, ls, lsTop, bybit, gecko, multiTF] = await Promise.allSettled([
      fetchBinanceCandles(ticker, tf, 200),
      fetchBinanceTicker(ticker),
      fetchBinanceFunding(ticker),
      fetchBinanceOI(ticker),
      fetchBinanceLSRatio(ticker),
      fetchBinanceLSTop(ticker),
      fetchBybitTicker(ticker),
      fetchGeckoCoin(ticker),
      fetchMultiTF(ticker),
    ]);

    if (candles.status !== 'fulfilled' || !candles.value) throw new Error('No candle data for '+ticker);
    const c = candles.value;
    const n = c.length;
    const closes = c.map(cc=>cc.close);
    const currentPrice = closes[n-1];
    const stData = calcSuperTrend(c);
    const swings = findSwings(c, 5);
    const fvgs   = findFVGs(c);
    const srLevels = buildSRLevels(c, swings.highs, swings.lows, currentPrice);
    const er  = calcER(closes, 20);
    const tqi = calcTQI(c, 20, 20, 10);
    const rsiArr = calcRSI(closes, 14);
    const rsi = rsiArr[rsiArr.length-1] || null;
    const derivData = {
      lsRatio: ls.status==='fulfilled'&&ls.value ? parseFloat(ls.value.longShortRatio||1) : 1,
      funding:  funding.status==='fulfilled'&&funding.value ? parseFloat(funding.value.fundingRate||0)*100 : 0,
    };

    renderChart(c, stData, fvgs, swings, srLevels);
    updatePriceHeader(ticker, ticker24h.value, c, stData, er, tqi, rsi);
    updateDerivatives(ticker24h.value, funding.value, oi.value, ls.value, lsTop.value, bybit.value, gecko.value);
    updateStructure(c, stData, swings, fvgs, tf);

    const dataWarnings = [];
    if (multiTF.status === 'fulfilled') {
      updateMultiTF(multiTF.value, tf);
    } else {
      dataWarnings.push('MTF');
      const mtfEl = document.getElementById('mtf-table');
      if (mtfEl) mtfEl.innerHTML = '<div style="color:var(--muted);font-size:9px;padding:6px">MTF data unavailable — API timeout or rate limit</div>';
    }
    if (gecko.status !== 'fulfilled' || !gecko.value) {
      dataWarnings.push('CoinGecko');
      ['d-rank','d-fdv','d-mcap','d-dom'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = '—'; el.title = 'CoinGecko data unavailable'; }
      });
    }
    if (bybit.status !== 'fulfilled' || !bybit.value) {
      dataWarnings.push('Bybit');
      ['d-bybit-price','d-bybit-vol'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = '—'; el.title = 'Bybit data unavailable'; }
      });
    }
    if (oi.status !== 'fulfilled' || !oi.value) {
      dataWarnings.push('OI');
      const oiEl = document.getElementById('d-oi');
      if (oiEl) { oiEl.textContent = '—'; oiEl.title = 'Open interest unavailable'; }
    }
    if (dataWarnings.length > 0) {
      setStatus(ticker + ' · ' + tf.toUpperCase() + ' · partial data (' + dataWarnings.join(', ') + ' unavailable)', 'warn');
    }
    updateSRLevels(srLevels);

    const struct         = detectStructure(c, swings.highs, swings.lows);
    // FIX 9: swing-level swings for OB detection (major structure breaks drive OBs)
    const swingSwings50  = findSwings(c, 50);
    const swingStruct50  = detectStructure(c, swingSwings50.highs, swingSwings50.lows);
    const obStruct       = swingStruct50.events.length > 0 ? swingStruct50 : struct;
    const obs = findOrderBlocks(c, swingSwings50, obStruct.events);
    renderOrderBlocks(obs, currentPrice);

    if (bybit.value && ticker24h.value) {
      const bp  = parseFloat(bybit.value.lastPrice || 0);
      const binP = parseFloat(ticker24h.value.lastPrice || currentPrice);
      if (bp && binP) {
        const spread = ((bp - binP) / binP * 100).toFixed(4);
        const spreadEl = document.getElementById('d-spread');
        spreadEl.textContent = spread + '%';
        spreadEl.className = 'deriv-val ' + (Math.abs(parseFloat(spread)) > 0.1 ? 'warn' : '');
      }
    }

    const tradeData = generateTradeIdeas(c, stData, swings, fvgs, srLevels, rsi, er, tqi, currentPrice, derivData);
    _lastTradeData = { ...tradeData, ticker, tf, currentPrice, timestamp: new Date().toISOString() };
    updateTradeIdeas(tradeData);

    setStatus(ticker+' · '+tf.toUpperCase()+' · '+new Date().toISOString().slice(11,19)+' UTC','ok');

    fetchOIHistory(ticker).then(hist => {
      if (hist && hist.length >= 2) {
        renderOISparkline(hist.map(x => ({
          val: parseFloat(x.sumOpenInterestValue || 0) || parseFloat(x.sumOpenInterest || 0),
          raw: x
        })));
        const first = parseFloat(hist[0].sumOpenInterestValue || hist[0].sumOpenInterest || 0);
        const last  = parseFloat(hist[hist.length-1].sumOpenInterestValue || hist[hist.length-1].sumOpenInterest || 0);
        if (first > 0) {
          const chgPct = ((last - first) / first * 100).toFixed(2);
          const el = document.getElementById('d-oi-chg');
          if (el) {
            el.textContent = (parseFloat(chgPct) >= 0 ? '+' : '') + chgPct + '%';
            el.className = 'deriv-val ' + (parseFloat(chgPct) > 0 ? 'up' : 'down');
          }
        }
      } else {
        const last24 = c.slice(-24);
        if (last24.length >= 2) {
          renderOISparkline(last24.map(candle => ({ val: candle.vol })));
          const label = document.querySelector('#oi-spark')?.previousElementSibling;
          if (label) label.textContent = 'VOLUME PROXY (24 BARS)';
        }
      }
    });

  } catch(e) {
    setStatus('ERROR: '+e.message,'err');
    console.error(e);
  } finally {
    document.getElementById('analysisBtn').disabled = false;
    document.getElementById('loading-overlay').classList.remove('active');
  }
}
