// ═══════════════════════════════════════════════════════════════
// FETCH UTILITY
// ═══════════════════════════════════════════════════════════════
async function fetchWithTimeout(url, ms = CFG.TIMEOUT) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(id);
    return r;
  } catch(e) {
    clearTimeout(id);
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════
// DATA FETCHERS — ANALYSIS MODE
// ═══════════════════════════════════════════════════════════════

async function fetchBinanceCandles(symbol, tf, limit = 200) {
  const tfMap = {'5m':'5m','15m':'15m','1h':'1h','4h':'4h','1d':'1d','1w':'1w'};
  const interval = tfMap[tf] || '1h';
  let url = `${CFG.BINANCE_FAPI}/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`;
  try {
    const r = await fetchWithTimeout(url);
    if (r.ok) {
      const d = await r.json();
      if (Array.isArray(d) && d.length > 5)
        return d.map(k => ({time:+k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4],vol:+k[5]}));
    }
  } catch(e) {}
  url = `${CFG.BINANCE_SPOT}/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`;
  const r = await fetchWithTimeout(url);
  if (!r.ok) throw new Error('Not found: ' + symbol);
  const d = await r.json();
  if (!Array.isArray(d) || d.length < 5) throw new Error('No data: ' + symbol);
  return d.map(k => ({time:+k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4],vol:+k[5]}));
}

async function fetchBinanceTicker(symbol) {
  try {
    const r = await fetchWithTimeout(`${CFG.BINANCE_SPOT}/ticker/24hr?symbol=${symbol}USDT`);
    return await r.json();
  } catch(e) { return null; }
}

async function fetchBinanceFunding(symbol) {
  try {
    const r = await fetchWithTimeout(`${CFG.BINANCE_FAPI}/fundingRate?symbol=${symbol}USDT&limit=1`);
    const d = await r.json();
    return Array.isArray(d) && d.length ? d[0] : null;
  } catch(e) { return null; }
}

async function fetchBinanceOI(symbol) {
  try {
    const r = await fetchWithTimeout(`${CFG.BINANCE_FAPI}/openInterest?symbol=${symbol}USDT`);
    return r.ok ? await r.json() : null;
  } catch(e) { return null; }
}

async function fetchBinanceLSRatio(symbol) {
  try {
    const r = await fetchWithTimeout(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}USDT&period=5m&limit=1`);
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d) && d.length ? d[0] : null;
  } catch(e) { return null; }
}

async function fetchBinanceLSTop(symbol) {
  try {
    const r = await fetchWithTimeout(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}USDT&period=5m&limit=1`);
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d) && d.length ? d[0] : null;
  } catch(e) { return null; }
}

async function fetchBybitTicker(symbol) {
  try {
    const r = await fetchWithTimeout(`${CFG.BYBIT_API}/tickers?category=spot&symbol=${symbol}USDT`);
    const d = await r.json();
    return d?.result?.list?.[0] || null;
  } catch(e) { return null; }
}

async function fetchBybitOI(symbol) {
  try {
    const r = await fetchWithTimeout(`${CFG.BYBIT_API}/open-interest?category=linear&symbol=${symbol}USDT&intervalTime=5min&limit=1`);
    const d = await r.json();
    return d?.result?.list?.[0] || null;
  } catch(e) { return null; }
}

async function fetchGeckoCoin(symbol) {
  const coinMap = {
    BTC:'bitcoin',ETH:'ethereum',SOL:'solana',BNB:'binancecoin',DOGE:'dogecoin',XRP:'ripple',
    ADA:'cardano',AVAX:'avalanche-2',DOT:'polkadot',LINK:'chainlink',MATIC:'matic-network',
    UNI:'uniswap',ATOM:'cosmos',LTC:'litecoin',BCH:'bitcoin-cash',NEAR:'near',APT:'aptos',
    ARB:'arbitrum',OP:'optimism',INJ:'injective-protocol',TIA:'celestia',SUI:'sui',
    SEI:'sei-network',PYTH:'pyth-network',PEPE:'pepe',WIF:'dogwifcoin',BONK:'bonk',
    FLOKI:'floki',TON:'the-open-network',NOT:'notcoin',TRX:'tron',FTM:'fantom',
    HBAR:'hedera-hashgraph',ALGO:'algorand',VET:'vechain',ICP:'internet-computer',
    SAND:'the-sandbox',MANA:'decentraland',AXS:'axie-infinity',SHIB:'shiba-inu',
    CRO:'crypto-com-chain',FIL:'filecoin',IMX:'immutable-x',BLUR:'blur',
    CAKE:'pancakeswap-token',AAVE:'aave',MKR:'maker',COMP:'compound-governance-token',
    SNX:'havven',CRV:'curve-dao-token',BAL:'balancer',SUSHI:'sushi',YFI:'yearn-finance',
    GRT:'the-graph',LDO:'lido-dao',RUNE:'thorchain',OSMO:'osmosis',DYDX:'dydx',
    GMX:'gmx',PENDLE:'pendle',JTO:'jito-governance-token',EIGEN:'eigenlayer',
    ENA:'ethena',W:'wormhole',ZRO:'layerzero',
  };
  let id = coinMap[symbol.toUpperCase()];
  if (!id) {
    try {
      const sr = await fetchWithTimeout(`${CFG.GECKO_API}/search?query=${symbol.toLowerCase()}`);
      if (sr.ok) {
        const sd = await sr.json();
        const match = sd?.coins?.find(c => c.symbol.toUpperCase() === symbol.toUpperCase());
        if (match) id = match.id;
      }
    } catch(e) {}
  }
  if (!id) return null;
  try {
    const r = await fetchWithTimeout(`${CFG.GECKO_API}/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`);
    return r.ok ? await r.json() : null;
  } catch(e) { return null; }
}

async function fetchMultiTF(symbol) {
  const tfs = ['15m','1h','4h','1d','1w'];
  const results = {};
  await Promise.allSettled(tfs.map(async tf => {
    try { results[tf] = await fetchBinanceCandles(symbol, tf, 100); }
    catch(e) { results[tf] = null; }
  }));
  return results;
}

async function fetchOIHistory(symbol) {
  try {
    const r = await fetchWithTimeout(`${CFG.BINANCE_FAPI}/openInterestHist?symbol=${symbol}USDT&period=1h&limit=24`);
    if (!r.ok) return null;
    const d = await r.json();
    if (!Array.isArray(d) || d.length < 2) return null;
    const hasData = d.some(x => parseFloat(x.sumOpenInterest || 0) > 0);
    return hasData ? d : null;
  } catch(e) { return null; }
}
